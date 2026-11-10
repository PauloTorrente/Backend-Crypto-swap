// Lê as abas de extrato do "Relatorio de lucro" (.xlsx) e devolve os lançamentos num formato único.
// As colunas são achadas pelo título da linha 1, então mudar a ordem das colunas não quebra nada.
const ExcelJS = require('exceljs');

// Contas bancárias: cada lançamento vira uma possível perna de câmbio
const BANKS = {
  ECOPF: { currency: 'BOB', date: 'Fecha y hora', amount: 'Monto (Bs)', type: 'Transacción', counterparty: 'Nota / Contraparte' },
  ECOPJ: { currency: 'BOB', date: 'Fecha y hora', amount: 'Monto (Bs)', type: 'Transacción', counterparty: 'Nota / Contraparte' },
  FIDU: { currency: 'BRL', date: 'Data', amount: 'Valor (R$)', type: 'Tipo', counterparty: 'Contraparte' },
  PICPAY: { currency: 'BRL', date: 'Data', amount: 'Valor (BRL)', type: 'Movimento', counterparty: 'Descrição' }
};

// Ordens P2P: dão a cotação do USDT do dia e explicam lançamentos que não são câmbio.
// BNB = Binance da empresa (JOAO SOLUCOES, BRL); BNBPF = Binance pessoal (João Alonso, BOB)
const P2P = {
  BYBIT: { name: 'Bybit', date: 'Fecha y hora', order: 'Nº de orden', side: 'Tipo', fiat: 'Fiat', amount: 'Monto fiat', price: 'Precio (fiat/USDT)', usdt: 'Cantidad USDT', counterparty: 'Contraparte', status: 'Estado' },
  BNB: { name: 'Binance', date: 'Fecha y hora', order: 'Nº de orden', side: 'Tipo', fiat: 'Fiat', amount: 'Total BRL', price: 'Precio (BRL/USDT)', usdt: 'Cantidad USDT', counterparty: 'Contraparte', status: 'Estado' },
  BNBPF: { name: 'Binance PF', date: 'Fecha y hora', order: 'Nº de orden', side: 'Tipo', fiat: 'Fiat', amount: 'Monto fiat', price: 'Precio (fiat/USDT)', usdt: 'Cantidad USDT', counterparty: 'Contraparte', status: 'Estado' }
};

const value = cell => {
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result; // fórmula
    if ('richText' in v) return v.richText.map(t => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
};

const num = v => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// O Excel guarda datas sem fuso; o exceljs devolve como UTC, então lemos tudo em UTC
const asDate = v => (v instanceof Date && !isNaN(v) ? v : null);

function readSheet(ws, columns) {
  const header = {};
  ws.getRow(1).eachCell((cell, col) => {
    header[String(value(cell) ?? '').trim()] = col;
  });
  const missing = Object.values(columns).filter(title => !header[title]);
  if (missing.length) throw new Error(`Aba ${ws.name}: faltam as colunas ${missing.join(', ')}`);

  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r = { row: n };
    for (const [key, title] of Object.entries(columns)) r[key] = value(row.getCell(header[title]));
    rows.push(r);
  });
  return { header, rows };
}

function parseBank(ws, sheet, cfg) {
  const { currency, ...columns } = cfg;
  const { header, rows } = readSheet(ws, columns);
  const letter = ws.getColumn(header[columns.amount]).letter;

  return rows
    .map(r => {
      const date = asDate(r.date);
      const amount = num(r.amount);
      if (!date || !amount) return null;
      return {
        id: `${sheet}!${letter}${r.row}`, // vira a fórmula na aba Cambios (ex.: =PICPAY!E3)
        sheet,
        row: r.row,
        currency,
        date,
        // FIDU e PICPAY só têm o dia; ECOPF/ECOPJ têm a hora
        hasTime: date.getUTCHours() + date.getUTCMinutes() + date.getUTCSeconds() > 0,
        amount,
        type: String(r.type ?? '').trim(),
        counterparty: String(r.counterparty ?? '').trim()
      };
    })
    .filter(Boolean);
}

function parseP2P(ws, sheet, { name, ...cfg }) {
  return readSheet(ws, cfg)
    .rows.map(r => {
      const date = asDate(r.date);
      const amount = num(r.amount);
      if (!date || !amount || String(r.status).trim() !== 'Completado') return null;
      return {
        id: `${sheet}#${r.order}`,
        sheet,
        row: r.row,
        order: String(r.order),
        date,
        side: String(r.side).trim(), // Compra = pagamos fiat; Venta = recebemos fiat
        currency: String(r.fiat).trim().toUpperCase(),
        amount,
        price: num(r.price),
        usdt: num(r.usdt),
        counterparty: String(r.counterparty ?? '').trim(),
        status: 'Completado'
      };
    })
    .filter(Boolean);
}

// Abas que já apontam para lançamentos dos extratos (fórmulas tipo =PICPAY!E3+PICPAY!E4).
// Esses lançamentos já foram classificados à mão e ficam fora da sugestão.
const LINKING_SHEETS = ['Cambios', 'P2P', 'GASTOS'];

// Na aba Cambios, de que lado do câmbio está cada referência
const CAMBIOS_SIDES = { 'Monto recibido': 'recibido', 'Monto entregado': 'entregado' };

function linkedRows(wb) {
  const linked = new Map(); // "PICPAY:3" ou "BYBIT:7" → { aba: 'Cambios', fila: 12, lado: 'recibido' }
  const ref = new RegExp(`(${[...Object.keys(BANKS), ...Object.keys(P2P)].join('|')})!\\$?[A-Z]+\\$?(\\d+)`, 'g');
  for (const name of LINKING_SHEETS) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const sides = {};
    ws.getRow(1).eachCell((cell, col) => {
      const side = CAMBIOS_SIDES[String(value(cell) ?? '').trim()];
      if (name === 'Cambios' && side) sides[col] = side;
    });
    ws.eachRow(row =>
      row.eachCell((cell, col) => {
        const v = cell.value;
        const formula = v && typeof v === 'object' && (v.formula || v.sharedFormula);
        if (!formula) return;
        for (const [, sheet, n] of formula.matchAll(ref)) {
          const key = `${sheet}:${n}`;
          if (!linked.has(key)) linked.set(key, { aba: name, fila: row.number, lado: sides[col] || null });
        }
      })
    );
  }
  return linked;
}

// buffer: conteúdo do .xlsx → { bank: [...], p2p: [...], linked: Map, sheets: [nomes lidos] }
async function parseRelatorio(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('O arquivo não é um .xlsx válido');
  }

  const bank = [];
  const p2p = [];
  const sheets = [];
  for (const [name, cfg] of Object.entries(BANKS)) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    bank.push(...parseBank(ws, name, cfg));
    sheets.push(name);
  }
  for (const [name, cfg] of Object.entries(P2P)) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    p2p.push(...parseP2P(ws, name, cfg));
    sheets.push(name);
  }
  if (!bank.length) throw new Error(`Nenhum extrato encontrado (abas esperadas: ${Object.keys(BANKS).join(', ')})`);
  return { bank, p2p, linked: linkedRows(wb), sheets };
}

module.exports = { parseRelatorio, BANKS, P2P };
