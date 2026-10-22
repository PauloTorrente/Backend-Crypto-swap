// Gera o "Relatorio de lucro" preenchido: a aba Resumo (com gráficos), as abas dos extratos (na
// mesma numeração usada nas fórmulas), a aba Cambios com as fórmulas apontando para elas, a aba
// P2P e a aba Pendientes.
const ExcelJS = require('exceljs');
const { BANKS, P2P } = require('./conciliacion.parser');
const { writeResumo } = require('./conciliacion.summary');
const { addCharts } = require('./conciliacion.charts');

// Cabeçalhos iguais aos do parser, para a planilha gerada poder ser enviada de novo
const BANK_COLUMNS = sheet => {
  const c = BANKS[sheet];
  return [
    { header: c.date, key: 'date', width: 20, style: { numFmt: 'dd/mm/yyyy hh:mm:ss' } },
    { header: c.type, key: 'type', width: 34 },
    { header: c.counterparty, key: 'counterparty', width: 60 },
    { header: c.amount, key: 'amount', width: 14, style: { numFmt: '#,##0.00' } }, // coluna D
    { header: 'Saldo', key: 'balance', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Uso', key: 'use', width: 24 }
  ];
};

const CAMBIOS_COLUMNS = [
  ['ID', 10], ['Fecha', 12], ['Cliente', 30], ['Moneda recibida', 10], ['Monto recibido', 14],
  ['Moneda entregada', 10], ['Monto entregado', 14], ['Precio USDT recibida (opcional)', 12],
  ['Precio USDT entregada (opcional)', 12], ['Nota', 60], ['Par', 10],
  ['Tasa aplicada (entregado / recibido)', 12], ['Precio USDT recibida usado', 12],
  ['Precio USDT entregada usado', 12], ['Recibido en USDT', 12], ['Entregado en USDT', 12],
  ['Utilidad USDT', 12], ['Margen %', 10], ['Utilidad R$', 12]
];

const asUtcDate = iso => new Date(`${iso}T00:00:00Z`);
const bold = ws => (ws.getRow(1).font = { bold: true });

async function buildWorkbook(parsed, result) {
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true; // recalcula as fórmulas ao abrir
  const resumo = wb.addWorksheet('Resumo'); // primeira aba; preenchida no fim, quando as outras existem

  // Uso de cada lançamento, para a coluna "Uso" dos extratos
  const use = new Map();
  result.cambios.forEach((c, i) =>
    [...c.recibido.lancamentos, ...c.entregado.lancamentos].forEach(l => use.set(l.id, `Cambios fila ${i + 2} (${c.confianza})`))
  );
  for (const m of result.p2p) use.set(m.bank, `P2P ${m.order}`);
  for (const e of result.excluidos) if (!use.has(e.id)) use.set(e.id, e.motivo);
  for (const p of result.pendientes) use.set(p.id, 'Pendiente');

  // Cambios
  const cambios = wb.addWorksheet('Cambios', { views: [{ state: 'frozen', ySplit: 1 }] });
  cambios.columns = CAMBIOS_COLUMNS.map(([header, width]) => ({ header, width }));
  result.cambios.forEach((c, i) => {
    const r = i + 2;
    const row = cambios.getRow(r);
    // Valores já calculados vão junto com as fórmulas, para quem abrir sem recalcular
    const received = c.recibido.monto;
    const delivered = -c.entregado.monto;
    const receivedUsdt = received / c.precio_usdt_recibida;
    const deliveredUsdt = delivered / c.precio_usdt_entregada;
    const brlPrice = c.recibido.moneda === 'BRL' ? c.precio_usdt_recibida : c.precio_usdt_entregada;
    row.values = [
      `AUTO-${i + 1}`,
      asUtcDate(c.fecha),
      c.cliente,
      c.recibido.moneda,
      { formula: c.recibido.formula.slice(1), result: received },
      c.entregado.moneda,
      { formula: c.entregado.formula.slice(1), result: delivered }, // já é negativo (saída)
      c.precio_usdt_recibida,
      c.precio_usdt_entregada,
      `${c.confianza}: ${c.motivos.join(', ')} · cotação: ${c.precio_fuente}`,
      { formula: `D${r}&"→"&F${r}`, result: `${c.recibido.moneda}→${c.entregado.moneda}` },
      { formula: `IFERROR(G${r}/E${r},"")`, result: delivered / received },
      { formula: `H${r}`, result: c.precio_usdt_recibida },
      { formula: `I${r}`, result: c.precio_usdt_entregada },
      { formula: `E${r}/M${r}`, result: receivedUsdt },
      { formula: `G${r}/N${r}`, result: deliveredUsdt },
      { formula: `O${r}+P${r}`, result: receivedUsdt + deliveredUsdt },
      { formula: `IFERROR(Q${r}/O${r},"")`, result: (receivedUsdt + deliveredUsdt) / receivedUsdt },
      // Lucro em reais: utilidad USDT × preço do USDT em BRL (do lado que for BRL)
      { formula: `Q${r}*IF(D${r}="BRL",H${r},I${r})`, result: (receivedUsdt + deliveredUsdt) * brlPrice }
    ];
    row.getCell(2).numFmt = 'dd/mm/yyyy';
    row.getCell(18).numFmt = '0.00%';
    for (const col of [5, 7, 15, 16, 17, 19]) row.getCell(col).numFmt = '#,##0.00';
    const color = { alta: 'FFD9F2D9', media: 'FFFFF4CC', baixa: 'FFF8D7DA' }[c.confianza];
    row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });
  bold(cambios);

  // Extratos
  const bySheet = new Map();
  for (const t of parsed.bank) {
    if (!bySheet.has(t.sheet)) bySheet.set(t.sheet, []);
    bySheet.get(t.sheet).push(t);
  }
  for (const sheet of Object.keys(BANKS)) {
    const txs = bySheet.get(sheet);
    if (!txs) continue;
    const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = BANK_COLUMNS(sheet);
    for (const t of txs.sort((a, b) => a.row - b.row)) {
      ws.getRow(t.row).values = [t.date, t.type, t.counterparty, t.amount, t.balance ?? null, use.get(t.id) || ''];
    }
    bold(ws);
  }

  // Ordens P2P (cópia das abas BYBIT/BNB recebidas, na numeração usada pelo matcher)
  for (const sheet of Object.keys(P2P)) {
    const orders = parsed.p2p.filter(o => o.sheet === sheet);
    if (!orders.length) continue;
    const c = P2P[sheet];
    const ws = wb.addWorksheet(sheet);
    ws.columns = [c.date, c.order, c.side, c.fiat, c.amount, c.price, c.usdt, c.counterparty, c.status].map(header => ({ header, width: 16 }));
    for (const o of orders) {
      ws.getRow(o.row).values = [o.date, o.order, o.side, o.currency, o.amount, o.price, o.usdt, o.counterparty, 'Completado'];
      ws.getRow(o.row).getCell(1).numFmt = 'dd/mm/yyyy hh:mm:ss';
    }
    bold(ws);
  }

  // P2P ↔ banco
  const p2p = wb.addWorksheet('P2P');
  p2p.columns = ['Orden', 'Tipo', 'Moneda fiat', 'Monto fiat (banco)', 'Monto fiat (orden)', 'Contraparte'].map(header => ({ header, width: 22 }));
  result.p2p.forEach((m, i) => {
    // A ordem aponta para a aba BYBIT/BNB (coluna B = Nº de orden), assim a planilha reenviada já sabe que está ligada
    p2p.getRow(i + 2).values = [{ formula: m.orderRef, result: m.order.split('#')[1] }, m.side, m.currency, { formula: m.bank }, m.amount, m.contraparte];
  });
  bold(p2p);

  // O que sobrou para olhar à mão
  const pend = wb.addWorksheet('Pendientes');
  pend.columns = [['Lançamento', 16], ['Fecha', 20], ['Moneda', 8], ['Monto', 14], ['Contraparte', 60]].map(([header, width]) => ({ header, width }));
  result.pendientes.forEach((p, i) => {
    pend.getRow(i + 2).values = [{ formula: p.id, result: p.monto }, new Date(p.fecha), p.moneda, p.monto, p.contraparte];
    pend.getRow(i + 2).getCell(2).numFmt = 'dd/mm/yyyy hh:mm';
  });
  bold(pend);

  const charts = writeResumo(resumo, parsed, result, use);
  return addCharts(Buffer.from(await wb.xlsx.writeBuffer()), 1, charts);
}

module.exports = { buildWorkbook };
