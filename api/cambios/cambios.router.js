const express = require('express');
const service = require('./cambios.service');

const router = express.Router();

const fail = (res, status, message, error) => {
  if (error) console.error(`❌ ${message}:`, error.message);
  res.status(status).json({ success: false, message, ...(error && { error: error.message }) });
};

// GET /api/cambios?limit=50
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json({ success: true, data: await service.list(limit), sheets: service.sheetsConfigured() });
  } catch (error) {
    fail(res, 500, 'Failed to list cambios', error);
  }
});

// POST /api/cambios { client, currency_received, amount_received, amount_delivered?, note? }
router.post('/', async (req, res) => {
  try {
    const record = await service.create(req.body);
    console.log(`📝 Cambio ${record.id}: ${record.client} ${record.amount_received} ${record.currency_received}`);
    res.status(201).json({ success: true, data: record });
  } catch (error) {
    fail(res, 400, 'Failed to create cambio', error);
  }
});

// PATCH /api/cambios/:id { amount_delivered?, client?, note? }
router.patch('/:id', async (req, res) => {
  try {
    const record = await service.update(req.params.id, req.body);
    if (!record) return fail(res, 404, 'Cambio not found');
    res.json({ success: true, data: record });
  } catch (error) {
    fail(res, 400, 'Failed to update cambio', error);
  }
});

// POST /api/cambios/:id/sync (tenta enviar de novo para a planilha)
router.post('/:id/sync', async (req, res) => {
  try {
    const record = await service.retrySync(req.params.id);
    if (!record) return fail(res, 404, 'Cambio not found');
    res.json({ success: true, data: record });
  } catch (error) {
    fail(res, 500, 'Failed to sync cambio', error);
  }
});

module.exports = router;
