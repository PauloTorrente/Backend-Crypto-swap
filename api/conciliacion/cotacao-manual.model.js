const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

// Cotação do USDT digitada à mão para um dia. A conciliação só usa quando não há cotação própria
// daquele dia (histórico de cotações ou ordens P2P), em vez de pegar a de outro dia.
const CotacaoManual = sequelize.define('CotacaoManual', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  currency: {
    type: DataTypes.STRING(4),
    allowNull: false,
    validate: { isIn: [['BOB', 'BRL']] }
  },
  price: {
    type: DataTypes.DECIMAL(20, 6),
    allowNull: false,
    validate: { min: 0.000001 },
    comment: 'Preço de 1 USDT na moeda'
  },
  note: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'cotacoes_manuais',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['date', 'currency'] }]
});

module.exports = CotacaoManual;
