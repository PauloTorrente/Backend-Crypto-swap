// Lê os arquivos como saem dos bancos e junta tudo num formato só:
//   - Extrato do Banco Económico (.xlsx "Extracto de Caja de Ahorros") → aba ECOPJ ou ECOPF
//   - Extrato do PicPay (.csv "data;movimento;descrição;tipo;valor") → aba PICPAY
//   - Histórico de cotações (.txt baixado em /historico) → preço do USDT a cada 30 s
//   - Extrato da Fiducia (.xlsx "Movimientos") → FIDU; PicPay também em .xlsx
//   - Histórico P2P da Bybit (.xls) → BYBIT; histórico C2C da Binance (.xlsx) → BNB
//   - O próprio "Relatorio de lucro" (.xlsx), para as abas que não vieram cruas e para o que a
//     planilha já liga
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
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

// Valor de uma célula do exceljs, já tratando fórmula/texto rico (igual ao conciliacion.parser.js)
function cellValue(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map(t => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

async function isFiducia(buffer) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Movimientos');
    if (!ws) return false;
    return /Extracto Fid[uú]cia/i.test(String(ws.getRow(1).getCell(1).value ?? ''));
  } catch {
    return false;
  }
}

// Extrato da Fiducia (.xlsx, aba "Movimientos"): titulos na linha 4, uma linha "Saldo anterior"
// antes dos lançamentos, e entrada/saída em colunas separadas (sempre positivas).
async function readFiducia(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Movimientos');
  if (!ws) throw new Error('Extrato da Fiducia sem a aba "Movimientos"');

  const HEADER_ROW = 4;
  const header = {};
  ws.getRow(HEADER_ROW).eachCell((cell, col) => {
    const t = String(cellValue(cell) ?? '').trim();
    if (t) header[t] = col;
  });
  const col = title => header[title];
  const obrigatorias = ['Fecha', 'Tipo', 'Contraparte', 'Entrada (R$)', 'Salida (R$)', 'Saldo extracto (R$)'];
  if (obrigatorias.some(t => !col(t))) {
    throw new Error('Extrato da Fiducia sem as colunas esperadas (Fecha, Tipo, Contraparte, Entrada/Salida, Saldo)');
  }

  const num = v => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')));
  const rows = [];
  ws.eachRow((row, r) => {
    if (r <= HEADER_ROW) return; // pula titulo/periodo/linha em branco/cabecalho
    const get = title => cellValue(row.getCell(col(title)));
    const date = get('Fecha');
    if (!(date instanceof Date) || isNaN(date)) return; // pula "Saldo anterior" e linhas sem data

    const entrada = num(get('Entrada (R$)'));
    const salida = num(get('Salida (R$)'));
    const amount = entrada ? entrada : salida ? -salida : null;
    if (!amount) return;

    rows.push({
      date,
      hasTime: false,
      amount,
      type: String(get('Tipo') ?? '').trim(),
      counterparty: String(get('Contraparte') ?? '').trim(),
      balance: num(get('Saldo extracto (R$)'))
    });
  });
  return { sheet: 'FIDU', rows };
}

// Outra exportação da Fiducia (.xlsx, aba "movimientos"): uma linha de títulos
// "id | fecha | descripcion | ag_origem | valor | saldo", valor já com sinal, e o tipo e a
// contraparte juntos na descrição ("Pix recebido de 51.984.856 DANILO DE JESUS").
const FIDUCIA_RAW_COLUMNS = ['fecha', 'descripcion', 'valor', 'saldo'];

async function fiduciaRawSheet(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find(w => w.name.trim().toLowerCase() === 'movimientos');
  if (!ws) return null;
  const header = {};
  ws.getRow(1).eachCell((cell, col) => {
    const t = String(cellValue(cell) ?? '').trim().toLowerCase();
    if (t) header[t] = col;
  });
  return FIDUCIA_RAW_COLUMNS.every(c => header[c]) ? { ws, header } : null;
}

async function isFiduciaRaw(buffer) {
  try {
    return Boolean(await fiduciaRawSheet(buffer));
  } catch {
    return false;
  }
}

