// Bot do Telegram: notificações de login e transferências (GOWD), com acesso por senha.
//
// Acesso:  /start SENHA  (ou /start(SENHA))  -> passa a receber os avisos
//          /cambio [margem] [valor]  /lucro  /saldo  /pix  /status  /stop
//
// .env:
//   TELEGRAM_BOT_TOKEN      token do @BotFather
//   BOT_ACCESS_PASSWORD     senha do /start
//   (saldo: ver services/gowd.service.js)
//   TELEGRAM_CHAT_IDS       (opcional) chats fixos que sempre recebem, separados por vírgula
//   PUBLIC_URL              (opcional) URL pública do backend; no Render usa RENDER_EXTERNAL_URL
//
// O Telegram entrega os comandos por webhook em POST /api/telegram/webhook.
const crypto = require('crypto');
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const fmt = require('./telegram.format');
const gowd = require('./gowd.service');
const pix = require('./telegram.pix');
const exchange = require('../api/exchange/exchange.service');
const cambios = require('../api/cambios/cambios.service');
const receipt = require('./receipt.service');

const Subscriber = require('../api/telegram/telegram.model')(sequelize, DataTypes);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = `https://api.telegram.org/bot${TOKEN}`;
const ACCESS_PASSWORD = process.env.BOT_ACCESS_PASSWORD || '';
const FIXED_CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
// Segredo que o Telegram manda no header de cada webhook (derivado do token, sem config extra)
const WEBHOOK_SECRET = crypto.createHash('sha256').update(`webhook:${TOKEN}`).digest('hex').slice(0, 48);

const MAX_FAILS = 5;
const BLOCK_MS = 30 * 60 * 1000;
const fails = new Map(); // chat_id -> { count, blockedUntil }

const enabled = () => Boolean(TOKEN);

async function api(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) console.error(`⚠️ Telegram ${method} ${res.status}: ${await res.text()}`);
  return res;
}

const sendTo = (chatId, text) =>
  api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });

async function recipients() {
  let subs = [];
  try {
    subs = (await Subscriber.findAll({ attributes: ['chat_id'] })).map((s) => s.chat_id);
  } catch (err) {
    console.error('⚠️ Telegram: erro ao ler inscritos:', err.message);
  }
  return [...new Set([...FIXED_CHAT_IDS, ...subs])];
}

// Envia para todos os autorizados. Nunca lança erro (não pode derrubar quem chamou).
async function broadcast(text) {
  if (!enabled()) return;
  try {
    for (const chatId of await recipients()) {
      const res = await sendTo(chatId, text);
      if (res.status === 403) await Subscriber.destroy({ where: { chat_id: chatId } }); // bloqueou o bot
    }
  } catch (err) {
    console.error('⚠️ Falha ao notificar Telegram:', err.message);
  }
}

