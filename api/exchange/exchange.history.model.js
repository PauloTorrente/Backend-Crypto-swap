// Histórico das cotações do par BOB/BRL: uma linha a cada registro (o mesmo que aparece no terminal)
module.exports = (sequelize, DataTypes) => {
  const PairRateHistory = sequelize.define('PairRateHistory', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    bob_per_brl: {
      type: DataTypes.DECIMAL(20, 10),
      allowNull: false,
      comment: 'Quantos BOB vale 1 BRL (média das corretoras, sem margem)'
    },
    bob_brl: {
      type: DataTypes.DECIMAL(20, 10),
      allowNull: false,
      comment: 'Taxa BOB → BRL (bob_per_brl + margem)'
    },
    brl_bob: {
      type: DataTypes.DECIMAL(20, 10),
      allowNull: false,
      comment: 'Taxa BRL → BOB (bob_per_brl - margem)'
    },
    margin: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: false
    }
  }, {
    tableName: 'pair_rate_history',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    comment: 'Histórico das cotações BOB/BRL'
  });

  return PairRateHistory;
};
