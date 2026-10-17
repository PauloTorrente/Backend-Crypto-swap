const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// Registro de cada operação de câmbio com cliente (espelhado na aba "Cambios" da planilha)
const Cambio = sequelize.define('Cambio', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  client: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  currency_received: {
    type: DataTypes.STRING(4),
    allowNull: false,
    validate: { isIn: [['BOB', 'BRL']] }
  },
  amount_received: {
    type: DataTypes.DECIMAL(20, 2),
    allowNull: false,
    validate: { min: 0.01 }
  },
  currency_delivered: {
    type: DataTypes.STRING(4),
    allowNull: false,
    validate: { isIn: [['BOB', 'BRL']] }
  },
  amount_delivered: {
    type: DataTypes.DECIMAL(20, 2),
    allowNull: true, // preenchido depois, quando o valor é devolvido ao cliente
    validate: { min: 0.01 }
  },
  usdt_price_received: {
    type: DataTypes.DECIMAL(20, 6),
    allowNull: false,
    comment: 'Preço de 1 USDT na moeda recebida no momento do registro (média Binance/Bybit)'
  },
  usdt_price_delivered: {
    type: DataTypes.DECIMAL(20, 6),
    allowNull: false,
    comment: 'Preço de 1 USDT na moeda entregue no momento do registro (média Binance/Bybit)'
  },
  prices: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Preços de cada corretora no momento do registro: { BOB: [{ exchange, buy, sell }], BRL: [...] }'
  },
  note: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sheet_synced_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  sheet_error: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'cambios',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Cambio;
