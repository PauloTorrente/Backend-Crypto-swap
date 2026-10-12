const express = require('express');
const controller = require('./exchange.controller');
const router = express.Router();

// Rotas CRUD
router.get('/', controller.getAllRates);              // GET /api/rates
router.get('/pairs', controller.getPairRates);       // GET /api/rates/pairs (antes de /:currencyCode)
router.get('/history/download', controller.downloadHistory); // GET /api/rates/history/download?from=&to=
router.get('/:currencyCode', controller.getRate);    // GET /api/rates/BRL
router.patch('/:currencyCode', controller.updateRate); // PATCH /api/rates/BRL
router.post('/', controller.addCurrency);            // POST /api/rates
router.delete('/:currencyCode', controller.removeCurrency); // DELETE /api/rates/BRL

// Rota de Conversão
router.post('/convert', controller.convert);         // POST /api/rates/convert

module.exports = router;
