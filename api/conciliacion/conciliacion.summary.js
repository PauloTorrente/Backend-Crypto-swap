// Aba "Resumo" da planilha gerada, no estilo do relatório de setembro: indicadores no topo, tabela
// diária, de onde veio cada lançamento, confiança, principais clientes e gráficos.
// As células são fórmulas sobre as abas Cambios e dos extratos (se alguém corrigir um câmbio, o
// resumo acompanha) e já levam o valor calculado, para aparecer mesmo sem recalcular.
const { BANKS } = require('./conciliacion.parser');

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const COLORS = { blue: '2F6EBA', green: '3A9D5D', orange: 'E08A2E', gray: '8C8C8C', red: 'C0504D', purple: '7E57C2', teal: '2A9D8F' };
const HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const CARD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F6FB' } };

// Destino de cada lançamento, pelo texto da coluna "Uso" dos extratos
const DESTINATIONS = [
  ['Câmbio', '*Cambios*', COLORS.blue],
  ['P2P (Bybit/Binance)', '*P2P*', COLORS.teal],
  ['Tarifa bancária', 'tarifa', COLORS.gray],
  ['Entre contas próprias', 'conta própria', COLORS.purple],
  ['Comércio / sem nome', 'comércio/sem nome', COLORS.orange],
  ['Gastos', '*GASTOS*', 'B8860B'],
  ['Pendiente', 'Pendiente', COLORS.red]
];

const matches = (text, pattern) =>
  pattern.startsWith('*') ? text.includes(pattern.slice(1, -1)) : text === pattern;

const dayKey = d => d.toISOString().slice(0, 10);
const utcDay = key => new Date(`${key}T00:00:00Z`);
const sum = xs => xs.reduce((a, b) => a + b, 0);

function cambioValues(c) {
  const receivedUsdt = c.recibido.monto / c.precio_usdt_recibida;
  const deliveredUsdt = c.entregado.monto / c.precio_usdt_entregada;
  const brlPrice = c.recibido.moneda === 'BRL' ? c.precio_usdt_recibida : c.precio_usdt_entregada;
  const bobPrice = c.recibido.moneda === 'BOB' ? c.precio_usdt_recibida : c.precio_usdt_entregada;
  return {
    receivedUsdt,
    profitUsdt: receivedUsdt - deliveredUsdt,
    profitBrl: (receivedUsdt - deliveredUsdt) * brlPrice,
    brlIn: c.recibido.moneda === 'BRL' ? c.recibido.monto : 0,
    brlOut: c.entregado.moneda === 'BRL' ? c.entregado.monto : 0,
    bobPerBrl: bobPrice / brlPrice
  };
}

