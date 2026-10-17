// Cria um usuário admin (ou promove um existente) e define a senha.
// Uso: node scripts/create-admin.js email@exemplo.com "senha"
require('dotenv').config();
const sequelize = require('../config/database');
const User = require('../api/users/users.model');

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Uso: node scripts/create-admin.js email@exemplo.com "senha"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('A senha precisa ter pelo menos 8 caracteres');
    process.exit(1);
  }

  await sequelize.sync();
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    existing.role = 'admin';
    existing.password = password; // o hook beforeUpdate faz o hash
    await existing.save();
    console.log(`✅ ${email} agora é admin (senha atualizada)`);
  } else {
    await User.create({ email, password, role: 'admin' });
    console.log(`✅ Admin ${email} criado`);
  }
  await sequelize.close();
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
