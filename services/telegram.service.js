// Bot do Telegram: notificações de login e transferências (GOWD), com acesso por senha.
//
// Acesso:  /start SENHA  (ou /start(SENHA))  -> passa a receber os avisos
//          /status  /stop
//
// .env:
//   TELEGRAM_BOT_TOKEN      token do @BotFather
//   BOT_ACCESS_PASSWORD     senha do /start
//   TELEGRAM_CHAT_IDS       (opcional) chats fixos que sempre recebem, separados por vírgula
//   PUBLIC_URL              (opcional) URL pública do backend; no Render usa RENDER_EXTERNAL_URL
//
// O Telegram entrega os comandos por webhook em POST /api/telegram/webhook.
const crypto = require('crypto');
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const fmt = require('./telegram.format');

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

// ------------------------------------------------------------------ eventos
const notifyLogin = (data) => broadcast(fmt.loginAttempt({ ...data, timestamp: new Date().toISOString() }));

function notifyGowdEvent(p) {
  const event = String(p.event || '');
  if (event.includes('PAYIN') || event.includes('PAYOUT') || ['LOAD', 'PAY-IN', 'PAY-OUT'].includes(p.type)) {
    return broadcast(fmt.gowdEvent(p));
  }
  const resumo = JSON.stringify(p, null, 1).slice(0, 3500);
  return broadcast(
    `ℹ️ <b>Evento GOWD:</b> ${fmt.escapeHtml(event || p.type)}\n<pre>${fmt.escapeHtml(resumo)}</pre>`
  );
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
  if (text.startsWith('/status')) {
    const total = await Subscriber.count();
    const since = sub.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return reply(`✅ Cadastrado desde ${fmt.escapeHtml(since)}.\n👥 Inscritos: ${total}`);
  }
  return reply('Comandos: /status · /stop');
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
        allowed_updates: ['message'],
      });
      await api('setMyCommands', {
        commands: [
          { command: 'start', description: 'Ativar notificações (com senha)' },
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
