const { Sequelize } = require('sequelize');
require('dotenv').config();

// Sem DATABASE_URL no .env, usa uma URL fictícia só para o servidor subir.
// O Sequelize só conecta na primeira query, então as rotas que usam o banco vão falhar.
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/placeholder';

// Crie a instância do Sequelize
const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  logging: false, // true/console.log mostra todas as queries (polui o log das cotações)
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

// Teste a conexão (desativado enquanto não houver DATABASE_URL)
if (process.env.DATABASE_URL) {
  sequelize.authenticate()
    .then(() => console.log('🟢 Conexão com PostgreSQL estabelecida com sucesso'))
    .catch(err => console.error('🔴 Erro ao conectar ao PostgreSQL:', err));
} else {
  console.warn('⚠️  DATABASE_URL não definida: servidor rodando sem banco de dados');
}

// Exporte a instância sequelize diretamente
module.exports = sequelize;