// "Pix recebido de X" → ['Pix recebido', 'X']; "Tarifa Pix" → ['Tarifa Pix', '']
function splitDescription(text) {
  const m = text.match(/^(.*?)\s+(?:de|para)\s+(.+)$/i);
  if (!m || /^tarifa/i.test(text)) return [text, ''];
  return [m[1].trim(), m[2].replace(/\s+-\s*$/, '').trim()];
}

async function readFiduciaRaw(buffer) {
  const { ws, header } = await fiduciaRawSheet(buffer);
  const num = v => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')));
  const rows = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const get = name => cellValue(row.getCell(header[name]));
    const date = get('fecha');
    const amount = num(get('valor'));
    if (!(date instanceof Date) || isNaN(date) || !Number.isFinite(amount) || !amount) return;
    const [type, counterparty] = splitDescription(String(get('descripcion') ?? '').trim());
    rows.push({ date, hasTime: false, amount, type, counterparty, balance: num(get('saldo')) });
  });
  return { sheet: 'FIDU', rows };
}

async function isPicpayXlsx(buffer) {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    const h1 = String(cellValue(ws.getRow(1).getCell(1)) ?? '').trim().toLowerCase();
    const h2 = String(cellValue(ws.getRow(1).getCell(2)) ?? '').trim().toLowerCase();
    return h1 === 'data' && h2 === 'movimento';
  } catch {
    return false;
  }
}

// Mesmo extrato do PicPay, só que exportado como .xlsx em vez de .csv (colunas identicas,
// "valor" ja vem com o sinal certo: negativo pra saida).
async function readPicpayXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const header = {};
  ws.getRow(1).eachCell((cell, col) => {
    const t = String(cellValue(cell) ?? '').trim().toLowerCase();
    if (t) header[t] = col;
  });
  const col = name => header[name];
  if (!col('data') || !col('valor')) {
    throw new Error('Extrato do PicPay (.xlsx) sem as colunas esperadas (Data, Movimento, Descrição, Valor)');
  }

  const rows = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const get = name => cellValue(row.getCell(col(name)));
    const raw = get('data');
    const date = raw instanceof Date ? raw : (() => {
      const m = String(raw ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    })();
    const amount = parseFloat(String(get('valor') ?? '').replace(',', '.'));
    if (!date || !Number.isFinite(amount) || !amount) return;
    rows.push({
      date,
      hasTime: false,
      amount,
      type: String(get('movimento') ?? '').trim(),
      counterparty: String(get('descrição') ?? '').trim()
    });
  });
  return { sheet: 'PICPAY', rows };
}

// ---------- ordens P2P das exchanges ----------

// Hora "AAAA-MM-DD HH:MM:SS" no fuso do arquivo → hora da Bolívia (UTC−4) guardada como UTC,
// igual aos extratos
const BOLIVIA_OFFSET = -4;
function exchangeDate(text, offset = BOLIVIA_OFFSET) {
  const m = String(text ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4] - offset + BOLIVIA_OFFSET, +m[5], +m[6]));
}

// "(UTC-04:00)", "(UTC--4)", "UTC+8" → −4, −4, 8
function utcOffset(text) {
  const m = String(text ?? '').match(/UTC\s*([+-]{0,2})\s*(\d{1,2})/i);
  return m ? (m[1].includes('-') ? -1 : 1) * +m[2] : null;
}

const plainNumber = v => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, '')));
const SIDES = { BUY: 'Compra', COMPRA: 'Compra', SELL: 'Venta', VENDA: 'Venta', VENTA: 'Venta' };
const STATUSES = { COMPLETED: 'Completado', CONCLUIDO: 'Completado', COMPLETADO: 'Completado', CANCELED: 'Cancelado', CANCELLED: 'Cancelado', CANCELADO: 'Cancelado', 'TRANSACTION FAILED': 'Fallido' };
const normalized = (map, v) => {
  const key = String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  return map[key] || String(v ?? '').trim();
};

