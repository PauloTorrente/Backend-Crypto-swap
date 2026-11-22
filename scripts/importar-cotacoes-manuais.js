// Grava cotações diárias na tabela cotacoes_manuais (usadas pela conciliação nos dias sem histórico próprio).
//   node scripts/importar-cotacoes-manuais.js dados/2026-06/cotacoes_diarias_2026-06.json "nota"
// JSON: { "2026-06-01": { "BRL": 5.04, "BOB": 9.93 }, ... }
const fs = require('fs');
const prices = require('../api/conciliacion/conciliacion.prices');
const CotacaoManual = require('../api/conciliacion/cotacao-manual.model');
const db = require('../config/database');

async function main() {
  const [file, nota] = process.argv.slice(2);
  if (!file) throw new Error('Uso: node scripts/importar-cotacoes-manuais.js <arquivo.json> [nota]');
  await CotacaoManual.sync(); // cria a tabela se ainda não existir; não altera a que já existe
  const days = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const [fecha, porMoeda] of Object.entries(days)) {
    for (const [moneda, precio] of Object.entries(porMoeda)) {
      await prices.saveManual({ fecha, moneda, precio, nota });
      n++;
    }
  }
  console.log(`✅ ${n} cotações gravadas`);
}

main()
  .catch(err => {
    console.error('❌', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
