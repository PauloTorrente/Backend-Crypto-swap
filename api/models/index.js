const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const sequelize = require('../../config/database');
const { DataTypes } = require('sequelize'); 

const ExchangeRate = require('../exchange/exchange.model')(sequelize, DataTypes);

// Sincroniza os modelos com o banco de dados
async function syncModels() {
  try {
    await sequelize.sync({ alter: true });
    console.log('✅ Modelos sincronizados com o banco de dados');
  } catch (error) {
    console.error('❌ Erro ao sincronizar modelos:', error);
  }
}

module.exports = {
  ExchangeRate,
  syncModels
};
