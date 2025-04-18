const { ExchangeRate } = require('../models');

const getAllRates = async () => {
  try {
    return await ExchangeRate.findAll({
      order: [['currency_code', 'ASC']],
    });
  } catch (error) {
    throw new Error('Failed to fetch exchange rates');
  }
};

const getRateByCurrency = async (currencyCode) => {
  try {
    return await ExchangeRate.findOne({
      where: { currency_code: currencyCode.toUpperCase() },
    });
  } catch (error) {
    throw new Error(`Failed to fetch rate for ${currencyCode}`);
  }
};

const updateRate = async (currencyCode, { buy_rate, sell_rate }) => {
  try {
    const [updatedRows] = await ExchangeRate.update(
      {
        buy_rate,
        sell_rate,
        last_updated: new Date(),
      },
      {
        where: { currency_code: currencyCode.toUpperCase() },
        returning: true,
        individualHooks: true,
      }
    );

    if (updatedRows === 0) {
      throw new Error('Currency not found');
    }

    return await getRateByCurrency(currencyCode);
  } catch (error) {
    throw error;
  }
};

const createCurrency = async (currencyData) => {
  try {
    const existing = await getRateByCurrency(currencyData.currency_code);
    if (existing) {
      throw new Error('Currency already exists');
    }

    return await ExchangeRate.create({
      currency_code: currencyData.currency_code.toUpperCase(),
      currency_name: currencyData.currency_name,
      rate_type: currencyData.rate_type || 'fiat',
      base_rate: currencyData.base_rate || null,
      buy_rate: currencyData.buy_rate,
      sell_rate: currencyData.sell_rate,
      adjustment_formula: currencyData.adjustment_formula || null,
      is_crypto: currencyData.is_crypto || false,
      last_updated: new Date(),
    });
  } catch (error) {
    throw error;
  }
};

const deleteCurrency = async (currencyCode) => {
  try {
    const deletedRows = await ExchangeRate.destroy({
      where: { currency_code: currencyCode.toUpperCase() },
    });

    if (deletedRows === 0) {
      throw new Error('Currency not found');
    }

    return { message: 'Currency deleted successfully' };
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getAllRates,
  getRateByCurrency,
  updateRate,
  createCurrency,
  deleteCurrency,
};
