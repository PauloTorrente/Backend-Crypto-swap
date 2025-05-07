module.exports = (sequelize, DataTypes) => {
  const ExchangeRate = sequelize.define('ExchangeRate', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      comment: 'Primary key'
    },
    currency_code: {
      type: DataTypes.STRING(4),
      allowNull: false,
      unique: true,
      validate: {
        len: [3, 4],
        isUppercase: true
      },
      comment: 'Código da moeda (ex: BRL, BOB, USDT)'
    },
    currency_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Nome completo da moeda'
    },
    rate_type: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'fiat',
      validate: {
        isIn: [['base', 'fiat', 'crypto']]
      },
      comment: 'Tipo de moeda (base, fiat, crypto)'
    },
    buy_rate: {
      type: DataTypes.DECIMAL(20, 10),
      allowNull: false,
      validate: {
        min: 0.0000000001,
        isGreaterThanSellRate(value) {
          if (parseFloat(value) <= parseFloat(this.sell_rate)) {
            throw new Error('buy_rate deve ser > sell_rate');
          }
        }
      },
      comment: 'Taxa de compra (ex: 1 USDT = 5 BRL)'
    },
    sell_rate: {
      type: DataTypes.DECIMAL(20, 10),
      allowNull: false,
      validate: {
        min: 0.0000000001,
        isLessThanBuyRate(value) {
          if (parseFloat(value) >= parseFloat(this.buy_rate)) {
            throw new Error('sell_rate deve ser < buy_rate');
          }
        }
      },
      comment: 'Taxa de venda (ex: 1 USDT = 4.8 BRL)'
    },
    bank_fee: {
      type: DataTypes.DECIMAL(5, 4),
      defaultValue: 0.0100,
      validate: {
        min: 0,
        max: 0.9999
      },
      comment: 'Comissão bancária (1% padrão)'
    },
    platform_fee: {
      type: DataTypes.DECIMAL(5, 4),
      defaultValue: 0.0100,
      comment: 'Comissão da plataforma (1% padrão)'
    },
    spread: {
      type: DataTypes.DECIMAL(5, 4),
      defaultValue: 0.0500,
      comment: 'Spread aplicado (5% padrão)'
    },
    last_updated: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: 'Data da última atualização'
    }
  }, {
    tableName: 'exchange_rates',
    timestamps: false,
    underscored: true,
    comment: 'Tabela de taxas de câmbio',
    hooks: {
      beforeSave: (rate) => {
        if (rate.changed('currency_code')) {
          rate.currency_code = rate.currency_code.toUpperCase();
        }
        rate.last_updated = new Date();
        
        // Validação adicional para garantir buy_rate > sell_rate
        if (parseFloat(rate.buy_rate) <= parseFloat(rate.sell_rate)) {
          throw new Error('buy_rate deve ser maior que sell_rate');
        }
      }
    }
  });

  // Validação customizada ao atualizar
  ExchangeRate.beforeUpdate((rate) => {
    if (parseFloat(rate.buy_rate) <= parseFloat(rate.sell_rate)) {
      throw new Error('buy_rate deve ser maior que sell_rate');
    }
  });

  ExchangeRate.findBaseCurrency = function() {
    return this.findOne({ where: { rate_type: 'base' }});
  };

  return ExchangeRate;
};
