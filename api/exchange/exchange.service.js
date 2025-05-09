const ExchangeRepository = require('./exchange.repository');
const sequelize = require('../../config/database');
const ExchangeRate = require('./exchange.model')(sequelize, require('sequelize').DataTypes);

class ExchangeService {
  constructor() {
    this.repo = new ExchangeRepository(ExchangeRate);
    this.USDT_CODE = 'USDT';
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

  async convertCurrency(fromCurrency, toCurrency, amount, customParams = {}) {
    // Validate currency pair
    if (!this.isSupportedPair(fromCurrency, toCurrency)) {
      throw new Error(`Currency pair ${fromCurrency}-${toCurrency} not supported`);
    }

    const [rateFrom, rateTo, rateUSDT] = await Promise.all([
      this.repo.getRateByCurrency(fromCurrency),
      this.repo.getRateByCurrency(toCurrency),
      this.repo.getRateByCurrency(this.USDT_CODE)
    ]);

    if (!rateFrom || !rateTo || !rateUSDT) {
      throw new Error('Currency not found in database');
    }

    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    // Apply custom rates or use defaults
    const rates = {
      bankFee: customParams.bankFeeRate ?? rateFrom.bank_fee,
      platformFee: customParams.platformFeeRate ?? rateUSDT.platform_fee,
      spread: customParams.spreadRate ?? rateTo.spread,
      exchangeRate: customParams.exchangeRate ?? rateFrom.buy_rate,
      targetRate: customParams.targetExchangeRate ?? rateTo.sell_rate
    };

    // Conversion steps
    const bankFee = amount * rates.bankFee;
    const netAfterBank = amount - bankFee;

    let usdtAcquired, platformFee, netUsdt, spreadAmount, finalUsdt, finalAmount;

    if (fromCurrency === 'BRL' && toCurrency === 'BOB') {
      // BRL → USDT → BOB
      usdtAcquired = netAfterBank / rates.exchangeRate;
      platformFee = usdtAcquired * rates.platformFee;
      netUsdt = usdtAcquired - platformFee;
      spreadAmount = netUsdt * rates.spread;
      finalUsdt = netUsdt - spreadAmount;
      finalAmount = finalUsdt / rates.targetRate;
    } else {
      // BOB → USDT → BRL
      usdtAcquired = netAfterBank * rates.exchangeRate;
      platformFee = usdtAcquired * rates.platformFee;
      netUsdt = usdtAcquired - platformFee;
      spreadAmount = netUsdt * rates.spread;
      finalUsdt = netUsdt - spreadAmount;
      finalAmount = finalUsdt * rateTo.sell_rate;
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
          from: parseFloat(rates.exchangeRate),
          to: parseFloat(rates.targetRate),
          usdt: parseFloat(rates.platformFee),
          bankFeeRate: parseFloat(rates.bankFee),
          spreadRate: parseFloat(rates.spread)
        },
        isCustom: Object.keys(customParams).length > 0
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

  isSupportedPair(fromCurrency, toCurrency) {
    return this.SUPPORTED_PAIRS.some(
      pair => pair.from === fromCurrency && pair.to === toCurrency
    );
  }
}

module.exports = new ExchangeService();
