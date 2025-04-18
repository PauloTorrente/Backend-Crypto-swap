module.exports = (sequelize, DataTypes) => {
  const ExchangeRate = sequelize.define('ExchangeRate', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      comment: 'Primary key for the exchange rate record'
    },
    currency_code: {
      type: DataTypes.STRING(3),
      allowNull: false,
      unique: true,
      validate: {
        len: {
          args: [3, 3],
          msg: 'Currency code must be exactly 3 characters'
        },
        isUppercase: {
          msg: 'Currency code must be uppercase'
        }
      },
      comment: 'ISO 4217 currency code (e.g. USD, EUR)'
    },
    currency_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        notEmpty: {
          msg: 'Currency name cannot be empty'
        }
      },
      comment: 'Full currency name'
    },
    rate_type: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'fiat',
      validate: {
        isIn: {
          args: [['base', 'fiat', 'crypto']],
          msg: 'Rate type must be either base, fiat or crypto'
        }
      },
      comment: 'Type of currency rate (base, fiat, crypto)'
    },
    base_rate: {
      type: DataTypes.DECIMAL(20, 10),
      allowNull: true,
      comment: 'Base rate for currency calculations',
      validate: {
        min: {
          args: [0],
          msg: 'Base rate cannot be negative'
        }
      }
    },
    buy_rate: {
      type: DataTypes.DECIMAL(20, 10),
      allowNull: false,
      validate: {
        min: {
          args: [0],
          msg: 'Buy rate cannot be negative'
        },
        isDecimal: {
          msg: 'Buy rate must be a decimal number'
        }
      },
      comment: 'Rate at which we buy this currency'
    },
    sell_rate: {
      type: DataTypes.DECIMAL(20, 10),
      allowNull: false,
      validate: {
        min: {
          args: [0],
          msg: 'Sell rate cannot be negative'
        },
        isDecimal: {
          msg: 'Sell rate must be a decimal number'
        },
        isGreaterThanBuyRate(value) {
          if (parseFloat(value) <= parseFloat(this.buy_rate)) {
            throw new Error('Sell rate must be greater than buy rate');
          }
        }
      },
      comment: 'Rate at which we sell this currency'
    },
    adjustment_formula: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Formula used to adjust this rate based on base currency'
    },
    last_updated: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: 'Timestamp of last rate update'
    }
  }, {
    tableName: 'exchange_rates',
    timestamps: false,
    underscored: true,
    paranoid: true, // Enables soft deletes
    indexes: [
      {
        unique: true,
        fields: ['currency_code'],
        name: 'unique_currency_code'
      },
      {
        fields: ['rate_type'],
        name: 'idx_rate_type'
      },
      {
        fields: ['last_updated'],
        name: 'idx_rate_updates'
      }
    ],
    comment: 'Table storing all currency exchange rates'
  });

  // Hooks
  ExchangeRate.beforeSave((rate) => {
    // Auto-uppercase currency code
    if (rate.changed('currency_code')) {
      rate.currency_code = rate.currency_code.toUpperCase();
    }

    // Set base_rate for base currency type
    if (rate.rate_type === 'base') {
      rate.base_rate = 1.0;
      rate.buy_rate = 1.0;
      rate.sell_rate = 1.0;
      rate.adjustment_formula = 'base';
    }

    // Update timestamp on changes
    if (rate.changed()) {
      rate.last_updated = new Date();
    }
  });

  // Instance methods
  ExchangeRate.prototype.calculateSpread = function() {
    if (this.buy_rate > 0) {
      return ((this.sell_rate - this.buy_rate) / this.buy_rate * 100).toFixed(2);
    }
    return 0;
  };

  ExchangeRate.prototype.getMidRate = function() {
    return (parseFloat(this.buy_rate) + parseFloat(this.sell_rate)) / 2;
  };

  // Class methods
  ExchangeRate.findBaseCurrency = function() {
    return this.findOne({
      where: { rate_type: 'base' }
    });
  };

  ExchangeRate.findByRateType = function(type) {
    return this.findAll({
      where: { rate_type: type },
      order: [['currency_code', 'ASC']]
    });
  };

  return ExchangeRate;
};