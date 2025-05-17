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

    // VALIDAÇÃO EXPLÍCITA DAS TAXAS
    if (parseFloat(rateFrom.buy_rate) <= parseFloat(rateFrom.sell_rate)) {
      throw new Error(`BUY RATE (${rateFrom.buy_rate}) DEVE SER MAIOR QUE SELL RATE (${rateFrom.sell_rate}) PARA ${fromCurrency}`);
    }

    if (parseFloat(rateTo.buy_rate) <= parseFloat(rateTo.sell_rate)) {
      throw new Error(`BUY RATE (${rateTo.buy_rate}) DEVE SER MAIOR QUE SELL RATE (${rateTo.sell_rate}) PARA ${toCurrency}`);
    }

    const rates = {
      bankFee: customParams.bankFeeRate ?? rateFrom.bank_fee,
      platformFee: customParams.platformFeeRate ?? rateUSDT.platform_fee,
      spread: customParams.spreadRate ?? rateTo.spread,
      exchangeRate: customParams.exchangeRate ?? rateFrom.buy_rate,
      targetRate: customParams.targetExchangeRate ?? rateTo.sell_rate
    };

    const bankFee = amount * rates.bankFee;
    const netAfterBank = amount - bankFee;

    let usdtAcquired, platformFee, netUsdt, spreadAmount, finalUsdt, finalAmount;

    if (fromCurrency === 'BRL' && toCurrency === 'BOB') {
      usdtAcquired = netAfterBank / rates.exchangeRate;
      platformFee = usdtAcquired * rates.platformFee;
      netUsdt = usdtAcquired - platformFee;
      spreadAmount = netUsdt * rates.spread;
      finalUsdt = netUsdt - spreadAmount;
      finalAmount = finalUsdt * rates.targetRate;
    } else {
      usdtAcquired = netAfterBank / rates.exchangeRate;
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

        // Calculate new spread if rates changed
        updateData.spread = parseFloat((((sellRate - buyRate) / buyRate) * 100).toFixed(4));
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
        spread: r.spread || currentData.spread
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
