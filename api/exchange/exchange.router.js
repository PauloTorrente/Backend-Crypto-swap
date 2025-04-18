const express = require('express');
const router = express.Router();
const controller = require('./exchange.controller');
const { verifyToken, checkAdmin } = require('../../middlewares/auth.middleware');

// Public routes
router.get('/', controller.getAllRates); // Public route to fetch all exchange rates
router.get('/:currencyCode', controller.getRate); // Public route to fetch rate by currency code

// Admin-protected routes
router.put('/:currencyCode', verifyToken, checkAdmin, controller.updateRate); // Admin route to update rate
router.post('/', verifyToken, checkAdmin, controller.createCurrency); // Admin route to create new currency
router.delete('/:currencyCode', verifyToken, checkAdmin, controller.deleteCurrency); // Admin route to delete a currency

module.exports = router;
