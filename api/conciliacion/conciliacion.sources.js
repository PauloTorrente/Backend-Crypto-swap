// Lê os arquivos como saem dos bancos e junta tudo num formato só:
//   - Extrato do Banco Económico (.xlsx "Extracto de Caja de Ahorros") → aba ECOPJ ou ECOPF
//   - Extrato do PicPay (.csv "data;movimento;descrição;tipo;valor") → aba PICPAY
//   - Histórico de cotações (.txt baixado em /historico) → preço do USDT a cada 30 s
//   - O próprio "Relatorio de lucro" (.xlsx), para as abas que ainda não vêm de arquivo cru
//     (FIDU, BYBIT, BNB) e para o que a planilha já liga
const JSZip = require('jszip');
const { parseRelatorio, BANKS } = require('./conciliacion.parser');

// Titular do extrato do Banco Económico → aba da planilha
const ECO_ACCOUNTS = [
  { match: /DON JUAN/i, sheet: 'ECOPJ' },
  { match: /MORENO TORRENTE/i, sheet: 'ECOPF' }
];

const MONTHS = { ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, SEP: 8, SEPT: 8, OCT: 9, NOV: 10, DIC: 11 };

// Datas sem fuso, guardadas como UTC (igual ao Excel): "01/Oct/2026" + "08:34:45"
function ecoDate(day, time) {
  const m = String(day).match(/^(\d{1,2})\/([A-Za-z]+)\/(\d{4})$/);
  if (!m || MONTHS[m[2].toUpperCase()] === undefined) return null;
  const [h = 0, min = 0, s = 0] = String(time || '').split(':').map(Number);
  return new Date(Date.UTC(+m[3], MONTHS[m[2].toUpperCase()], +m[1], h, min, s));
}

// "3,626.96" → 3626.96
const ecoNumber = v => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, '')));

// O .xlsx do Banco Económico é gerado em .NET com caminhos absolutos (/xl/workbook.xml), que o
// exceljs não abre. Como é uma tabela simples, lemos o XML da primeira aba direto.
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = s =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(parseInt(e[1].toLowerCase() === 'x' ? e.slice(2) : e.slice(1), e[1].toLowerCase() === 'x' ? 16 : 10)) : XML_ENTITIES[e] ?? m
  );
const tag = name => `<(?:\\w+:)?${name}`;
const close = name => `</(?:\\w+:)?${name}>`;
const texts = xml => [...xml.matchAll(new RegExp(`${tag('t')}(?:\\s[^>]*)?>([\\s\\S]*?)${close('t')}`, 'g'))].map(m => unescapeXml(m[1])).join('');
const colIndex = ref => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// → [[valores da linha 1 por coluna (1 = A)], ...], só a primeira aba, tudo como texto
async function readFirstSheet(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheetFile = Object.keys(zip.files)
    .filter(f => /^\/?xl\/worksheets\/[^/]+\.xml$/.test(f))
    .sort()[0];
  if (!sheetFile) throw new Error('Planilha sem abas');
  const sharedFile = zip.file(/^\/?xl\/sharedStrings\.xml$/)[0];
  const shared = sharedFile
    ? [...(await sharedFile.async('string')).matchAll(new RegExp(`${tag('si')}>([\\s\\S]*?)${close('si')}`, 'g'))].map(m => texts(m[1]))
    : [];

  const xml = await zip.file(sheetFile).async('string');
  const rows = [];
  for (const [, attrs, body] of xml.matchAll(new RegExp(`${tag('row')}\\s([^>]*)>([\\s\\S]*?)${close('row')}`, 'g'))) {
    const r = +attrs.match(/\br="(\d+)"/)[1];
    const values = [];
    for (const [, cAttrs, cBody = ''] of body.matchAll(new RegExp(`${tag('c')}\\s([^>]*?)(?:/>|>([\\s\\S]*?)${close('c')})`, 'g'))) {
      const ref = cAttrs.match(/\br="([A-Z]+\d+)"/)[1];
      const type = cAttrs.match(/\bt="(\w+)"/)?.[1];
      const v = cBody.match(new RegExp(`${tag('v')}>([\\s\\S]*?)${close('v')}`))?.[1];
      values[colIndex(ref)] = type === 's' ? shared[+v] : type === 'inlineStr' ? texts(cBody) : v === undefined ? '' : unescapeXml(v);
    }
    rows[r] = values;
  }
  return rows;
}

