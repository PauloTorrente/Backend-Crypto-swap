const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  
  console.log('🔎 Received auth header:', authHeader); // Log 1
  console.log('🔍 Extracted token:', token); // Log 2

  if (!token) {
    console.log('🚫 No token provided'); // Log 3
    return res.status(403).json({ message: 'Token is required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, decoded) => {
    if (err) {
      console.log('❌ Token verification failed:', err.message); // Log 4
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    console.log('✅ Token decoded successfully:', decoded); // Log 5
    req.user = decoded;
    next();
  });
};

const checkAdmin = (req, res, next) => {
  console.log('🛂 User data in checkAdmin:', req.user); // Log 6
  
  if (!req.user) {
    console.log('👤 No user data in request'); // Log 7
    return res.status(403).json({ message: 'Access denied: no user data' });
  }

  if (req.user.role !== 'admin') {
    console.log('🚷 User role is not admin:', req.user.role); // Log 8
    return res.status(403).json({ message: 'Access denied: admin only' });
  }

  console.log('🆗 Admin access granted'); // Log 9
  next();
};

module.exports = {
  verifyToken,
  checkAdmin
};
