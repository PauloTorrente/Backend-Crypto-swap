// Cotações que vêm do banco de dados para a conciliação:
//   - histórico gravado a cada 30 s (o mesmo do .txt de /historico)
//   - cotações manuais por dia (tabela cotacoes_manuais), usadas só nos dias sem cotação própria
const { Op } = require('sequelize');
const CotacaoManual = require('./cotacao-manual.model');
const exchangeService = require('../exchange/exchange.service');
const { historyFromSnapshots, sideHistoryFromSnapshots } = require('./conciliacion.sources');

// Os extratos estão na hora da Bolívia (UTC−4, sem horário de verão); o banco, em UTC
const LOCAL_OFFSET_MS = -4 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const CURRENCIES = ['BOB', 'BRL'];

const dayKey = d => new Date(d).toISOString().slice(0, 10);

function periodOf(bank) {
  const times = bank.map(t => +t.date);
  return { from: new Date(Math.min(...times) - DAY_MS), to: new Date(Math.max(...times) + 2 * DAY_MS) };
}

// → { history (média compra/venda), market (compra e venda separadas) }
async function historyFromDatabase(bank) {
  if (!exchangeService.hasDatabase || !bank.length) return { history: {}, market: {} };
  const { from, to } = periodOf(bank);
  const snapshots = [];
  for await (const rows of exchangeService.iterateHistory(new Date(+from - LOCAL_OFFSET_MS), new Date(+to - LOCAL_OFFSET_MS))) {
    for (const r of rows) snapshots.push({ time: new Date(+new Date(r.created_at) + LOCAL_OFFSET_MS), prices: r.prices });
  }
  return { history: historyFromSnapshots(snapshots), market: sideHistoryFromSnapshots(snapshots) };
}

// → { BRL: { '2026-10-01': 5.22 }, BOB: { ... } }
async function manualPrices(bank) {
  if (!exchangeService.hasDatabase || !bank.length) return {};
  const { from, to } = periodOf(bank);
  const rows = await CotacaoManual.findAll({ where: { date: { [Op.between]: [dayKey(from), dayKey(to)] } }, raw: true });
  const prices = {};
  for (const r of rows) (prices[r.currency] ||= {})[r.date] = parseFloat(r.price);
  return prices;
}

// Tudo o que a conciliação precisa do banco. O histórico só é buscado se não veio um .txt.
// Com o banco fora do ar, falha em vez de seguir sem as cotações manuais (o lucro mudaria sem aviso).
// O período vem dos extratos e das ordens P2P (dá para validar só as ordens contra o mercado).
async function loadDbPrices(parsed) {
  const dated = [...parsed.bank, ...(parsed.p2p || [])];
  try {
    const [quotes, manual] = await Promise.all([
      Object.keys(parsed.history || {}).length ? { history: parsed.history, market: parsed.market || {} } : historyFromDatabase(dated),
      manualPrices(dated)
    ]);
    return { ...quotes, manualPrices: manual };
  } catch (error) {
    const reason = error.parent?.code || error.message || error.name;
    throw new Error(`Banco de dados indisponível (${reason}): não deu para ler as cotações. Tente de novo.`);
  }
}

// ---------- CRUD das cotações manuais ----------

function parseInput({ fecha, moneda, precio, nota }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw new Error('"fecha" deve estar no formato AAAA-MM-DD');
  const currency = String(moneda || '').toUpperCase();
  if (!CURRENCIES.includes(currency)) throw new Error('"moneda" deve ser BOB ou BRL');
  const price = parseFloat(String(precio).replace(',', '.'));
  if (!Number.isFinite(price) || price <= 0) throw new Error('"precio" deve ser um número maior que zero');
  return { date: fecha, currency, price, note: nota ? String(nota).trim() : null };
}

const toJson = r => ({ fecha: r.date, moneda: r.currency, precio: parseFloat(r.price), nota: r.note, actualizado: r.updated_at });

async function listManual({ desde, hasta } = {}) {
  const where = {};
  if (desde || hasta) where.date = { ...(desde && { [Op.gte]: desde }), ...(hasta && { [Op.lte]: hasta }) };
  const rows = await CotacaoManual.findAll({ where, order: [['date', 'ASC'], ['currency', 'ASC']] });
  return rows.map(toJson);
}

async function saveManual(input) {
  const data = parseInput(input);
  const [row] = await CotacaoManual.upsert(data, { conflictFields: ['date', 'currency'] });
  return toJson(row);
}

async function deleteManual(fecha, moneda) {
  return CotacaoManual.destroy({ where: { date: fecha, currency: String(moneda).toUpperCase() } });
}

module.exports = { loadDbPrices, listManual, saveManual, deleteManual };
