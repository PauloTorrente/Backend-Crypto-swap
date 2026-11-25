const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const telegram = require('../../services/telegram.service');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Comandos do Telegram (/start, /status, /stop). O Telegram manda o segredo neste header.
router.post('/telegram/webhook', async (req, res) => {
  if (!safeEqual(req.get('X-Telegram-Bot-Api-Secret-Token'), telegram.WEBHOOK_SECRET)) {
    return res.sendStatus(401);
  }
  try {
    await telegram.handleUpdate(req.body);
  } catch (err) {
    console.error('⚠️ Telegram: erro ao tratar comando:', err.message);
  }
  res.sendStatus(200); // sempre 200, senão o Telegram reenvia
});

// Postbacks da GOWD (Pix recebido/enviado). Assinatura: X-Signature-SHA256 = sha256=<hmac hex do corpo>
router.post('/webhooks/gowd', async (req, res) => {
  const secret = process.env.GOWD_WEBHOOK_SECRET;
  if (!secret) {
    console.error('🔴 GOWD_WEBHOOK_SECRET não definido: webhook GOWD recusado');
    return res.sendStatus(503);
  }
  const received = String(req.get('X-Signature-SHA256') || '').replace(/^sha256=/, '').trim();
  const hmac = crypto.createHmac('sha256', secret).update(req.rawBody || '').digest();
  // a doc diz hex; aceita base64 também por garantia
  if (!safeEqual(received.toLowerCase(), hmac.toString('hex')) && !safeEqual(received, hmac.toString('base64'))) {
    console.warn('⚠️ Webhook GOWD com assinatura inválida');
    return res.sendStatus(401);
  }

  const p = req.body || {};
  console.log(`🏦 GOWD event=${p.event} status=${p.status}`);
  await telegram.notifyGowdEvent(p);
  res.json({ returnCode: 'SUCCESS' });
});

module.exports = router;
