const usersService = require('./users.service');
const jwt = require('jsonwebtoken'); 

const registerUser = async (req, res) => {
  const { email, password, role = 'user' } = req.body;

  try {
    const existingUser = await usersService.findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: 'Email is already in use' });
    }

    const newUser = await usersService.registerUser(email, password, role);
    res.status(201).json({
      message: 'User created successfully',
      user: { email: newUser.email, role: newUser.role }
    });
  } catch (error) {
    console.error('❌ Error registering user:', error);
    res.status(500).json({ message: 'Server error while registering user' });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await usersService.findUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const payload = { 
      id: user.id, 
      role: user.role 
    };
    
    const token = jwt.sign(
      payload, 
      process.env.JWT_SECRET || 'your-secret-key', 
      { expiresIn: '1h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('❌ Error logging in user:', error);
    res.status(500).json({ message: 'Server error while logging in user' });
  }
};

module.exports = {
  registerUser,
  loginUser
};
