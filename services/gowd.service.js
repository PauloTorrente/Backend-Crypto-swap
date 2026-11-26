// Cliente da API da GOWD (mTLS + token). Usado pelo /saldo do bot do Telegram.
//
// .env:
//   GOWD_ENV            prd (padrão) ou hml
//   GOWD_CLIENT_ID      clientId da aplicação
//   GOWD_CLIENT_SECRET  secret da aplicação
//   GOWD_PFX_BASE64     certificado mTLS (.pfx) em base64 (campo "Arquivo PFX (base64)" da GOWD)
//   GOWD_PFX_PASSWORD   senha do PFX
const https = require('https');

const ENV = (process.env.GOWD_ENV || 'prd').toLowerCase() === 'hml' ? 'hml' : 'prd';
const BASE = ENV === 'hml' ? 'mtls-api-platform-hml.gowd.com' : 'mtls-api-platform.gowd.com';
const SCOPES = [`api://app-order-${ENV}/.default`, `api://app-account-${ENV}/.default`];

let agent = null;
const tokens = {}; // scope -> { token, exp }

const configured = () =>
  Boolean(process.env.GOWD_CLIENT_ID && process.env.GOWD_CLIENT_SECRET && process.env.GOWD_PFX_BASE64);

function getAgent() {
  if (!agent) {
    agent = new https.Agent({
      pfx: Buffer.from(process.env.GOWD_PFX_BASE64.replace(/\s+/g, ''), 'base64'),
      passphrase: process.env.GOWD_PFX_PASSWORD || '',
      keepAlive: true,
    });
  }
  return agent;
}

function request(method, path, { body, token, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host: BASE,
        path,
        method,
        agent: getAgent(),
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'donjuan-backend/1.0',
          ...(data && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
          ...(token && { Authorization: `Bearer ${token}` }),
          ...extra,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* corpo não-JSON */ }
          resolve({ status: res.statusCode, json, raw });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout na GOWD')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getToken(scope) {
  const cached = tokens[scope];
  if (cached && Date.now() < cached.exp - 60000) return cached.token;
  const r = await request('POST', '/auth/v1/token', {
    body: { clientId: process.env.GOWD_CLIENT_ID, clientSecret: process.env.GOWD_CLIENT_SECRET, scopes: [scope] },
  });
  if (r.status !== 200 || !r.json || !r.json.token) {
    throw new Error(`token GOWD (${scope}) HTTP ${r.status}: ${String(r.raw).slice(0, 200)}`);
  }
  tokens[scope] = { token: r.json.token, exp: Date.now() + Number(r.json.expiresIn || 3600000) };
  return r.json.token;
}

// GET autenticado. A doc não deixa claro se o saldo usa o escopo Order ou Account:
// tenta Order e, se for negado, tenta Account.
async function authGet(path) {
  let last;
  for (const scope of SCOPES) {
    const r = await request('GET', path, { token: await getToken(scope) });
    if (r.status !== 401 && r.status !== 403) return r;
    last = r;
  }
  return last;
}

// Saldo da conta da empresa: { PAYMENT: {balance, provisioned}, ADMINISTRATIVE: {...} }
async function getBalances() {
  if (!configured()) throw new Error('GOWD não configurada (GOWD_CLIENT_ID / GOWD_CLIENT_SECRET / GOWD_PFX_BASE64)');
  const out = {};
  for (const type of ['PAYMENT', 'ADMINISTRATIVE']) {
    const r = await authGet(`/order/v2/account/balance?accountType=${type}`);
    out[type] = r.status === 200 && r.json
      ? { balance: r.json.balance, provisioned: r.json.provisioned }
      : { error: `HTTP ${r.status}: ${String(r.raw).slice(0, 150)}` };
  }
  return out;
}

// Envia um Pix por chave (PUT /order/v3/payout/brazil). A GOWD resolve o dono da chave no DICT.
// `code` é o nosso id do pedido e também vai como idempotency-key: repetir a chamada não duplica o Pix.
// keyType: CPF | CNPJ | EMAIL | PHONE | RANDOM, ou qrcodeData (Pix copia e cola). amount: número em reais.
async function createPixPayout({ code, key, keyType, qrcodeData, amount, description }) {
  if (!configured()) throw new Error('GOWD não configurada');
  const base = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';
  const body = {
    code,
    amount: { currency: 'BRL', value: Number(amount).toFixed(2) },
    paymentMethod: 'PIX',
    description: description || 'Pix via bot',
    webhookUrl: `${base.replace(/\/$/, '')}/api/webhooks/gowd`,
    bank: { pix: qrcodeData ? { qrcodeData } : { type: keyType, key } },
  };
  const r = await request('PUT', '/order/v3/payout/brazil', {
    body,
    token: await getToken(SCOPES[0]), // escopo Order
    headers: { 'idempotency-key': code },
  });
  if (r.status !== 200 && r.status !== 201) {
    const detail = Array.isArray(r.json) ? r.json.join('; ') : (r.json && (r.json.message || r.json.error)) || r.raw;
    const err = new Error(`GOWD HTTP ${r.status}: ${String(detail).slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return r.json || {};
}

module.exports = { configured, getBalances, createPixPayout, ENV };
