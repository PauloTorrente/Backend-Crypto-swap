const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../users/users.model');

const secret = process.env.JWT_SECRET || 'your_jwt_secret';

const authenticateUser = async (email, password) => {
  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      console.warn('⚠️ Autenticação falhou: usuário não encontrado');
      return null;
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.warn('⚠️ Autenticação falhou: senha inválida');
      return null;
    }

    console.info('🔐 Usuário autenticado com sucesso');
    return jwt.sign(
      { id: user.id, role: user.role },
      secret,
      { expiresIn: '4h' }
    );
  } catch (error) {
    console.error('❌ Erro durante o processo de autenticação');
    throw error;
  }
};

module.exports = {
  authenticateUser
};
