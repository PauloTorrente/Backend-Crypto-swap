// Gera o "Relatorio de lucro" preenchido: a aba Resumo (com gráficos), as abas dos extratos (na
// mesma numeração usada nas fórmulas), a aba Cambios com as fórmulas apontando para elas, a aba
// P2P, a aba Validación P2P (ordens × banco × mercado) e a aba Pendientes.
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
const EXCHANGE_NAMES = Object.fromEntries(Object.entries(P2P).map(([sheet, c]) => [sheet, c.name]));
const fill = argb => (argb ? { type: 'pattern', pattern: 'solid', fgColor: { argb } } : undefined);
const GREEN = 'FFD9F2D9';
const YELLOW = 'FFFFF4CC';
const RED = 'FFF8D7DA';
const BANK_COLORS = { Conciliada: GREEN, 'Falta extracto': YELLOW, 'Otra moneda': YELLOW, 'Sin movimiento en banco': RED };
const MARKET_COLORS = { OK: GREEN, 'Sin cotización': YELLOW, 'Revisar (muy distinto)': YELLOW, Desfavorable: RED };

// Aba "Validación P2P": resumo em cima e uma linha por ordem completada; no fim, as ordens
// canceladas que têm o valor no banco
const VALIDATION_HEADER_ROW = 9;
function writeValidacion(ws, v) {
  const r = v.resumen;
  const lines = [
    ['Validación de las órdenes P2P', null],
    ['Órdenes completadas', r.ordenes],
    ['Banco ↔ exchange', Object.entries(r.banco).map(([k, n]) => `${k}: ${n}`).join(' · ')],
    ['Exchange ↔ mercado', ['OK', 'Desfavorable', 'Revisar (muy distinto)', 'Sin cotización'].filter(k => r.mercado[k]).map(k => `${k}: ${r.mercado[k]}`).join(' · ')],
    ['Referencia de precio', `cotización de mercado en la hora: ${r.mercado.contra_mercado} · mediana de las propias órdenes: ${r.mercado.contra_mediana}`],
    ['Costo frente al mercado (USDT)', r.mercado.costo_desfavorable_usdt],
    ['Canceladas con movimiento en banco', r.canceladas_con_movimiento]
  ];
  lines.forEach(([label, value], i) => {
    const row = ws.getRow(i + 1);
    row.values = [label, value];
    row.getCell(1).font = { bold: true, size: i ? 11 : 14 };
  });

  const headers = [
    ['Orden', 22], ['Exchange', 10], ['Fecha', 18], ['Tipo', 8], ['Moneda', 8], ['Monto fiat', 13], ['Precio', 9],
    ['USDT', 11], ['Contraparte', 22], ['Banco', 26], ['Validación banco', 22], ['Detalle', 44],
    ['Precio mercado', 11], ['Referencia', 26], ['Desvío', 9], ['Costo USDT', 11], ['Validación mercado', 20]
  ];
  headers.forEach(([, width], i) => (ws.getColumn(i + 1).width = width));
  const header = ws.getRow(VALIDATION_HEADER_ROW);
  header.values = headers.map(([h]) => h);
  header.font = { bold: true };

  // Primeiro o que precisa de atenção
  const order = { 'Sin movimiento en banco': 0, 'Falta extracto': 2, 'Otra moneda': 3, Conciliada: 4 };
  const rank = o => order[o.banco_estado] - (o.mercado_estado === 'Desfavorable' ? 1 : 0);
  const rows = [...v.ordenes].sort((a, b) => rank(a) - rank(b) || a.fecha.localeCompare(b.fecha));
  rows.forEach((o, i) => {
    const row = ws.getRow(VALIDATION_HEADER_ROW + 1 + i);
    row.values = [
      { formula: o.ref, result: o.orden }, o.exchange, new Date(o.fecha), o.tipo, o.moneda, o.monto, o.precio, o.usdt, o.contraparte,
      o.banco ? { formula: o.banco, result: o.monto * (o.tipo === 'Compra' ? -1 : 1) } : null,
      o.banco_estado, o.banco_detalle, o.mercado, o.mercado_fuente, o.desvio, o.costo_usdt, o.mercado_estado
    ];
    row.getCell(3).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(6).numFmt = '#,##0.00';
    row.getCell(10).numFmt = '#,##0.00';
    row.getCell(15).numFmt = '0.00%';
    row.getCell(11).fill = fill(BANK_COLORS[o.banco_estado]);
    row.getCell(17).fill = fill(MARKET_COLORS[o.mercado_estado]);
  });
  const lastRow = VALIDATION_HEADER_ROW + rows.length;
  ws.autoFilter = { from: { row: VALIDATION_HEADER_ROW, column: 1 }, to: { row: lastRow, column: headers.length } };

  if (!v.canceladas.length) return;
  const start = lastRow + 3;
  ws.getRow(start).values = ['Órdenes canceladas con el valor en el banco (revisar: el dinero se movió aunque la orden se canceló)'];
  ws.getRow(start).font = { bold: true, color: { argb: 'FFC0504D' } };
  const cHeader = ws.getRow(start + 1);
  cHeader.values = ['Orden', 'Exchange', 'Fecha', 'Tipo', 'Moneda', 'Monto fiat', 'Estado', null, 'Contraparte', 'Banco', 'Nombre en el banco'];
  cHeader.font = { bold: true };
  v.canceladas.forEach((o, i) => {
    const row = ws.getRow(start + 2 + i);
    row.values = [
      { formula: o.ref, result: o.orden }, o.exchange, new Date(o.fecha), o.tipo, o.moneda, o.monto, o.estado, null, o.contraparte,
      { formula: o.banco, result: o.monto * (o.tipo === 'Compra' ? -1 : 1) }, o.banco_contraparte
    ];
    row.getCell(3).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(7).fill = fill(RED);
  });
}
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
  // Lançamento identificado como ordem P2P: exchange, lado, apelido e nº da ordem
  const orders = new Map(parsed.p2p.map(o => [o.id, o]));
  for (const m of result.p2p) {
    const o = orders.get(m.order);
    const label = o ? `P2P ${EXCHANGE_NAMES[o.sheet] || o.sheet} ${o.side} ${o.counterparty} #${o.order}` : `P2P ${m.order}`;
    for (const id of m.banks || [m.bank]) use.set(id, label);
  }
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

  // Ordens P2P (abas BYBIT/BNB/BNBPF na numeração usada pelo matcher, inclusive as canceladas), com o
  // resultado da validação ao lado
  const checks = new Map((result.validacion?.ordenes || []).map(v => [v.id, v]));
  for (const sheet of Object.keys(P2P)) {
    const sheetOrders = parsed.p2p.filter(o => o.sheet === sheet);
    if (!sheetOrders.length) continue;
    const c = P2P[sheet];
    const ws = wb.addWorksheet(sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [c.date, c.order, c.side, c.fiat, c.amount, c.price, c.usdt, c.counterparty, c.status, 'Comisión (USDT)', 'Banco', 'Validación banco', 'Mercado', 'Desvío vs mercado']
      .map(header => ({ header, width: 16 }));
    for (const o of sheetOrders) {
      const v = checks.get(o.id);
      const row = ws.getRow(o.row);
      row.values = [
        o.date, o.order, o.side, o.currency, o.amount, o.price, o.usdt, o.counterparty, o.status, o.fee ?? null,
        v?.banco ? { formula: v.banco, result: o.amount * (o.side === 'Compra' ? -1 : 1) } : null,
        v?.banco_estado ?? null,
        v?.mercado ?? null,
        v?.desvio ?? null
      ];
      row.getCell(1).numFmt = 'dd/mm/yyyy hh:mm:ss';
      row.getCell(14).numFmt = '0.00%';
      if (v) row.getCell(12).fill = fill(BANK_COLORS[v.banco_estado]);
      if (v) row.getCell(14).fill = fill(MARKET_COLORS[v.mercado_estado]);
    }
    bold(ws);
    ws.autoFilter = { from: 'A1', to: 'N1' };
  }

  if (result.validacion) writeValidacion(wb.addWorksheet('Validación P2P', { views: [{ state: 'frozen', ySplit: VALIDATION_HEADER_ROW }] }), result.validacion);

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
