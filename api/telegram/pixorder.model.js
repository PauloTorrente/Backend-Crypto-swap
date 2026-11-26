// Pedidos de Pix feitos pelo bot do Telegram (auditoria + controle de limite diário)
// status: AWAITING (esperando confirmação) -> SENDING -> SENT | FAILED ; ou CANCELED / EXPIRED
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'TelegramPixOrder',
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      chat_id: { type: DataTypes.STRING, allowNull: false },
      requested_by: { type: DataTypes.STRING },
      pix_key: { type: DataTypes.STRING, allowNull: false },
      key_type: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      description: { type: DataTypes.STRING },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'AWAITING' },
      gowd_id: { type: DataTypes.STRING },
      gowd_status: { type: DataTypes.STRING },
      error: { type: DataTypes.TEXT },
      message_id: { type: DataTypes.INTEGER },
    },
    { tableName: 'telegram_pix_orders', timestamps: true }
  );