// Primeira aba como linhas de texto: .xls (Bybit) pelo SheetJS, .xlsx pelo leitor de XML acima
async function sheetRows(buffer) {
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) {
    const wb = XLSX.read(buffer, { type: 'buffer', dense: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    return rows.map(r => r.map(c => String(c ?? '').trim()));
  }
  return (await readFirstSheet(buffer)).map((r = []) => [...r].map(c => String(c ?? '').trim()));
}

// Colunas de cada exportação, com os títulos em inglês, português e espanhol
const EXCHANGES = {
  BYBIT: {
    name: 'Bybit',
    columns: {
      order: ['Order No.', 'Nº de orden'],
      side: ['Direction', 'Dirección'],
      currency: ['Fiat Currency', 'Moneda fiat'],
      amount: ['Fiat Amount', 'Monto fiat'],
      price: ['Unit Price', 'Precio unitario'],
      usdt: ['Coin Amount', 'Cantidad de cripto'],
      fee: ['Transaction Fees', 'Comisiones'],
      counterparty: ['Counterparty', 'Contraparte'],
      status: ['Status', 'Estado'],
      date: [/^Time\b/, /^Hora\b/]
    }
  },
  BNB: {
    name: 'Binance',
    // Titular ("Nome") no cabeçalho da exportação → aba; a da empresa fica em BNB
    accounts: [{ match: /MORENO TORRENTE/i, sheet: 'BNBPF', name: 'Binance PF' }],
    columns: {
      order: ['Número do Pedido', 'Order Number', 'Número de orden'],
      side: ['Tipo de Ordem', 'Order Type', 'Tipo de orden'],
      currency: ['Tipo de Fiat', 'Fiat Type', 'Tipo de fiat'],
      amount: ['Preço Total', 'Total Price', 'Precio total'],
      price: ['Preço', 'Price', 'Precio'],
      usdt: ['Quantidade', 'Quantity', 'Cantidad'],
      makerFee: ['Taxa do Maker', 'Maker Fee', 'Comisión del creador'],
      takerFee: ['Taxa do Taker', 'Taker Fee', 'Comisión del tomador'],
      counterparty: ['Contraparte', 'Counterparty', 'Couterparty'],
      status: ['Status', 'Estado'],
      date: ['Hora de Criação', 'Created Time', 'Hora de creación']
    }
  }
};

// → { sheet, headerRow, cols } da exportação que tiver todas as colunas, ou null
function findExchangeHeader(rows) {
  for (const [sheet, cfg] of Object.entries(EXCHANGES)) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const cells = rows[r] || [];
      const cols = {};
      for (const [key, titles] of Object.entries(cfg.columns)) {
        // Na Bybit "Fiat Currency" aparece duas vezes (moeda do valor e do preço): vale a primeira
        const i = cells.findIndex(c => titles.some(t => (t instanceof RegExp ? t.test(c) : c === t)));
        if (i >= 0) cols[key] = i;
      }
      if (Object.keys(cols).length === Object.keys(cfg.columns).length) return { sheet, headerRow: r, cols };
    }
  }
  return null;
}

