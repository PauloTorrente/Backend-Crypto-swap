const LiveExchangeRepository = require('./exchange.live.repository');
const sequelize = require('../../config/database');
const { DataTypes } = require('sequelize');
const ExchangeRate = require('./exchange.model')(sequelize, DataTypes);
const PairRateHistory = require('./exchange.history.model')(sequelize, DataTypes);

class ExchangeService {
  constructor() {
    // As cotações sempre vêm da Binance/Bybit; o banco (se configurado) só guarda o registro
    this.repo = new LiveExchangeRepository();
    this.hasDatabase = Boolean(process.env.DATABASE_URL);
    this.USDT_CODE = 'USDT';
    this.PAIR_MARGIN = 0.035; // margem somada/subtraída da cotação BOB/BRL
    this.SUPPORTED_PAIRS = [
      { from: 'BRL', to: 'BOB' },
      { from: 'BOB', to: 'BRL' }
    ];
  }

  async getAllRates() {
    try {
      const rates = await this.repo.getAllRates();
      return rates.map(rate => {
        const r = rate.toJSON ? rate.toJSON() : rate;
        /* CÁLCULO ORIGINAL DO SPREAD (COMENTADO)
        const spreadValue = typeof r.spread === 'number' ? r.spread : ((r.sell_rate - r.buy_rate) / r.buy_rate * 100);
        const spread = parseFloat(spreadValue.toFixed(2));
        */
        const spread = 0; // SPREAD FORÇADO PARA ZERO
        const mid_rate = parseFloat(((parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2).toFixed(2));
        return { 
          ...r, 
          buy_rate: parseFloat(r.buy_rate),
          sell_rate: parseFloat(r.sell_rate),
          spread,
          mid_rate 
        };
      });
    } catch (error) {
      throw new Error('Failed to retrieve exchange rates');
    }
  }

  async getRate(currencyCode) {
    try {
      const rate = await this.repo.getRateByCurrency(currencyCode);
      if (!rate) {
        throw new Error(`Currency ${currencyCode} not found`);
      }

      const r = rate.toJSON ? rate.toJSON() : rate;
      /* CÁLCULO ORIGINAL DO SPREAD (COMENTADO)
      const spreadValue = typeof r.spread === 'number' ? r.spread : ((r.sell_rate - r.buy_rate) / r.buy_rate * 100);
      const spread = parseFloat(spreadValue.toFixed(2));
      */
      const spread = 0; // SPREAD FORÇADO PARA ZERO
      const mid_rate = parseFloat(((parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2).toFixed(2));

      return { 
        ...r, 
        buy_rate: parseFloat(r.buy_rate),
        sell_rate: parseFloat(r.sell_rate),
        spread,
        mid_rate 
      };
    } catch (error) {
      throw error;
    }
  }

  // Cotação BOB/BRL (quantos BOB valem 1 BRL), usando a taxa média de cada moeda em USDT
  //   BOB → BRL: (BOB/BRL) + margem
  //   BRL → BOB: (BOB/BRL) - margem
  async getPairRates() {
    const [bob, brl] = await Promise.all([
      this.repo.getRateByCurrency('BOB'),
      this.repo.getRateByCurrency('BRL')
    ]);
    if (!bob || !brl) {
      throw new Error('BOB or BRL not found');
    }

    const mid = r => (parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2;
    const bobPerBrl = mid(bob) / mid(brl);

    return {
      bob_per_brl: bobPerBrl,
      margin: this.PAIR_MARGIN,
      BOB_BRL: bobPerBrl + this.PAIR_MARGIN,
      BRL_BOB: bobPerBrl - this.PAIR_MARGIN
    };
  }

  // Conversão usando as cotações do par (já com a margem de PAIR_MARGIN)
  //   BRL → BOB: valor × BRL_BOB
  //   BOB → BRL: valor ÷ BOB_BRL
  // Busca as cotações atuais e, se houver banco, grava:
  //   - exchange_rates: cotação atual de BOB e BRL (uma linha por moeda, atualizada)
  //   - pair_rate_history: uma linha nova com as taxas do par
  async saveSnapshot() {
    const pairs = await this.getPairRates();
    if (!this.hasDatabase) return pairs;

    const rows = await this.repo.getAllRates();
    for (const { id, ...row } of rows) {
      if (row.currency_code === this.USDT_CODE) continue; // USDT é fixo em 1 (o model exige buy > sell)
      await ExchangeRate.upsert(row, { conflictFields: ['currency_code'] });
    }

    await PairRateHistory.create({
      bob_per_brl: pairs.bob_per_brl,
      bob_brl: pairs.BOB_BRL,
      brl_bob: pairs.BRL_BOB,
      margin: pairs.margin
    });

    return pairs;
  }

  async convertCurrency(fromCurrency, toCurrency, amount) {
    if (!this.isSupportedPair(fromCurrency, toCurrency)) {
      throw new Error(`Currency pair ${fromCurrency}-${toCurrency} not supported`);
    }

    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const pairs = await this.getPairRates();
    const rateUsed = fromCurrency === 'BRL' ? pairs.BRL_BOB : pairs.BOB_BRL;
    const finalAmount = fromCurrency === 'BRL' ? amount * rateUsed : amount / rateUsed;

    return {
      originalAmount: amount,
      fromCurrency,
      toCurrency,
      finalAmount,
      rates: {
        bob_per_brl: pairs.bob_per_brl,
        margin: pairs.margin,
        rateUsed
      }
    };
  }

  async updateRate(currencyCode, rateData) {
    try {
      // Get current rates if needed
      const currentRate = await this.repo.getRateByCurrency(currencyCode);
      if (!currentRate) {
        throw new Error(`Currency ${currencyCode} not found`);
      }

      const currentData = currentRate.toJSON ? currentRate.toJSON() : currentRate;

      // Prepare update data
      const updateData = { ...rateData };

      // Only validate buy/sell rates if they're being updated
      if (rateData.buy_rate !== undefined || rateData.sell_rate !== undefined) {
        const buyRate = rateData.buy_rate !== undefined ? parseFloat(rateData.buy_rate) : parseFloat(currentData.buy_rate);
        const sellRate = rateData.sell_rate !== undefined ? parseFloat(rateData.sell_rate) : parseFloat(currentData.sell_rate);

        if (buyRate <= sellRate) {
          throw new Error(`BUY RATE (${buyRate}) must be greater than SELL RATE (${sellRate})`);
        }

        if (buyRate <= 0 || sellRate <= 0) {
          throw new Error('Rates must be positive values');
        }

        /* CÁLCULO ORIGINAL DO SPREAD (COMENTADO)
        updateData.spread = parseFloat((((sellRate - buyRate) / buyRate) * 100).toFixed(4));
        */
        updateData.spread = 0; // SPREAD FORÇADO PARA ZERO
      }

      // Update the rate
      const updated = await this.repo.updateRate(currencyCode, updateData);
      const r = updated.toJSON ? updated.toJSON() : updated;

      // Calculate mid_rate if either buy or sell rate changed
      const mid_rate = (rateData.buy_rate !== undefined || rateData.sell_rate !== undefined)
        ? parseFloat(((parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2).toFixed(2))
        : parseFloat(currentData.mid_rate);

      return {
        ...r,
        mid_rate,
        spread: 0 // SPREAD FORÇADO PARA ZERO (r.spread || currentData.spread)
      };
    } catch (error) {
      throw error;
    }
  }

  async addCurrency(currencyData) {
    try {
      const {
        currency_code,
        currency_name,
        rate_type = 'fiat',
        base_rate = null,
        buy_rate,
        sell_rate,
        adjustment_formula = null,
      } = currencyData;

      // VALIDAÇÃO EXPLÍCITA
      if (parseFloat(buy_rate) <= parseFloat(sell_rate)) {
        throw new Error(`BUY RATE (${buy_rate}) PRECISA SER MAIOR QUE SELL RATE (${sell_rate})`);
      }

      if (!currency_code || !currency_name) throw new Error('Campos obrigatórios faltando');
      if (!/^[A-Z]{3}$/.test(currency_code)) throw new Error('Código da moeda deve ter 3 letras maiúsculas');

      /* CÁLCULO ORIGINAL DO SPREAD (COMENTADO)
      const spread = ((sell_rate - buy_rate) / buy_rate * 100).toFixed(2);
      */
      const spread = 0; // SPREAD FORÇADO PARA ZERO

      const newCurrency = await this.repo.createCurrency({
        currency_code: currency_code.toUpperCase(),
        currency_name,
        rate_type,
        base_rate,
        buy_rate: parseFloat(buy_rate),
        sell_rate: parseFloat(sell_rate),
        adjustment_formula,
        spread: parseFloat(spread),
      });

      const r = newCurrency.toJSON ? newCurrency.toJSON() : newCurrency;
      const mid_rate = parseFloat(((parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2).toFixed(2));

      return { ...r, mid_rate };
    } catch (error) {
      throw error;
    }
  }

  async removeCurrency(currencyCode) {
    try {
      const rate = await this.repo.getRateByCurrency(currencyCode);
      if (rate?.rate_type === 'base') {
        throw new Error('Cannot delete base currency');
      }

      const result = await this.repo.deleteCurrency(currencyCode);
      if (result === 0) {
        throw new Error('Currency not found');
      }

      return {
        success: true,
        message: `Currency ${currencyCode} deleted successfully`,
      };
    } catch (error) {
      throw error;
    }
  }

  async getBaseCurrency() {
    return this.repo.getBaseCurrency();
  }

  isSupportedPair(fromCurrency, toCurrency) {
    return this.SUPPORTED_PAIRS.some(
      pair => pair.from === fromCurrency && pair.to === toCurrency
    );
  }
}

module.exports = new ExchangeService();
