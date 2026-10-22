// Roda a conciliação sem subir o servidor. Aceita vários arquivos de uma vez:
// extratos crus (Banco Económico .xlsx, PicPay .csv), cotações (.txt de /historico) e o "Relatorio de lucro".
//   node scripts/conciliar.js extrato1.xlsx picpay.csv cotacoes.txt "Relatorio.xlsx"  → resumo + tabela
//   ... --xlsx saida.xlsx   grava a planilha preenchida (extratos + Cambios com fórmulas + P2P + Pendientes)
//   ... --tsv               linhas para colar na aba Cambios
//   ... --json              resultado completo
//   ... --todos             ignora o que as abas Cambios/P2P/GASTOS já ligam
//   ... --desde 2026-10-01 --hasta 2026-10-04   só esses dias
const fs = require('fs');
const path = require('path');
const { parseFiles } = require('../api/conciliacion/conciliacion.sources');
const { reconcile } = require('../api/conciliacion/conciliacion.matcher');
const { buildWorkbook } = require('../api/conciliacion/conciliacion.workbook');
const { toTsv } = require('../api/conciliacion/conciliacion.router');
const prices = require('../api/conciliacion/conciliacion.prices');
const db = require('../config/database');

async function main() {
  const args = process.argv.slice(2);
  const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const xlsxOut = option('--xlsx');
  const inputs = args.filter((a, i) => !a.startsWith('--') && !['--xlsx', '--desde', '--hasta'].includes(args[i - 1]));
  if (!inputs.length) {
    console.error('Uso: node scripts/conciliar.js <arquivos...> [--xlsx saida.xlsx | --tsv | --json] [--todos] [--desde AAAA-MM-DD] [--hasta AAAA-MM-DD]');
    process.exit(1);
  }

  const parsed = await parseFiles(
    inputs.map(f => ({ name: path.basename(f), buffer: fs.readFileSync(f) })),
    { desde: option('--desde'), hasta: option('--hasta') }
  );
  // Histórico (se não veio .txt) e cotações manuais do banco, quando DATABASE_URL está configurada
  const { history, manualPrices } = await prices.loadDbPrices(parsed);
  parsed.history = history;
  const result = reconcile(parsed, { useLinked: !args.includes('--todos'), manualPrices });

  if (args.includes('--tsv')) return console.log(toTsv(result.cambios));
  if (args.includes('--json')) return console.log(JSON.stringify(result, null, 2));

  console.log(parsed.sources.join('\n'));
  console.log(result.resumen);
  console.table(
    result.cambios.map(c => ({
      fecha: c.fecha,
      cliente: c.cliente.slice(0, 28),
      recibido: `${c.recibido.monto} ${c.recibido.moneda}`,
      entregado: `${c.entregado.monto} ${c.entregado.moneda}`,
      formulas: `${c.recibido.formula} ⇄ ${c.entregado.formula}`,
      margen: `${(c.margen * 100).toFixed(2)}%`,
      confianza: c.confianza
    }))
  );
  if (xlsxOut) {
    fs.writeFileSync(xlsxOut, Buffer.from(await buildWorkbook(parsed, result)));
    console.log(`📄 Planilha gravada em ${xlsxOut}`);
  }
}

main()
  .catch(err => {
    console.error('❌', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
