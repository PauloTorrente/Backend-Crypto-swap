const express = require('express');
const multer = require('multer');
const { parseFiles } = require('./conciliacion.sources');
const { reconcile } = require('./conciliacion.matcher');
const { buildWorkbook } = require('./conciliacion.workbook');
const prices = require('./conciliacion.prices');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });

// Linhas prontas para colar na aba Cambios (colunas B–J), separadas por tab
function toTsv(cambios) {
  const date = iso => iso.split('-').reverse().join('/');
  const num = n => String(n).replace('.', ',');
  return cambios
    .map(c =>
      [
        date(c.fecha),
        c.cliente,
        c.recibido.moneda,
        c.recibido.formula,
        c.entregado.moneda,
        c.entregado.formula, // a fórmula já dá negativo (saída)
        num(c.precio_usdt_recibida),
        num(c.precio_usdt_entregada),
        `auto ${c.confianza}: ${c.motivos.join(', ')}`
      ].join('\t')
    )
    .join('\n');
}

// POST /api/conciliacion?todos=1&formato=json|tsv|xlsx&desde=2026-10-01&hasta=2026-10-04
//   (multipart, campo "arquivos", vários arquivos)
// Arquivos aceitos, em qualquer combinação:
//   - extratos crus: Banco Económico (.xlsx), PicPay (.csv)
//   - cotações (.txt de /historico); sem ele, usa o histórico gravado no banco
//   Dias sem cotação própria usam a cotação manual da tabela cotacoes_manuais (ver /cotacoes abaixo)
//   - o "Relatorio de lucro" (.xlsx): abas que não vieram cruas (FIDU, BYBIT, BNB) e o que já está ligado
//   desde/hasta  → só esses dias (inclusive, AAAA-MM-DD)
//   todos=1      → ignora o que as abas Cambios/P2P/GASTOS já ligam e sugere tudo de novo
//   formato=xlsx → devolve a planilha preenchida (extratos + Cambios com fórmulas + P2P + Pendientes)
//   formato=tsv  → só as linhas para colar na aba Cambios
// Nada é gravado: os arquivos são lidos em memória e descartados.
router.post('/', upload.any(), async (req, res) => {
  const files = (req.files || []).map(f => ({ name: f.originalname, buffer: f.buffer }));
  if (!files.length) {
    return res.status(400).json({ success: false, message: 'Envie os arquivos no campo "arquivos" (multipart/form-data)' });
  }
  try {
    const period = {};
    for (const key of ['desde', 'hasta']) {
      if (!req.query[key]) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query[key])) throw new Error(`"${key}" deve estar no formato AAAA-MM-DD`);
      period[key] = req.query[key];
    }
    const parsed = await parseFiles(files, period);
    const { history, manualPrices } = await prices.loadDbPrices(parsed);
    parsed.history = history;
    const result = reconcile(parsed, { useLinked: req.query.todos !== '1', manualPrices });
    console.log(`🔗 Conciliação: ${result.resumen.cambios} câmbios sugeridos, ${result.resumen.pendientes} pendentes`);

    if (req.query.formato === 'tsv') {
      res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
      return res.send(toTsv(result.cambios));
    }
    if (req.query.formato === 'xlsx') {
      const days = parsed.bank.map(t => t.date.toISOString().slice(0, 10)).sort();
      const name = days.length ? `relatorio_conciliado_${days[0]}_a_${days.at(-1)}.xlsx` : 'relatorio_conciliado.xlsx';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      // Resumo junto com o arquivo, para o front mostrar sem mandar os extratos duas vezes
      res.setHeader('X-Conciliacion-Resumen', encodeURIComponent(JSON.stringify({ resumen: result.resumen, arquivos: parsed.sources })));
      return res.send(Buffer.from(await buildWorkbook(parsed, result)));
    }
    res.json({ success: true, arquivos: parsed.sources, ...result });
  } catch (error) {
    console.error('❌ Conciliação:', error.message);
    res.status(400).json({ success: false, message: 'Failed to reconcile statements', error: error.message });
  }
});

// Cotações manuais por dia (preço de 1 USDT). Só entram nos dias sem histórico nem ordens P2P.
// GET    /api/conciliacion/cotacoes?desde=&hasta=
// PUT    /api/conciliacion/cotacoes { fecha: 'AAAA-MM-DD', moneda: 'BRL' | 'BOB', precio, nota? }
// DELETE /api/conciliacion/cotacoes/:fecha/:moneda
router.get('/cotacoes', async (req, res) => {
  try {
    res.json({ success: true, data: await prices.listManual(req.query) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to list manual prices', error: error.message });
  }
});

router.put('/cotacoes', async (req, res) => {
  try {
    res.json({ success: true, data: await prices.saveManual(req.body) });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to save manual price', error: error.message });
  }
});

router.delete('/cotacoes/:fecha/:moneda', async (req, res) => {
  try {
    const deleted = await prices.deleteManual(req.params.fecha, req.params.moneda);
    if (!deleted) return res.status(404).json({ success: false, message: 'Manual price not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to delete manual price', error: error.message });
  }
});

module.exports = router;
module.exports.toTsv = toTsv;