// use: Map id do lançamento → texto da coluna "Uso"
function writeResumo(ws, parsed, result, use) {
  const nCambios = Math.max(result.cambios.length, 1);
  const last = nCambios + 1;
  const col = letter => `Cambios!$${letter}$2:$${letter}$${last}`;

  const sheetRows = {};
  for (const t of parsed.bank) sheetRows[t.sheet] = Math.max(sheetRows[t.sheet] || 1, t.row);
  const bankSheets = Object.keys(BANKS).filter(s => sheetRows[s]);
  const brlSheets = bankSheets.filter(s => BANKS[s].currency === 'BRL');
  const range = (sheet, letter) => `${sheet}!$${letter}$2:$${letter}$${sheetRows[sheet]}`;

  // ---------- números em JS (cache das fórmulas e dos gráficos) ----------
  const values = result.cambios.map(c => ({ c, ...cambioValues(c) }));
  const days = [...new Set(parsed.bank.map(t => dayKey(t.date)))].sort();
  const daily = days.map(day => {
    const cs = values.filter(v => v.c.fecha === day);
    const txs = parsed.bank.filter(t => dayKey(t.date) === day);
    const pending = txs.filter(t => use.get(t.id) === 'Pendiente').length;
    return {
      day,
      count: cs.length,
      profitUsdt: sum(cs.map(v => v.profitUsdt)),
      profitBrl: sum(cs.map(v => v.profitBrl)),
      brlIn: sum(cs.map(v => v.brlIn)),
      brlOut: sum(cs.map(v => v.brlOut)),
      margin: sum(cs.map(v => v.receivedUsdt)) ? sum(cs.map(v => v.profitUsdt)) / sum(cs.map(v => v.receivedUsdt)) : 0,
      txs: txs.length,
      pending,
      auto: txs.length ? 1 - pending / txs.length : 0,
      rate: cs.length ? sum(cs.map(v => v.bobPerBrl)) / cs.length : null
    };
  });
  let acc = 0;
  for (const d of daily) d.cumulative = acc += d.profitBrl;

  const fees = -sum(parsed.bank.filter(t => BANKS[t.sheet].currency === 'BRL' && use.get(t.id) === 'tarifa').map(t => t.amount));
  const total = {
    profitBrl: sum(values.map(v => v.profitBrl)),
    profitUsdt: sum(values.map(v => v.profitUsdt)),
    brlIn: sum(values.map(v => v.brlIn)),
    brlOut: sum(values.map(v => v.brlOut)),
    margin: sum(values.map(v => v.receivedUsdt)) ? sum(values.map(v => v.profitUsdt)) / sum(values.map(v => v.receivedUsdt)) : 0,
    txs: parsed.bank.length,
    pending: result.pendientes.length
  };
  const byConfidence = ['alta', 'media', 'baixa'].map(level => {
    const vs = values.filter(v => v.c.confianza === level);
    return { level, count: vs.length, profitBrl: sum(vs.map(v => v.profitBrl)) };
  });
  const destinations = DESTINATIONS.map(([label, pattern, color]) => ({
    label,
    pattern,
    color,
    count: parsed.bank.filter(t => matches(use.get(t.id) || '', pattern)).length
  })).filter(d => d.count > 0);
  const clients = [...values.reduce((m, v) => m.set(v.c.cliente, [...(m.get(v.c.cliente) || []), v]), new Map())]
    .map(([name, vs]) => ({ name, count: vs.length, profitBrl: sum(vs.map(v => v.profitBrl)), profitUsdt: sum(vs.map(v => v.profitUsdt)) }))
    .sort((a, b) => b.profitBrl - a.profitBrl)
    .slice(0, 10);

  // ---------- título ----------
  const monthCount = days.reduce((m, d) => m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) || 0) + 1), new Map());
  const [mainMonth] = [...monthCount].sort((a, b) => b[1] - a[1])[0] || ['—'];
  const [year, month] = mainMonth.split('-');
  const fmtDay = d => d.split('-').reverse().join('/');

  ws.columns = [12, 10, 13, 14, 15, 15, 15, 10, 12, 11, 12, 11].map(width => ({ width }));
  ws.getCell('A1').value = `RESUMO — ${MONTHS[+month - 1] || ''} ${year || ''} — conciliação automática`;
  ws.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1F4E78' } };
  ws.getCell('A2').value = `Período: ${fmtDay(days[0] || '')} – ${fmtDay(days.at(-1) || '')} · ${result.cambios.length} câmbios montados automaticamente · gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/La_Paz' })}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF595959' } };

  // ---------- indicadores ----------
  // Tarifas somadas com o sinal do extrato (negativas)
  const feeSum = brlSheets.map(s => `SUMIFS(${range(s, 'D')},${range(s, 'F')},"tarifa")`).join('+') || '0';
  const txCount = bankSheets.map(s => `COUNT(${range(s, 'A')})`).join('+');
  const countAll = pattern => bankSheets.map(s => `COUNTIF(${range(s, 'F')},"${pattern}")`).join('+') || '0';
  const kpis = [
    [['Lucro total (R$)', `SUM(${col('S')})`, total.profitBrl, '#,##0.00'],
     ['Lucro total (USDT)', `SUM(${col('Q')})`, total.profitUsdt, '#,##0.00'],
     ['Resultado líquido (R$)', `A5+${feeSum}`, total.profitBrl - fees, '#,##0.00'],
     ['Câmbios', `COUNTA(${col('A')})`, result.cambios.length, '0'],
     ['Margem média', `IFERROR(SUM(${col('Q')})/SUM(${col('O')}),0)`, total.margin, '0.00%'],
     ['% preenchido automático', 'IFERROR(1-K8/I8,0)', total.txs ? 1 - total.pending / total.txs : 0, '0%']],
    [['Volume R$ recebidos (BRL→BOB)', `SUMIFS(${col('E')},${col('D')},"BRL")`, total.brlIn, '#,##0.00'],
     ['Volume R$ pagos (BOB→BRL)', `-SUMIFS(${col('G')},${col('F')},"BRL")`, total.brlOut, '#,##0.00'],
     ['Tarifas bancárias (R$)', `-(${feeSum})`, fees, '#,##0.00'],
     ['Câmbios a revisar (baixa)', `COUNTIF(${col('J')},"baixa*")`, byConfidence[2].count, '0'],
     ['Lançamentos nos extratos', txCount, total.txs, '0'],
     ['Lançamentos pendentes', countAll('Pendiente'), total.pending, '0']]
  ];

  kpis.forEach((line, li) => {
    const labelRow = 4 + li * 3;
    line.forEach(([label, formula, result, numFmt], i) => {
      const c1 = 1 + i * 2;
      ws.mergeCells(labelRow, c1, labelRow, c1 + 1);
      ws.mergeCells(labelRow + 1, c1, labelRow + 1, c1 + 1);
      const l = ws.getCell(labelRow, c1);
      l.value = label;
      l.font = { size: 9, bold: true, color: { argb: 'FF595959' } };
      const v = ws.getCell(labelRow + 1, c1);
      v.value = { formula, result };
      v.numFmt = numFmt;
      v.font = { size: 15, bold: true, color: { argb: 'FF1F4E78' } };
      for (const r of [labelRow, labelRow + 1]) {
        ws.getCell(r, c1).fill = CARD;
        ws.getCell(r, c1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      }
    });
    ws.getRow(labelRow).height = 26;
    ws.getRow(labelRow + 1).height = 24;
  });

  // ---------- tabela diária ----------
  const headRow = 11;
  const first = headRow + 1;
  const lastDay = headRow + daily.length;
  ws.getCell(headRow - 1, 1).value = 'Por dia — LUCRO = ganho do câmbio, VOLUME = reais movimentados';
  ws.getCell(headRow - 1, 1).font = { bold: true, size: 12 };
  const headers = ['Data', 'Câmbios', 'Lucro USDT', 'Lucro R$', 'Lucro acumulado R$', 'Volume R$ recebidos', 'Volume R$ pagos', 'Margem', 'Lançamentos', 'Pendentes', '% automático', 'Taxa Bs/R$'];
  styleHeader(ws.getRow(headRow), headers);

  const between = (s, r) => `${range(s, 'A')},">="&$A${r},${range(s, 'A')},"<"&($A${r}+1)`;
  daily.forEach((d, i) => {
    const r = first + i;
    const onDay = `${col('B')},$A${r}`;
    ws.getRow(r).values = [
      utcDay(d.day),
      { formula: `COUNTIFS(${onDay})`, result: d.count },
      { formula: `SUMIFS(${col('Q')},${onDay})`, result: d.profitUsdt },
      { formula: `SUMIFS(${col('S')},${onDay})`, result: d.profitBrl },
      { formula: `SUM($D$${first}:$D${r})`, result: d.cumulative },
      { formula: `SUMIFS(${col('E')},${onDay},${col('D')},"BRL")`, result: d.brlIn },
      { formula: `-SUMIFS(${col('G')},${onDay},${col('F')},"BRL")`, result: d.brlOut },
      { formula: `IFERROR(SUMIFS(${col('Q')},${onDay})/SUMIFS(${col('O')},${onDay}),0)`, result: d.margin },
      { formula: bankSheets.map(s => `COUNTIFS(${between(s, r)})`).join('+'), result: d.txs },
      { formula: bankSheets.map(s => `COUNTIFS(${between(s, r)},${range(s, 'F')},"Pendiente")`).join('+'), result: d.pending },
      { formula: `IFERROR(1-J${r}/I${r},0)`, result: d.auto },
      d.rate === null ? null : Math.round(d.rate * 1e4) / 1e4
    ];
    numberFormats(ws.getRow(r), { 1: 'dd/mm/yyyy', 3: '#,##0.00', 4: '#,##0.00', 5: '#,##0.00', 6: '#,##0.00', 7: '#,##0.00', 8: '0.00%', 11: '0%', 12: '0.0000' });
    if (i % 2) ws.getRow(r).eachCell(c => (c.fill = CARD));
  });
  const totalRow = lastDay + 1;
  ws.getRow(totalRow).values = [
    'TOTAL',
    { formula: `SUM(B${first}:B${lastDay})`, result: result.cambios.length },
    { formula: `SUM(C${first}:C${lastDay})`, result: total.profitUsdt },
    { formula: `SUM(D${first}:D${lastDay})`, result: total.profitBrl },
    null,
    { formula: `SUM(F${first}:F${lastDay})`, result: total.brlIn },
    { formula: `SUM(G${first}:G${lastDay})`, result: total.brlOut },
    { formula: `IFERROR(C${totalRow}/SUMIFS(${col('O')},${col('B')},">="&A${first},${col('B')},"<="&A${lastDay}),0)`, result: total.margin },
    { formula: `SUM(I${first}:I${lastDay})`, result: total.txs },
    { formula: `SUM(J${first}:J${lastDay})`, result: total.pending },
    { formula: `IFERROR(1-J${totalRow}/I${totalRow},0)`, result: total.txs ? 1 - total.pending / total.txs : 0 }
  ];
  ws.getRow(totalRow).font = { bold: true };
  numberFormats(ws.getRow(totalRow), { 3: '#,##0.00', 4: '#,##0.00', 6: '#,##0.00', 7: '#,##0.00', 8: '0.00%', 11: '0%' });
  ws.getRow(totalRow).eachCell(c => (c.border = { top: { style: 'thin' } }));

  // ---------- destino dos lançamentos / confiança / clientes ----------
  let r = totalRow + 3;
  ws.getCell(r - 1, 1).value = 'Para onde foi cada lançamento dos extratos';
  ws.getCell(r - 1, 1).font = { bold: true, size: 12 };
  styleHeader(ws.getRow(r), ['Destino', '', 'Lançamentos', '%']);
  const destFirst = r + 1;
  destinations.forEach((d, i) => {
    const row = destFirst + i;
    ws.getCell(row, 1).value = d.label;
    ws.getCell(row, 3).value = { formula: countAll(d.pattern), result: d.count };
    ws.getCell(row, 4).value = { formula: `IFERROR(C${row}/SUM($C$${destFirst}:$C$${destFirst + destinations.length - 1}),0)`, result: d.count / total.txs };
    ws.getCell(row, 4).numFmt = '0%';
  });
  const destLast = destFirst + destinations.length - 1;

  ws.getCell(r - 1, 6).value = 'Confiança dos câmbios automáticos';
  ws.getCell(r - 1, 6).font = { bold: true, size: 12 };
  ['Confiança', 'Câmbios', 'Lucro R$'].forEach((h, i) => headerCell(ws.getCell(r, 6 + i), h));
  const notes = { alta: 'nome igual nos dois extratos', media: 'sobrenome ou valor/hora únicos', baixa: 'revisar antes de fechar o mês' };
  byConfidence.forEach((b, i) => {
    const row = r + 1 + i;
    ws.getCell(row, 6).value = b.level;
    ws.getCell(row, 7).value = { formula: `COUNTIF(${col('J')},"${b.level}*")`, result: b.count };
    ws.getCell(row, 8).value = { formula: `SUMIFS(${col('S')},${col('J')},"${b.level}*")`, result: b.profitBrl };
    ws.getCell(row, 8).numFmt = '#,##0.00';
    ws.getCell(row, 9).value = notes[b.level];
    ws.getCell(row, 9).font = { italic: true, color: { argb: 'FF7F7F7F' } };
    ws.getCell(row, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: { alta: 'FFD9F2D9', media: 'FFFFF4CC', baixa: 'FFF8D7DA' }[b.level] } };
  });

  r = Math.max(destLast, r + 3) + 3;
  ws.getCell(r - 1, 1).value = 'Principais clientes (por lucro)';
  ws.getCell(r - 1, 1).font = { bold: true, size: 12 };
  styleHeader(ws.getRow(r), ['Cliente', '', '', 'Câmbios', 'Lucro R$', 'Lucro USDT']);
  clients.forEach((c, i) => {
    const row = r + 1 + i;
    ws.mergeCells(row, 1, row, 3);
    ws.getCell(row, 1).value = c.name;
    const name = `"${c.name.replace(/"/g, '""')}"`;
    ws.getCell(row, 4).value = { formula: `COUNTIF(${col('C')},${name})`, result: c.count };
    ws.getCell(row, 5).value = { formula: `SUMIFS(${col('S')},${col('C')},${name})`, result: c.profitBrl };
    ws.getCell(row, 6).value = { formula: `SUMIFS(${col('Q')},${col('C')},${name})`, result: c.profitUsdt };
    ws.getCell(row, 5).numFmt = ws.getCell(row, 6).numFmt = '#,##0.00';
  });
  const notesRow = r + clients.length + 3;
  ws.getCell(notesRow, 1).value =
    'Câmbios montados pelo backend a partir dos extratos. Confiança baixa = conferir na aba Cambios (coluna Nota diz o motivo). ' +
    'Pendentes = lançamentos sem câmbio, P2P ou tarifa: estão na aba Pendientes.';
  ws.getCell(notesRow, 1).font = { italic: true, size: 9, color: { argb: 'FF7F7F7F' } };

  ws.views = [{ showGridLines: false }];

  // ---------- gráficos (à direita das tabelas) ----------
  const ref = (c, a, b = a) => `Resumo!$${c}$${a}:$${c}$${b}`;
  const cats = { ref: ref('A', first, lastDay), values: daily.map(d => excelSerial(d.day)), dates: true };
  const nameOf = c => ({ nameRef: `Resumo!$${c}$${headRow}`, name: headers[c.charCodeAt(0) - 65] });
  return [
    {
      type: 'combo',
      title: 'Lucro diário e acumulado (R$)',
      categories: cats,
      series: [{ ...nameOf('D'), ref: ref('D', first, lastDay), values: daily.map(d => round(d.profitBrl)), color: COLORS.blue }],
      line: [{ ...nameOf('E'), ref: ref('E', first, lastDay), values: daily.map(d => round(d.cumulative)), color: COLORS.orange }],
      format: '#,##0',
      anchor: { from: [13, 2], to: [22, 20] }
    },
    {
      type: 'bar',
      title: 'Volume diário em reais',
      categories: cats,
      series: [
        { ...nameOf('F'), ref: ref('F', first, lastDay), values: daily.map(d => round(d.brlIn)), color: COLORS.green },
        { ...nameOf('G'), ref: ref('G', first, lastDay), values: daily.map(d => round(d.brlOut)), color: COLORS.blue }
      ],
      format: '#,##0',
      anchor: { from: [23, 2], to: [32, 20] }
    },
    {
      type: 'bar',
      title: 'Quanto foi preenchido automático por dia',
      categories: cats,
      series: [{ ...nameOf('K'), ref: ref('K', first, lastDay), values: daily.map(d => round(d.auto, 4)), color: COLORS.teal, format: '0%' }],
      format: '0%',
      anchor: { from: [13, 21], to: [22, 39] }
    },
    {
      type: 'doughnut',
      title: 'Para onde foi cada lançamento',
      categories: { ref: ref('A', destFirst, destLast), values: destinations.map(d => d.label) },
      series: [{ nameRef: `Resumo!$C$${destFirst - 1}`, name: 'Lançamentos', ref: ref('C', destFirst, destLast), values: destinations.map(d => d.count) }],
      colors: destinations.map(d => d.color),
      anchor: { from: [23, 21], to: [32, 39] }
    }
  ];
}

const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
// Data do Excel (dias desde 30/12/1899)
const excelSerial = day => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);

function headerCell(cell, text) {
  cell.value = text;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = HEADER;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function styleHeader(row, headers) {
  headers.forEach((h, i) => headerCell(row.getCell(i + 1), h));
  row.height = 30;
}

function numberFormats(row, formats) {
  for (const [c, f] of Object.entries(formats)) row.getCell(+c).numFmt = f;
}

module.exports = { writeResumo };