// Histórico P2P da Bybit (.xls) ou C2C da Binance (.xlsx) → ordens no formato do parser
function readExchange(rows, found) {
  const { headerRow, cols } = found;
  // Titular: célula depois de "Nome" (Binance); com outra conta da mesma exchange vai para outra aba
  let holder = '';
  for (const cells of rows.slice(0, headerRow)) {
    const i = (cells || []).findIndex(c => c === 'Nome' || c === 'Name' || c === 'Nombre');
    if (i >= 0) holder = cells.slice(i + 1).find(Boolean) || '';
  }
  const account = (EXCHANGES[found.sheet].accounts || []).find(a => a.match.test(holder));
  const sheet = account?.sheet || found.sheet;
  const exchangeName = account?.name || EXCHANGES[found.sheet].name;
  // Fuso: no título da coluna (Bybit "Time (UTC-04:00)") ou no cabeçalho (Binance "Período(UTC--4)")
  const offset =
    utcOffset(rows[headerRow][cols.date]) ??
    rows.slice(0, headerRow).flat().map(utcOffset).find(o => o !== null) ??
    BOLIVIA_OFFSET;

  const orders = [];
  for (const cells of rows.slice(headerRow + 1)) {
    const get = key => cells?.[cols[key]] ?? '';
    const date = exchangeDate(get('date'), offset);
    const amount = plainNumber(get('amount'));
    if (!get('order') || !date || !Number.isFinite(amount) || !amount) continue;
    const fee = ['fee', 'makerFee', 'takerFee'].reduce((s, k) => s + (cols[k] !== undefined ? plainNumber(get(k)) || 0 : 0), 0);
    orders.push({
      order: get('order'),
      date,
      side: normalized(SIDES, get('side')),
      currency: get('currency').toUpperCase(),
      amount,
      price: plainNumber(get('price')),
      usdt: plainNumber(get('usdt')),
      fee,
      counterparty: get('counterparty'),
      status: normalized(STATUSES, get('status'))
    });
  }
  return { sheet, name: holder ? `${exchangeName} – ${holder}` : exchangeName, orders };
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

// Mesmo histórico, mas separando compra (ask: quanto se paga por 1 USDT) e venda (bid: quanto se
// recebe), média das corretoras → { BRL: { buy: [[t, preço]], sell: [...] }, BOB: ... }.
// É o "mercado" contra o qual as ordens P2P são comparadas: compra com ask, venda com bid.
function sideHistoryFromSnapshots(snapshots) {
  const history = {};
  const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  for (const s of snapshots) {
    for (const [currency, sources] of Object.entries(s.prices || {})) {
      for (const side of ['buy', 'sell']) {
        const p = avg((sources || []).map(x => parseFloat(x[side])).filter(Number.isFinite));
        if (p) (((history[currency] ||= {})[side]) ||= []).push([+s.time, p]);
      }
    }
  }
  for (const sides of Object.values(history)) for (const points of Object.values(sides)) points.sort((a, b) => a[0] - b[0]);
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

function kindOf(buffer) {
  const head = buffer.subarray(0, 200).toString('utf8');
  if (head.startsWith('Histórico de preços do USDT')) return 'cotacoes';
  if (/^﻿?data;movimento;/i.test(head)) return 'picpay';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'xlsx'; // zip
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) return 'xls'; // Excel antigo (exportação da Bybit)
  throw new Error(`formato não reconhecido (esperado .xlsx, .xls, extrato PicPay .csv ou cotações .txt)`);
}

async function isExchange(buffer) {
  return Boolean(findExchangeHeader(await sheetRows(buffer)));
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
  const rawP2P = {}; // BYBIT/BNB → ordens vindas da exportação da exchange (Nº de orden → ordem)
  const snapshots = [];
  const sources = [];
  const erros = []; // um arquivo com formato estranho nao pode derrubar os outros que estavam certos
  let relatorio = null;

  for (const { name, buffer } of files) {
    try {
      const kind = kindOf(buffer);
      if (kind === 'cotacoes') {
        snapshots.push(...readQuotesTxt(buffer.toString('utf8')));
        sources.push(`${name}: cotações`);
      } else if (kind === 'xls' || (kind === 'xlsx' && (await isExchange(buffer)))) {
        const rows = await sheetRows(buffer);
        const found = findExchangeHeader(rows);
        if (!found) throw new Error('arquivo .xls sem as colunas do histórico P2P da Bybit (Order No., Direction, Fiat Amount, ...)');
        const { sheet, name: exchange, orders } = readExchange(rows, found);
        const byOrder = (rawP2P[sheet] ||= new Map());
        orders.forEach(o => byOrder.set(o.order, o)); // exportações sobrepostas não duplicam ordens
        const done = orders.filter(o => o.status === 'Completado').length;
        sources.push(`${name}: ${sheet} – ${exchange} (${orders.length} ordens, ${done} completadas)`);
      } else if (kind === 'picpay') {
        const { sheet, rows } = readPicpay(buffer.toString('utf8'));
        raw[sheet] = (raw[sheet] || []).concat(rows);
        sources.push(`${name}: ${sheet} (${rows.length} lançamentos)`);
      } else if (await isEconomico(buffer)) {
        const { sheet, holder, rows } = await readEconomico(buffer);
        raw[sheet] = (raw[sheet] || []).concat(rows);
        sources.push(`${name}: ${sheet} – ${holder} (${rows.length} lançamentos)`);
      } else if ((await isFiducia(buffer)) || (await isFiduciaRaw(buffer))) {
        const { sheet, rows } = (await isFiducia(buffer)) ? await readFiducia(buffer) : await readFiduciaRaw(buffer);
        raw[sheet] = (raw[sheet] || []).concat(rows);
        sources.push(`${name}: ${sheet} (${rows.length} lançamentos)`);
      } else if (await isPicpayXlsx(buffer)) {
        const { sheet, rows } = await readPicpayXlsx(buffer);
        raw[sheet] = (raw[sheet] || []).concat(rows);
        sources.push(`${name}: ${sheet} (${rows.length} lançamentos)`);
      } else {
        relatorio = await parseRelatorio(buffer);
        sources.push(`${name}: planilha (${relatorio.sheets.join(', ')})`);
      }
    } catch (error) {
      erros.push(`${name}: ${error.message}`);
    }
  }
  if (erros.length) sources.push(...erros.map(e => `⚠ ${e}`));

  // O mesmo filtro nos extratos crus e nos da planilha mantém os dois na mesma ordem
  for (const sheet of Object.keys(raw)) raw[sheet] = raw[sheet].filter(r => inPeriod(r.date));
  for (const sheet of Object.keys(rawP2P)) rawP2P[sheet] = [...rawP2P[sheet].values()].filter(o => inPeriod(o.date));
  if (relatorio) {
    relatorio.bank = relatorio.bank.filter(t => inPeriod(t.date));
    relatorio.p2p = relatorio.p2p.filter(o => inPeriod(o.date));
  }
  if (desde || hasta) sources.push(`período: ${desde || 'início'} a ${hasta || 'fim'}`);

  const generated = Object.keys(raw).length + Object.keys(rawP2P).length > 0;
  if (!generated) {
    if (!relatorio) {
      const detalhe = erros.length ? ` — ${erros.join('; ')}` : '';
      throw new Error(`Nenhum extrato enviado${detalhe}`);
    }
    return { ...relatorio, history: historyFromSnapshots(snapshots), market: sideHistoryFromSnapshots(snapshots), sources, generated };
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

  // Ordens P2P: a exportação crua substitui a aba da planilha (todas as ordens, em ordem de hora,
  // inclusive as canceladas); a referência antiga é traduzida pelo Nº de orden
  const p2p = [];
  const p2pRows = new Map(); // "BYBIT:7" (planilha antiga) → 9 (planilha gerada)
  const fromRelatorioP2P = relatorio?.p2p || [];
  for (const sheet of new Set([...fromRelatorioP2P.map(o => o.sheet), ...Object.keys(rawP2P)])) {
    const old = fromRelatorioP2P.filter(o => o.sheet === sheet).sort((a, b) => a.row - b.row);
    const orders = rawP2P[sheet] ? [...rawP2P[sheet]].sort((a, b) => a.date - b.date) : old;
    const newRow = new Map(orders.map((o, i) => [o.order, i + 2]));
    for (const o of old) if (newRow.has(o.order)) p2pRows.set(`${sheet}:${o.row}`, newRow.get(o.order));
    orders.forEach((o, i) => p2p.push({ ...o, id: `${sheet}#${o.order}`, sheet, row: i + 2 }));
  }

  const linked = new Map();
  for (const [key, link] of relatorio?.linked || []) {
    const newRow = renumber.get(key) ?? p2pRows.get(key);
    if (newRow) linked.set(`${key.split(':')[0]}:${newRow}`, link);
  }

  return { bank, p2p, linked, history: historyFromSnapshots(snapshots), market: sideHistoryFromSnapshots(snapshots), sources, generated };
}

module.exports = { parseFiles, historyFromSnapshots, sideHistoryFromSnapshots, readQuotesTxt };
