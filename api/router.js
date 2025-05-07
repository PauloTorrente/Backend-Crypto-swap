const express = require('express');
const router = express.Router();

// Import routes
const exchangeRouter = require('./exchange/exchange.router');
const authRouter = require('./auth/auth.router');
const usersRouter = require('./users/users.router');

// Use routes with proper prefixes
router.use('/rates', exchangeRouter);  
router.use('/auth', authRouter);       
router.use('/users', usersRouter);     

module.exports = router;
