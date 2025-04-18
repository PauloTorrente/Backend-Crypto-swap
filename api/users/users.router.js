const express = require('express');
const router = express.Router();
const usersController = require('./users.controller');

// Route to register a new user
router.post('/register', usersController.registerUser);

// Route to login an existing user
router.post('/login', usersController.loginUser);

module.exports = router;
