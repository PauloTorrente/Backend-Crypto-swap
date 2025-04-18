const express = require('express');
const router = express.Router();

// Import routes
const exchangeRouter = require('./exchange/exchange.router');
const authRouter = require('./auth/auth.router');
const usersRouter = require('./users/users.router');

// Use routes
router.use('/exchange', exchangeRouter);  // Exchange rate routes
router.use('/auth', authRouter);          // Authentication routes
router.use('/users', usersRouter);        // User routes

module.exports = router;
