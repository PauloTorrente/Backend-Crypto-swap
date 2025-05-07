const ExchangeRepository = require('./exchange.repository');
const sequelize = require('../../config/database');
const ExchangeRate = require('./exchange.model')(sequelize, require('sequelize').DataTypes);

class ExchangeService {
  constructor() {
    this.repo = new ExchangeRepository(ExchangeRate);
    this.USDT_CODE = 'USDT';
  }

  async getAllRates() {
    try {
      const rates = await this.repo.getAllRates();
      return rates.map(rate => {
        const r = rate.toJSON ? rate.toJSON() : rate;
        const spreadValue = typeof r.spread === 'number' ? r.spread : ((r.sell_rate - r.buy_rate) / r.buy_rate * 100);
        const spread = parseFloat(spreadValue.toFixed(2));
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
      const spreadValue = typeof r.spread === 'number' ? r.spread : ((r.sell_rate - r.buy_rate) / r.buy_rate * 100);
      const spread = parseFloat(spreadValue.toFixed(2));
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

  async convertCurrency(fromCurrency, toCurrency, amount) {
    const [rateFrom, rateTo, rateUSDT] = await Promise.all([
      this.repo.getRateByCurrency(fromCurrency),
      this.repo.getRateByCurrency(toCurrency),
      this.repo.getRateByCurrency(this.USDT_CODE)
    ]);

    if (!rateFrom || !rateTo || !rateUSDT) {
      throw new Error('Moeda(s) não encontrada(s) no banco de dados');
    }

    if (amount <= 0) {
      throw new Error('O valor deve ser maior que zero');
    }

    const bankFee = amount * rateFrom.bank_fee;
    const netAfterBank = amount - bankFee;

    let usdtAcquired, platformFee, netUsdt, spreadAmount, finalUsdt, finalAmount;

    if (fromCurrency === 'BRL' && toCurrency === 'BOB') {
      // BRL → USDT → BOB
      usdtAcquired = netAfterBank / rateFrom.buy_rate; // BRL to USDT
      platformFee = usdtAcquired * rateUSDT.platform_fee;
      netUsdt = usdtAcquired - platformFee;
      spreadAmount = netUsdt * rateTo.spread;
      finalUsdt = netUsdt - spreadAmount;
      finalAmount = finalUsdt / rateTo.buy_rate; // USDT to BOB
    } 
    else if (fromCurrency === 'BOB' && toCurrency === 'BRL') {
      // BOB → USDT → BRL
      usdtAcquired = netAfterBank * rateFrom.buy_rate; // BOB to USDT
      platformFee = usdtAcquired * rateUSDT.platform_fee;
      netUsdt = usdtAcquired - platformFee;
      spreadAmount = netUsdt * rateTo.spread;
      finalUsdt = netUsdt - spreadAmount;
      finalAmount = finalUsdt * rateTo.buy_rate; // USDT to BRL
    }
    else {
      throw new Error('Par de moedas não suportado');
    }

    return {
      originalAmount: parseFloat(amount.toFixed(2)),
      fromCurrency,
      toCurrency,
      finalAmount: parseFloat(finalAmount.toFixed(2)),
      steps: {
        bankFee: parseFloat(bankFee.toFixed(2)),
        netAfterBank: parseFloat(netAfterBank.toFixed(2)),
        usdtAcquired: parseFloat(usdtAcquired.toFixed(2)),
        platformFee: parseFloat(platformFee.toFixed(2)),
        netUsdt: parseFloat(netUsdt.toFixed(2)),
        spread: parseFloat(spreadAmount.toFixed(2)),
        finalUsdt: parseFloat(finalUsdt.toFixed(2)),
        exchangeRateUsed: {
          from: parseFloat(rateFrom.buy_rate),
          to: parseFloat(rateTo.buy_rate),
          usdt: parseFloat(rateUSDT.platform_fee)
        }
      }
    };
  }

  async updateRate(currencyCode, rateData) {
    try {
      const { buy_rate, sell_rate } = rateData;

      if (sell_rate <= buy_rate) throw new Error('Sell rate must be higher than buy rate');
      if (buy_rate <= 0 || sell_rate <= 0) throw new Error('Rates must be positive values');

      const spread = ((sell_rate - buy_rate) / buy_rate * 100);
      if (spread > 10) throw new Error('Spread exceeds maximum allowed (10%)');

      const updated = await this.repo.updateRate(currencyCode, {
        buy_rate: parseFloat(buy_rate),
        sell_rate: parseFloat(sell_rate),
      });

      const r = updated.toJSON ? updated.toJSON() : updated;
      const mid_rate = parseFloat(((parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2).toFixed(2));

      return { 
        ...r, 
        spread: parseFloat(spread.toFixed(2)), 
        mid_rate 
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

      if (!currency_code || !currency_name) throw new Error('Missing required currency fields');
      if (!/^[A-Z]{3}$/.test(currency_code)) throw new Error('Currency code must be 3 uppercase letters');

      const spread = ((sell_rate - buy_rate) / buy_rate * 100).toFixed(2);

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
}

module.exports = new ExchangeService();
