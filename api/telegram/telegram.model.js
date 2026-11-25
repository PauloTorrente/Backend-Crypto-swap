// Chats do Telegram autorizados (mandaram /start com a senha certa)
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'TelegramSubscriber',
    {
      chat_id: { type: DataTypes.STRING, primaryKey: true },
      name: { type: DataTypes.STRING },
    },
    { tableName: 'telegram_subscribers', timestamps: true }
  );
