const { Sequelize } = require('sequelize');
require('dotenv').config();

// Crie a instância do Sequelize
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  logging: console.log, // Mostra as queries no console
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

// Teste a conexão
sequelize.authenticate()
  .then(() => console.log('🟢 Conexão com PostgreSQL estabelecida com sucesso'))
  .catch(err => console.error('🔴 Erro ao conectar ao PostgreSQL:', err));

// Exporte a instância sequelize diretamente
module.exports = sequelize;