// Envia uma imagem (PNG) para todos os autorizados. Nunca lança erro.
async function broadcastPhoto(png, caption, filename = 'comprovante.png') {
  if (!enabled()) return;
  try {
    for (const chatId of await recipients()) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('photo', new Blob([png], { type: 'image/png' }), filename);
      const res = await fetch(`${API}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
      if (!res.ok) console.error(`⚠️ Telegram sendPhoto ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error('⚠️ Falha ao enviar comprovante pro Telegram:', err.message);
  }
}

// ------------------------------------------------------------------ eventos
const notifyLogin = (data) => broadcast(fmt.loginAttempt({ ...data, timestamp: new Date().toISOString() }));

async function notifyGowdEvent(p) {
  const dir = fmt.gowdDirection(p);
  if (dir) {
    await broadcast(fmt.gowdEvent(p));
    // Pix enviado e concluído: manda também o comprovante em imagem
    if (dir === 'out' && p.status === 'PAID') {
      try {
        const png = receipt.pixSentReceipt(p);
        const e2e = p.endToEndId ? `\n🔑 <code>${fmt.escapeHtml(p.endToEndId)}</code>` : '';
        await broadcastPhoto(png, `🧾 <b>Comprovante do Pix enviado</b>${e2e}`, `comprovante-${p.endToEndId || p.id || 'pix'}.png`);
      } catch (err) {
        console.error('⚠️ Erro ao gerar comprovante:', err.message);
      }
    }
    return;
  }
  console.log('ℹ️ GOWD evento não-Pix:', JSON.stringify(p).slice(0, 1000)); // payload completo fica no log
  return broadcast(fmt.gowdOther(p));
}

// ----------------------------------------------------------------- comandos
function extractPassword(text) {
  let rest = text.slice('/start'.length);
  if (rest.startsWith('@')) rest = rest.includes(' ') ? rest.slice(rest.indexOf(' ')) : '';
  rest = rest.trim();
  if (rest.startsWith('(') && rest.endsWith(')')) rest = rest.slice(1, -1).trim();
  return rest;
}

function samePassword(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function handleUpdate(update) {
  if (update && update.callback_query) {
    const cb = update.callback_query;
    if (!cb.message || !String(cb.data || '').startsWith('pix:')) return;
    const isSubscriber = Boolean(await Subscriber.findByPk(String(cb.message.chat.id)));
    return pix.handlePixCallback({ cb, isSubscriber, api, broadcast });
  }
  const msg = update && update.message;
  if (!msg || !msg.text || !msg.chat) return;
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const from = msg.from || {};
  const name = from.username ? `@${from.username}` : from.first_name || chatId;
  const reply = (t) => sendTo(chatId, t);
  const sub = await Subscriber.findByPk(chatId);

  if (text.startsWith('/start')) {
    // apaga a mensagem com a senha do histórico do chat
    await api('deleteMessage', { chat_id: chatId, message_id: msg.message_id });
    if (sub) return reply('✅ Você já está cadastrado para receber as notificações.');

    const f = fails.get(chatId) || { count: 0, blockedUntil: 0 };
    if (Date.now() < f.blockedUntil) {
      const mins = Math.ceil((f.blockedUntil - Date.now()) / 60000);
      return reply(`⛔ Muitas tentativas erradas. Tente de novo em ${mins} min.`);
    }

    const password = extractPassword(text);
    if (ACCESS_PASSWORD && password && samePassword(password, ACCESS_PASSWORD)) {
      fails.delete(chatId);
      await Subscriber.upsert({ chat_id: chatId, name });
      console.log(`🔔 Telegram: novo inscrito ${name} (${chatId})`);
      return reply(fmt.accessGranted());
    }

    f.count += 1;
    if (f.count >= MAX_FAILS) Object.assign(f, { count: 0, blockedUntil: Date.now() + BLOCK_MS });
    fails.set(chatId, f);
    console.warn(`⚠️ Telegram: senha errada no /start de ${name} (${chatId})`);
    await reply('🔒 Acesso negado. Use: <code>/start SUA_SENHA</code>');
    return broadcast(
      `⚠️ <b>Tentativa de acesso ao bot com senha errada</b>\n` +
        `Usuário: ${fmt.escapeHtml(name)}\nChat: <code>${fmt.escapeHtml(chatId)}</code>`
    );
  }

  if (!sub) return reply('🔒 Bot privado. Para ter acesso: <code>/start SUA_SENHA</code>');

  if (text.startsWith('/stop')) {
    await sub.destroy();
    return reply('🔕 Você não vai mais receber notificações. /start SENHA para voltar.');
  }
  if (text.startsWith('/saldo')) {
    if (!gowd.configured()) return reply('⚠️ Consulta de saldo não configurada no servidor (credenciais GOWD).');
    try {
      return reply(fmt.balance(await gowd.getBalances()));
    } catch (err) {
      console.error('⚠️ GOWD saldo:', err.message);
      return reply('❌ Não consegui consultar o saldo agora. Tente de novo em instantes.');
    }
  }
  if (text.startsWith('/lucro')) {
    // /lucro 1000 BOB 470  -> cliente manda 1000 BOB, eu entrego 470 BRL
    const m = text.slice(6).match(/([\d.,]+)\s*(bob|brl|bs|r\$)\s+(?:r\$|bs)?\s*([\d.,]+)/i);
    const received = m && pix.parseAmount(m[1]);
    const delivered = m && pix.parseAmount(m[3]);
    if (!m || !(received > 0) || !(delivered > 0)) {
      return reply(
        '📈 <b>Simular lucro</b>\n\n<code>/lucro RECEBIDO MOEDA ENTREGUE</code>\n\n' +
          'Cliente manda 1000 bolivianos e eu entrego 470 reais:\n<code>/lucro 1000 BOB 470</code>\n\n' +
          'Cliente manda 500 reais e eu entrego 1020 bolivianos:\n<code>/lucro 500 BRL 1020</code>'
      );
    }
    const currency = /^(bob|bs)$/i.test(m[2]) ? 'BOB' : 'BRL';
    const other = currency === 'BOB' ? 'BRL' : 'BOB';
    try {
      const prices = await exchange.getUsdtPrices();
      const r = cambios.withProfit({
        currency_received: currency,
        amount_received: received,
        currency_delivered: other,
        amount_delivered: delivered,
        usdt_price_received: prices[currency].mid,
        usdt_price_delivered: prices[other].mid,
      });
      return reply(fmt.lucro(r));
    } catch (err) {
      console.error('⚠️ /lucro:', err.message);
      return reply('❌ Não consegui buscar as cotações agora. Tente de novo em instantes.');
    }
  }
  if (text.startsWith('/cambio')) {
    try {
      // /cambio [margem] [valor]: número < 1 é margem (0.025 ou 0,025); o resto é valor da simulação
      let margin = null;
      let amount = NaN;
      for (const arg of text.split(/\s+/).slice(1)) {
        const asNumber = Number(arg.replace(',', '.'));
        if (asNumber > 0 && asNumber < 1) margin = asNumber;
        else amount = pix.parseAmount(arg);
      }
      const [base, usdt] = await Promise.all([exchange.getPairRates(), exchange.getUsdtPrices()]);
      const pairs = margin === null
        ? base
        : { ...base, margin, BOB_BRL: base.bob_per_brl + margin, BRL_BOB: base.bob_per_brl - margin };
      return reply(fmt.cambio(pairs, usdt, amount, base.margin));
    } catch (err) {
      console.error('⚠️ /cambio:', err.message);
      return reply('❌ Não consegui buscar as cotações agora. Tente de novo em instantes.');
    }
  }
  // /pix, ou um Pix copia e cola colado direto (começa com 000201)
  if (text.startsWith('/pix') || /^000201\S*.*6304[0-9A-Fa-f]{4}/s.test(text)) {
    return pix.handlePixCommand({ chatId, name, text, api, sendTo });
  }
  if (text.startsWith('/status')) {
    const total = await Subscriber.count();
    const since = sub.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return reply(`✅ Cadastrado desde ${fmt.escapeHtml(since)}.\n👥 Inscritos: ${total}`);
  }
  return reply('Comandos: /cambio · /lucro · /saldo · /pix · /status · /stop');
}

// Registra o webhook no Telegram ao subir o servidor
async function setup() {
  if (!enabled()) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN não definido: bot do Telegram desativado');
    return;
  }
  if (!ACCESS_PASSWORD) console.error('🔴 BOT_ACCESS_PASSWORD vazio: ninguém consegue se cadastrar no bot!');
  const base = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  try {
    if (base) {
      await api('setWebhook', {
        url: `${base.replace(/\/$/, '')}/api/telegram/webhook`,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
      });
      await api('setMyCommands', {
        commands: [
          { command: 'start', description: 'Ativar notificações (com senha)' },
          { command: 'cambio', description: 'Cotação BOB/BRL (ex: /cambio 0.025 1000)' },
          { command: 'lucro', description: 'Simular lucro: /lucro 1000 BOB 470' },
          { command: 'saldo', description: 'Saldo da conta GOWD' },
          { command: 'pix', description: 'Enviar Pix: /pix CHAVE VALOR' },
          { command: 'status', description: 'Ver se está cadastrado' },
          { command: 'stop', description: 'Parar notificações' },
        ],
      });
      console.log('🤖 Telegram: webhook registrado');
      await broadcast(fmt.startup());
    } else {
      console.warn('⚠️  Sem PUBLIC_URL/RENDER_EXTERNAL_URL: bot só envia avisos, comandos (/start) desativados');
    }
  } catch (err) {
    console.error('⚠️ Telegram: erro no setup:', err.message);
  }
}

module.exports = { Subscriber, WEBHOOK_SECRET, setup, handleUpdate, notifyLogin, notifyGowdEvent, broadcast };
