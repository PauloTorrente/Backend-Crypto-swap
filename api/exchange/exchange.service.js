const repo = require('./exchange.repository');

const getAllRates = async () => {
  try {
    const rates = await repo.getAllRates();

    return rates.map(rate => {
      const r = rate.toJSON();
      const spread = r.spread || ((r.sell_rate - r.buy_rate) / r.buy_rate * 100);
      const mid_rate = (parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2;

      return { ...r, spread: parseFloat(spread.toFixed(2)), mid_rate };
    });
  } catch (error) {
    throw new Error('Failed to retrieve exchange rates');
  }
};

const getRate = async (currencyCode) => {
  try {
    const rate = await repo.getRateByCurrency(currencyCode);
    if (!rate) {
      throw new Error(`Currency ${currencyCode} not found`);
    }

    const r = rate.toJSON();
    const spread = r.spread || ((r.sell_rate - r.buy_rate) / r.buy_rate * 100);
    const mid_rate = (parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2;

    return { ...r, spread: parseFloat(spread.toFixed(2)), mid_rate };
  } catch (error) {
    throw error;
  }
};

const updateRate = async (currencyCode, rateData) => {
  try {
    const { buy_rate, sell_rate } = rateData;

    if (sell_rate <= buy_rate) throw new Error('Sell rate must be higher than buy rate');
    if (buy_rate <= 0 || sell_rate <= 0) throw new Error('Rates must be positive values');

    const spread = ((sell_rate - buy_rate) / buy_rate * 100);
    if (spread > 10) throw new Error('Spread exceeds maximum allowed (10%)');

    const updated = await repo.updateRate(currencyCode, {
      buy_rate: parseFloat(buy_rate),
      sell_rate: parseFloat(sell_rate),
    });

    const r = updated.toJSON();
    const mid_rate = (parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2;

    return { ...r, spread: parseFloat(spread.toFixed(2)), mid_rate };
  } catch (error) {
    throw error;
  }
};

const addCurrency = async (currencyData) => {
  try {
    const {
      currency_code,
      currency_name,
      rate_type = 'fiat',
      base_rate = null,
      buy_rate,
      sell_rate,
      adjustment_formula = null,
      is_crypto = false,
    } = currencyData;

    if (!currency_code || !currency_name) throw new Error('Missing required currency fields');
    if (!/^[A-Z]{3}$/.test(currency_code)) throw new Error('Currency code must be 3 uppercase letters');

    const spread = ((sell_rate - buy_rate) / buy_rate * 100).toFixed(2);

    const newCurrency = await repo.createCurrency({
      currency_code: currency_code.toUpperCase(),
      currency_name,
      rate_type,
      base_rate,
      buy_rate: parseFloat(buy_rate),
      sell_rate: parseFloat(sell_rate),
      adjustment_formula,
      is_crypto,
      spread: parseFloat(spread),
    });

    const r = newCurrency.toJSON();
    const mid_rate = (parseFloat(r.buy_rate) + parseFloat(r.sell_rate)) / 2;

    return { ...r, mid_rate };
  } catch (error) {
    throw error;
  }
};

const removeCurrency = async (currencyCode) => {
  try {
    const rate = await repo.getRateByCurrency(currencyCode);
    if (rate?.rate_type === 'base') {
      throw new Error('Cannot delete base currency');
    }

    const result = await repo.deleteCurrency(currencyCode);
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
};

module.exports = {
  getAllRates,
  getRate,
  updateRate,
  addCurrency,
  removeCurrency,
};
