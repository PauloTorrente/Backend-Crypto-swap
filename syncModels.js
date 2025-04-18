const sequelize = require('./config/database');
const User = require('./api/users/users.model');

async function syncDatabase() {
  try {
    console.log('🔄 Sincronizando modelos com o banco de dados...');
    
    // Forçar recriação das tabelas (apenas em desenvolvimento)
    await User.sync({ force: true });
    console.log('✅ Tabela users criada com sucesso');
    
    console.log('🎉 Banco de dados sincronizado com sucesso!');
  } catch (error) {
    console.error('❌ Erro durante a sincronização:', error);
  } finally {
    await sequelize.close();
  }
}

syncDatabase();