async function readEconomico(buffer) {
  const sheet = await readFirstSheet(buffer);

  let holder = '';
  let headerRow = null;
  const cols = {};
  sheet.forEach((cells = [], n) => {
    const text = cells.map(c => String(c ?? '').trim());
    const i = text.indexOf('Titular:');
    if (i >= 0) holder = text.slice(i + 1).find(Boolean) || '';
    if (!headerRow && text[1] === 'Fecha' && text.includes('Monto')) {
      headerRow = n;
      text.forEach((c, col) => c && (cols[c] = col));
    }
  });
  if (!headerRow) throw new Error('Extrato do Banco Económico sem a linha de títulos (Fecha, Hora, ..., Monto)');

  const account = ECO_ACCOUNTS.find(a => a.match.test(holder));
  if (!account) throw new Error(`Extrato do Banco Económico de titular desconhecido: "${holder}"`);

  const rows = [];
  sheet.forEach((cells = [], n) => {
    if (n <= headerRow) return;
    const get = title => cells[cols[title]] ?? '';
    const date = ecoDate(get('Fecha'), get('Hora'));
    const amount = ecoNumber(get('Monto'));
    if (!date || !Number.isFinite(amount) || !amount) return;
    rows.push({
      date,
      hasTime: true,
      amount,
      type: String(get('Transacción')).trim(),
      counterparty: String(get('Nota')).trim(),
      balance: ecoNumber(get('Saldo'))
    });
  });
  return { sheet: account.sheet, holder, rows };
}

function readPicpay(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const header = lines[0].toLowerCase().split(';').map(h => h.trim());
  const idx = name => header.indexOf(name);
  const rows = lines.slice(1).map(line => {
    const c = line.split(';');
    const [y, m, d] = c[idx('data')].split('-').map(Number);
    return {
      date: new Date(Date.UTC(y, m - 1, d)),
      hasTime: false,
      amount: parseFloat(c[idx('valor')]),
      type: c[idx('movimento')].trim(),
      counterparty: c[idx('descrição')].trim()
    };
  });
  return { sheet: 'PICPAY', rows: rows.filter(r => r.amount) };
}

// ---------- cotações ----------

// Preço de referência de uma moeda num instante = média de compra/venda de todas as corretoras
const midPrice = sources => {
  const values = (sources || []).flatMap(s => [parseFloat(s.buy), parseFloat(s.sell)]).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
};

// [{ time (hora local guardada como UTC), prices: { BRL: [...], BOB: [...] } }] → { BRL: [[t, preço]], BOB: [...] }
function historyFromSnapshots(snapshots) {
  const history = {};
  for (const s of snapshots) {
    for (const [currency, sources] of Object.entries(s.prices || {})) {
      const p = midPrice(sources);
      if (p) (history[currency] ||= []).push([+s.time, p]);
    }
  }
  for (const points of Object.values(history)) points.sort((a, b) => a[0] - b[0]);
  return history;
}

// Linha do .txt: "[12/10/2026, 09:25:28] BRL: binance 5.0230/5.0229, bybit 5.0255/5.0170 | BOB: ..."
function readQuotesTxt(text) {
  const snapshots = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})\] (.*)$/);
    if (!m) continue;
    const prices = {};
    for (const part of m[7].split('|')) {
      const [currency, list] = part.split(':').map(s => s.trim());
      if (!list || list === '-') continue;
      prices[currency] = list.split(',').map(s => {
        const [exchange, pair] = s.trim().split(' ');
        const [buy, sell] = pair.split('/');
        return { exchange, buy, sell };
      });
    }
    snapshots.push({ time: new Date(Date.UTC(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +m[6])), prices });
  }
  return snapshots;
}

// ---------- junta tudo ----------

function kindOf(name, buffer) {
  const head = buffer.subarray(0, 200).toString('utf8');
  if (head.startsWith('Histórico de preços do USDT')) return 'cotacoes';
  if (/^﻿?data;movimento;/i.test(head)) return 'picpay';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'xlsx'; // zip
  throw new Error(`${name}: formato não reconhecido (esperado .xlsx, extrato PicPay .csv ou cotações .txt)`);
}

async function isEconomico(buffer) {
  const first = await readFirstSheet(buffer);
  return String(first[1]?.[1] ?? '').startsWith('Extracto de Caja');
}

