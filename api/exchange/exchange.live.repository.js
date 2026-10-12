// Busca cotações do USDT na Binance e na Bybit e devolve objetos no mesmo formato da tabela
// exchange_rates. Somente leitura: o que vai para o banco é gravado pelo ExchangeService.
//
// buy_rate  = quanto o cliente paga para comprar 1 USDT (ask)
// sell_rate = quanto o cliente recebe ao vender 1 USDT (bid)
// Cada taxa é a média entre as corretoras que responderem.
//
// BRL: livro spot USDT/BRL (Binance e Bybit)
// BOB: não existe par spot, então usa anúncios P2P (Binance e Bybit), mediana dos primeiros anúncios

const CACHE_MS = 30 * 1000;
const P2P_ADS = 10; // quantos anúncios considerar na mediana do P2P
const TIMEOUT_MS = 8000;

const CURRENCIES = [
  { currency_code: 'BOB', currency_name: 'Boliviano', rate_type: 'fiat', source: 'p2p' },
  { currency_code: 'BRL', currency_name: 'Real Brasileiro', rate_type: 'fiat', source: 'spot' },
  { currency_code: 'USDT', currency_name: 'Tether', rate_type: 'base', source: null }
];

async function request(url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
  return res.json();
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('nenhum anúncio P2P encontrado');
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// --- Spot ---

async function binanceSpot(fiat) {
  const t = await request(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=USDT${fiat}`);
  return { buy: parseFloat(t.askPrice), sell: parseFloat(t.bidPrice) };
}

async function bybitSpot(fiat) {
  const body = await request(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=USDT${fiat}`);
  const t = body.result?.list?.[0];
  if (!t) throw new Error(`Bybit sem par USDT${fiat}`);
  return { buy: parseFloat(t.ask1Price), sell: parseFloat(t.bid1Price) };
}

// --- P2P ---

async function binanceP2P(fiat) {
  // tradeType é do ponto de vista do cliente: BUY = anúncios de quem vende USDT
  const prices = async (tradeType) => {
    const body = await request('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      asset: 'USDT', fiat, tradeType, page: 1, rows: P2P_ADS, payTypes: [], publisherType: null
    });
    return median((body.data || []).map(ad => parseFloat(ad.adv.price)));
  };
  const [buy, sell] = await Promise.all([prices('BUY'), prices('SELL')]);
  return { buy, sell };
}

async function bybitP2P(fiat) {
  // side "1" = anúncios de quem vende USDT (cliente compra); "0" = de quem compra
  const prices = async (side) => {
    const body = await request('https://api2.bybit.com/fiat/otc/item/online', {
      tokenId: 'USDT', currencyId: fiat, side, size: String(P2P_ADS), page: '1', amount: ''
    });
    return median((body.result?.items || []).map(ad => parseFloat(ad.price)));
  };
  const [buy, sell] = await Promise.all([prices('1'), prices('0')]);
  return { buy, sell };
}

const SOURCES = {
  spot: { binance: binanceSpot, bybit: bybitSpot },
  p2p: { binance: binanceP2P, bybit: bybitP2P }
};

// Consulta as duas corretoras e faz a média; se uma falhar, usa só a outra
async function quote(fiat, source) {
  const names = Object.keys(SOURCES[source]);
  const results = await Promise.allSettled(names.map(n => SOURCES[source][n](fiat)));

  const ok = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push({ exchange: names[i], ...r.value });
    else console.warn(`⚠️  ${names[i]} ${source} ${fiat}: ${r.reason.message}`);
  });
  if (ok.length === 0) throw new Error(`nenhuma corretora retornou cotação para ${fiat}`);

  const avg = key => ok.reduce((sum, q) => sum + q[key], 0) / ok.length;
  return { buy: avg('buy'), sell: avg('sell'), sources: ok };
}

class LiveExchangeRepository {
  constructor() {
    this.cache = null;
    this.cachedAt = 0;
  }

  // Guarda a promise (não o resultado) para que chamadas simultâneas compartilhem a mesma busca.
  // cachedAt marca o início da busca, então o cache expira exatamente CACHE_MS depois.
  fetchRows() {
    if (this.cache && Date.now() - this.cachedAt < CACHE_MS) return this.cache;

    this.cachedAt = Date.now();
    this.cache = this.loadRows().catch(err => {
      this.cache = null; // não guarda falha no cache
      throw err;
    });
    return this.cache;
  }

  async loadRows() {
    const now = new Date();
    const rows = await Promise.all(CURRENCIES.map(async ({ source, ...currency }, i) => {
      const q = source ? await quote(currency.currency_code, source) : { buy: 1, sell: 1, sources: [] };
      if (source) {
        const detail = q.sources.map(s => `${s.exchange} ${s.buy.toFixed(4)}/${s.sell.toFixed(4)}`).join(', ');
        console.log(`💱 ${currency.currency_code} (${source}): ${detail}`);
      }
      return {
        id: i + 1,
        ...currency,
        buy_rate: q.buy,
        sell_rate: q.sell,
        bank_fee: 0.01,
        platform_fee: 0.01,
        spread: 0,
        last_updated: now
      };
    }));

    return rows;
  }

  async getAllRates() {
    try {
      return await this.fetchRows();
    } catch (error) {
      throw new Error(`Falha ao buscar taxas: ${error.message}`);
    }
  }

  async getRateByCurrency(currencyCode) {
    const rows = await this.getAllRates();
    return rows.find(r => r.currency_code === currencyCode.toUpperCase()) || null;
  }

  async getBaseCurrency() {
    const rows = await this.getAllRates();
    return rows.find(r => r.rate_type === 'base') || null;
  }

  readOnly() {
    throw new Error('As taxas vêm da Binance/Bybit e não podem ser editadas manualmente');
  }

  updateRate() { this.readOnly(); }
  createCurrency() { this.readOnly(); }
  deleteCurrency() { this.readOnly(); }
}

module.exports = LiveExchangeRepository;
