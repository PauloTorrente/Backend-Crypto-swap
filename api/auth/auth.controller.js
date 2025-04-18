const authService = require('./auth.service');

// Handle user login and return JWT if credentials are valid
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const token = await authService.authenticateUser(email, password);

    if (!token) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    res.json({ token });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

module.exports = {
  login
};
