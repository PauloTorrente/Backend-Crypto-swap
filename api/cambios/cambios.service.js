const Cambio = require('./cambios.model');
const exchangeService = require('../exchange/exchange.service');
const sheets = require('../../services/sheets.service');

const CURRENCIES = ['BOB', 'BRL'];
const other = currency => (currency === 'BOB' ? 'BRL' : 'BOB');

// Mesmo cálculo da aba "Cambios" da planilha (colunas O–R), mais o lucro em BRL:
//   Recebido em USDT  = monto recibido ÷ preço USDT da moeda recebida
//   Entregado em USDT = monto entregado ÷ preço USDT da moeda entregada
//   Utilidad USDT     = recebido − entregado
//   Lucro BRL         = utilidad USDT × preço do USDT em BRL
//   Margen %          = utilidad ÷ recebido
function withProfit(record) {
  const r = record.toJSON ? record.toJSON() : record;
  const amountReceived = parseFloat(r.amount_received);
  const priceReceived = parseFloat(r.usdt_price_received);
  const priceDelivered = parseFloat(r.usdt_price_delivered);
  const brlPrice = r.currency_received === 'BRL' ? priceReceived : priceDelivered;

  const receivedUsdt = amountReceived / priceReceived;
  const result = {
    ...r,
    amount_received: amountReceived,
    amount_delivered: r.amount_delivered === null ? null : parseFloat(r.amount_delivered),
    usdt_price_received: priceReceived,
    usdt_price_delivered: priceDelivered,
    received_usdt: receivedUsdt,
    // Quanto o cliente receberia a preço de mercado (sem comissão), para comparar
    market_delivery: receivedUsdt * priceDelivered,
    delivered_usdt: null,
    profit_usdt: null,
    profit_brl: null,
    margin: null
  };

  if (result.amount_delivered !== null) {
    result.delivered_usdt = result.amount_delivered / priceDelivered;
    result.profit_usdt = receivedUsdt - result.delivered_usdt;
    result.profit_brl = result.profit_usdt * brlPrice;
    result.margin = result.profit_usdt / receivedUsdt;
  }
  return result;
}

// Linha da aba "Cambios" (colunas A–J; K–R são fórmulas da própria planilha)
function toSheetRow(r) {
  return {
    id: `APP-${r.id}`,
    date: new Date(r.created_at).toISOString(),
    client: r.client,
    currency_received: r.currency_received,
    amount_received: parseFloat(r.amount_received),
    currency_delivered: r.currency_delivered,
    // Na planilha o valor entregado é negativo (saída)
    amount_delivered: r.amount_delivered === null ? null : -parseFloat(r.amount_delivered),
    usdt_price_received: parseFloat(r.usdt_price_received),
    usdt_price_delivered: parseFloat(r.usdt_price_delivered),
    note: r.note || ''
  };
}

// Envia para a planilha; uma falha não desfaz o registro, só fica marcada para tentar de novo
async function syncToSheet(record) {
  try {
    await sheets.upsertCambioRow(toSheetRow(record));
    await record.update({ sheet_synced_at: new Date(), sheet_error: null });
  } catch (error) {
    console.error(`❌ Planilha (cambio ${record.id}):`, error.message);
    await record.update({ sheet_error: error.message });
  }
  return record;
}

function parsePositive(value, field) {
  const n = parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`"${field}" deve ser um número maior que zero`);
  return Math.round(n * 100) / 100;
}

async function list(limit = 50) {
  const records = await Cambio.findAll({ order: [['id', 'DESC']], limit });
  return records.map(withProfit);
}

async function create({ client, currency_received, amount_received, amount_delivered, note }) {
  const name = String(client || '').trim();
  if (!name) throw new Error('"client" é obrigatório');
  if (!CURRENCIES.includes(currency_received)) throw new Error('"currency_received" deve ser BOB ou BRL');
  const received = parsePositive(amount_received, 'amount_received');
  const delivered =
    amount_delivered === undefined || amount_delivered === null || amount_delivered === ''
      ? null
      : parsePositive(amount_delivered, 'amount_delivered');

  // Preço do USDT no momento do registro
  const prices = await exchangeService.getUsdtPrices();
  const currency_delivered = other(currency_received);

  const record = await Cambio.create({
    client: name,
    currency_received,
    amount_received: received,
    currency_delivered,
    amount_delivered: delivered,
    usdt_price_received: prices[currency_received].mid,
    usdt_price_delivered: prices[currency_delivered].mid,
    prices: { BOB: prices.BOB.sources, BRL: prices.BRL.sources },
    note: note ? String(note).trim() : null
  });

  return withProfit(await syncToSheet(record));
}

async function update(id, { amount_delivered, client, note }) {
  const record = await Cambio.findByPk(id);
  if (!record) return null;

  const changes = {};
  if (amount_delivered !== undefined) {
    changes.amount_delivered =
      amount_delivered === null || amount_delivered === ''
        ? null
        : parsePositive(amount_delivered, 'amount_delivered');
  }
  if (client !== undefined) {
    const name = String(client).trim();
    if (!name) throw new Error('"client" não pode ficar vazio');
    changes.client = name;
  }
  if (note !== undefined) changes.note = note ? String(note).trim() : null;

  await record.update(changes);
  return withProfit(await syncToSheet(record));
}

async function retrySync(id) {
  const record = await Cambio.findByPk(id);
  if (!record) return null;
  return withProfit(await syncToSheet(record));
}

module.exports = { list, create, update, retrySync, sheetsConfigured: sheets.isConfigured };
