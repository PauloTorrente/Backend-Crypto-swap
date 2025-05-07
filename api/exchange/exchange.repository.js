class ExchangeRepository {
  constructor(ExchangeRateModel) {
    this.ExchangeRate = ExchangeRateModel;
  }

  // Busca todas as taxas de câmbio
  async getAllRates() {
    try {
      return await this.ExchangeRate.findAll({
        order: [['currency_code', 'ASC']],
      });
    } catch (error) {
      throw new Error(`Falha ao buscar taxas: ${error.message}`);
    }
  }

  // Busca taxa por código de moeda (ex: 'BRL')
  async getRateByCurrency(currencyCode) {
    try {
      return await this.ExchangeRate.findOne({
        where: { currency_code: currencyCode.toUpperCase() },
      });
    } catch (error) {
      throw new Error(`Falha ao buscar moeda ${currencyCode}: ${error.message}`);
    }
  }

  // Atualiza taxa de câmbio
  async updateRate(currencyCode, rateData) {
    try {
      const [affectedRows] = await this.ExchangeRate.update(rateData, {
        where: { currency_code: currencyCode.toUpperCase() },
      });

      if (affectedRows === 0) {
        throw new Error('Moeda não encontrada para atualização');
      }

      return this.getRateByCurrency(currencyCode);
    } catch (error) {
      throw new Error(`Falha ao atualizar ${currencyCode}: ${error.message}`);
    }
  }

  // Cria nova moeda
  async createCurrency(currencyData) {
    try {
      return await this.ExchangeRate.create(currencyData);
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw new Error(`Moeda ${currencyData.currency_code} já existe`);
      }
      throw new Error(`Falha ao criar moeda: ${error.message}`);
    }
  }

  // Remove moeda
  async deleteCurrency(currencyCode) {
    try {
      return await this.ExchangeRate.destroy({
        where: { currency_code: currencyCode.toUpperCase() },
      });
    } catch (error) {
      throw new Error(`Falha ao deletar ${currencyCode}: ${error.message}`);
    }
  }

  // Busca moeda base (USDT)
  async getBaseCurrency() {
    try {
      return await this.ExchangeRate.findOne({ where: { rate_type: 'base' } });
    } catch (error) {
      throw new Error(`Falha ao buscar moeda base: ${error.message}`);
    }
  }
}

module.exports = ExchangeRepository;