// files: [{ name, buffer }] → { bank, p2p, linked, history, sheets, generated }
// Quando chega algum extrato cru, as abas são renumeradas em sequência (linha 2, 3, ...), que é
// como a planilha gerada vai ficar; as referências da planilha antiga são traduzidas junto.
// period: { desde, hasta } ('YYYY-MM-DD', inclusive) → só os lançamentos e ordens P2P desses dias
async function parseFiles(files, { desde, hasta } = {}) {
  const inPeriod = date => {
    const day = date.toISOString().slice(0, 10);
    return (!desde || day >= desde) && (!hasta || day <= hasta);
  };
  const raw = {}; // aba → lançamentos vindos de arquivo cru
  const snapshots = [];
  const sources = [];
  let relatorio = null;

  for (const { name, buffer } of files) {
    const kind = kindOf(name, buffer);
    if (kind === 'cotacoes') {
      snapshots.push(...readQuotesTxt(buffer.toString('utf8')));
      sources.push(`${name}: cotações`);
    } else if (kind === 'picpay') {
      const { sheet, rows } = readPicpay(buffer.toString('utf8'));
      raw[sheet] = rows;
      sources.push(`${name}: ${sheet} (${rows.length} lançamentos)`);
    } else if (await isEconomico(buffer)) {
      const { sheet, holder, rows } = await readEconomico(buffer);
      raw[sheet] = rows;
      sources.push(`${name}: ${sheet} – ${holder} (${rows.length} lançamentos)`);
    } else {
      relatorio = await parseRelatorio(buffer);
      sources.push(`${name}: planilha (${relatorio.sheets.join(', ')})`);
    }
  }

  // O mesmo filtro nos extratos crus e nos da planilha mantém os dois na mesma ordem
  for (const sheet of Object.keys(raw)) raw[sheet] = raw[sheet].filter(r => inPeriod(r.date));
  if (relatorio) {
    relatorio.bank = relatorio.bank.filter(t => inPeriod(t.date));
    relatorio.p2p = relatorio.p2p.filter(o => inPeriod(o.date));
  }
  if (desde || hasta) sources.push(`período: ${desde || 'início'} a ${hasta || 'fim'}`);

  const generated = Object.keys(raw).length > 0;
  if (!generated) {
    if (!relatorio) throw new Error('Nenhum extrato enviado');
    return { ...relatorio, history: historyFromSnapshots(snapshots), sources, generated };
  }

  // Abas: as cruas substituem as da planilha; as outras vêm da planilha, sem as linhas em branco
  const bank = [];
  const renumber = new Map(); // "FIDU:227" (planilha antiga) → 215 (planilha gerada)
  const sheets = new Set([...Object.keys(BANKS).filter(s => raw[s] || relatorio?.bank.some(t => t.sheet === s))]);
  for (const sheet of sheets) {
    const fromRelatorio = (relatorio?.bank || []).filter(t => t.sheet === sheet).sort((a, b) => a.row - b.row);
    const rows = raw[sheet] || fromRelatorio;
    // Para traduzir as referências antigas: o extrato cru tem os mesmos lançamentos na mesma ordem
    fromRelatorio.forEach((t, i) => renumber.set(`${sheet}:${t.row}`, i + 2));
    rows.forEach((r, i) => {
      const row = i + 2;
      bank.push({
        id: `${sheet}!D${row}`, // na planilha gerada o valor fica sempre na coluna D
        sheet,
        row,
        currency: BANKS[sheet].currency,
        date: r.date,
        hasTime: r.hasTime,
        amount: r.amount,
        type: r.type,
        counterparty: r.counterparty,
        balance: r.balance ?? null
      });
    });
  }

  const p2p = (relatorio?.p2p || []).map(o => ({ ...o }));
  const p2pRows = new Map();
  for (const sheet of new Set(p2p.map(o => o.sheet))) {
    p2p.filter(o => o.sheet === sheet).sort((a, b) => a.row - b.row).forEach((o, i) => {
      p2pRows.set(`${sheet}:${o.row}`, i + 2);
      o.row = i + 2;
    });
  }

  const linked = new Map();
  for (const [key, link] of relatorio?.linked || []) {
    const newRow = renumber.get(key) ?? p2pRows.get(key);
    if (newRow) linked.set(`${key.split(':')[0]}:${newRow}`, link);
  }

  return { bank, p2p, linked, history: historyFromSnapshots(snapshots), sources, generated };
}

module.exports = { parseFiles, historyFromSnapshots, readQuotesTxt };
