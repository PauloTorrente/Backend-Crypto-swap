const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');

// Route to login and get a JWT
router.post('/login', authController.login);

module.exports = router;
