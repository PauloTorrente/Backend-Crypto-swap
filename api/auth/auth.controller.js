const authService = require('./auth.service');
const { notifyLogin } = require('../../services/telegram.service');

// Handle user login and return JWT if credentials are valid
const login = async (req, res) => {
  const { email, password } = req.body;
  const info = {
    email,
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip,
    user_agent: req.headers['user-agent'],
  };

  try {
    const token = await authService.authenticateUser(email, password);

    if (!token) {
      notifyLogin({ ...info, success: false, reason: 'Email ou senha inválidos' });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    notifyLogin({ ...info, success: true });
    res.json({ token });
  } catch (error) {
    console.error('❌ Login error:', error);
    notifyLogin({ ...info, success: false, reason: 'Erro no servidor' });
    res.status(500).json({ message: 'Server error during login' });
  }
};

module.exports = {
  login
};
