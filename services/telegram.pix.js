// /pix pelo bot do Telegram: pedido -> cartão de confirmação com botões -> envio pela GOWD.
//
// Uso:  /pix <chave> <valor> [descrição]
//       /pix 90084148802 150,00 aluguel
//
// Proteções:
//   - só chats inscritos (e, se TELEGRAM_ADMIN_IDS estiver definido, só esses chats)
//   - confirmação com botão, que expira em PIX_CONFIRM_MINUTES (padrão 5)
//   - limite por Pix (PIX_MAX_VALUE, padrão 5000) e por dia (PIX_DAILY_LIMIT, padrão 20000)
//   - todo envio é avisado para todos os inscritos e fica registrado em telegram_pix_orders
const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/database');
const fmt = require('./telegram.format');
const gowd = require('./gowd.service');

const PixOrder = require('../api/telegram/pixorder.model')(sequelize, DataTypes);

const MAX_VALUE = Number(process.env.PIX_MAX_VALUE || 5000);
const DAILY_LIMIT = Number(process.env.PIX_DAILY_LIMIT || 20000);
const CONFIRM_MS = Number(process.env.PIX_CONFIRM_MINUTES || 5) * 60000;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

const canSend = (chatId) => ADMIN_IDS.length === 0 || ADMIN_IDS.includes(String(chatId));

// ---------------------------------------------------------------- parsing
// "1.500,00" -> 1500 | "150,5" -> 150.5 | "150.00" -> 150 | "1500" -> 1500
function parseAmount(raw) {
  let s = String(raw || '').replace(/^R\$/i, '').trim();
  if (!/^[\d.,]+$/.test(s)) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
}

function validCpf(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[len])) return false;
  }
  return true;
}

// Detecta o tipo da chave Pix. Retorna { key, type } ou null.
function parseKey(raw) {
  const k = String(raw || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return { key: k.toLowerCase(), type: 'RANDOM' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return { key: k.toLowerCase(), type: 'EMAIL' };
  const digits = k.replace(/\D/g, '');
  if (k.startsWith('+')) return digits.length >= 12 ? { key: `+${digits}`, type: 'PHONE' } : null;
  if (digits.length === 14 && !/[a-z]/i.test(k)) return { key: digits, type: 'CNPJ' };
  if (digits.length === 11) {
    if (validCpf(digits)) return { key: digits, type: 'CPF' };
    return { key: `+55${digits}`, type: 'PHONE' }; // celular com DDD
  }
  if (digits.length === 13 && digits.startsWith('55')) return { key: `+${digits}`, type: 'PHONE' };
  return null;
}

async function sentToday() {
  // meia-noite de hoje em São Paulo (UTC-3, sem horário de verão)
  const sp = new Date(Date.now() - 3 * 3600000);
  const since = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate(), 3, 0, 0));
  const total = await PixOrder.sum('amount', {
    where: { status: { [Op.in]: ['SENDING', 'SENT'] }, createdAt: { [Op.gte]: since } },
  });
  return Number(total || 0);
}

const USAGE =
  '💸 <b>Enviar Pix</b>\n\n<code>/pix CHAVE VALOR [descrição]</code>\n\n' +
  'Exemplos:\n<code>/pix 90084148802 150,00</code>\n<code>/pix fulano@email.com 1.500,00 aluguel</code>\n' +
  '<code>/pix +5511999998888 50</code>';

// ------------------------------------------------------------ comando /pix
async function handlePixCommand({ chatId, name, text, api, sendTo }) {
  if (!canSend(chatId)) return sendTo(chatId, '⛔ Você não tem permissão para enviar Pix pelo bot.');
  if (!gowd.configured()) return sendTo(chatId, '⚠️ Envio de Pix não configurado no servidor (credenciais GOWD).');

  const [, rawKey, rawAmount, ...descParts] = text.split(/\s+/);
  if (!rawKey || !rawAmount) return sendTo(chatId, USAGE);

  const key = parseKey(rawKey);
  if (!key) return sendTo(chatId, '❌ Chave Pix inválida.\n\n' + USAGE);
  const amount = parseAmount(rawAmount);
  if (!(amount > 0)) return sendTo(chatId, '❌ Valor inválido.\n\n' + USAGE);
  if (amount > MAX_VALUE) {
    return sendTo(chatId, `⛔ Valor acima do limite por Pix do bot (${fmt.money(MAX_VALUE)}). Use o painel da GOWD.`);
  }
  const today = await sentToday();
  if (today + amount > DAILY_LIMIT) {
    return sendTo(
      chatId,
      `⛔ Limite diário do bot atingido: já enviado hoje ${fmt.money(today)} de ${fmt.money(DAILY_LIMIT)}.`
    );
  }

  const description = descParts.join(' ').slice(0, 140) || 'Pix via bot';
  const order = await PixOrder.create({
    chat_id: String(chatId),
    requested_by: name,
    pix_key: key.key,
    key_type: key.type,
    amount,
    description,
  });

  const res = await api('sendMessage', {
    chat_id: chatId,
    text: fmt.pixConfirm(order, CONFIRM_MS / 60000),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Confirmar envio', callback_data: `pix:ok:${order.id}` },
        { text: '❌ Cancelar', callback_data: `pix:no:${order.id}` },
      ]],
    },
  });
  try {
    const body = await res.json();
    if (body && body.result) await order.update({ message_id: body.result.message_id });
  } catch { /* sem message_id: só não dá para editar a mensagem depois */ }
}

// ------------------------------------------------------- clique nos botões
async function handlePixCallback({ cb, isSubscriber, api, broadcast }) {
  const chatId = String(cb.message.chat.id);
  const from = cb.from || {};
  const name = from.username ? `@${from.username}` : from.first_name || chatId;
  const [, action, id] = String(cb.data).split(':');
  const answer = (text) => api('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: true });
  const edit = (text) =>
    api('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text, parse_mode: 'HTML' });

  if (!isSubscriber || !canSend(chatId)) return answer('Sem permissão.');
  const order = await PixOrder.findByPk(id);
  if (!order || order.chat_id !== chatId) return answer('Pedido não encontrado.');

  if (action === 'no') {
    const [n] = await PixOrder.update({ status: 'CANCELED' }, { where: { id, status: 'AWAITING' } });
    if (!n) return answer('Este pedido já foi processado.');
    await answer('Pix cancelado.');
    return edit(fmt.pixResult(order, 'CANCELED'));
  }

  if (Date.now() - new Date(order.createdAt).getTime() > CONFIRM_MS) {
    await PixOrder.update({ status: 'EXPIRED' }, { where: { id, status: 'AWAITING' } });
    await answer('Confirmação expirada. Faça o /pix de novo.');
    return edit(fmt.pixResult(order, 'EXPIRED'));
  }

  // trava contra clique duplo: só um clique muda AWAITING -> SENDING
  const [n] = await PixOrder.update({ status: 'SENDING' }, { where: { id, status: 'AWAITING' } });
  if (!n) return answer('Este pedido já foi processado.');
  await answer('Enviando Pix...');
  await edit(fmt.pixResult(order, 'SENDING'));

  try {
    const r = await gowd.createPixPayout({
      code: order.id,
      key: order.pix_key,
      keyType: order.key_type,
      amount: order.amount,
      description: order.description,
    });
    const failed = ['ERROR', 'CANCELED', 'EXPIRED'].includes(r.status);
    await order.update({
      status: failed ? 'FAILED' : 'SENT',
      gowd_id: r.id,
      gowd_status: r.status,
      error: r.errorMessage || null,
    });
    await edit(fmt.pixResult(order, failed ? 'FAILED' : 'SENT', r));
    console.log(`💸 Pix bot: ${order.id} ${order.amount} -> ${order.pix_key} status=${r.status} por ${name}`);
    if (!failed) {
      await broadcast(
        `🔔 <b>Pix solicitado pelo bot</b> por ${fmt.escapeHtml(name)}: ` +
          `${fmt.escapeHtml(fmt.money(order.amount))} para <code>${fmt.escapeHtml(order.pix_key)}</code>`
      );
    }
  } catch (err) {
    console.error('❌ Pix bot falhou:', err.message);
    await order.update({ status: 'FAILED', error: err.message });
    await edit(fmt.pixResult(order, 'FAILED', { errorMessage: friendlyError(err) }));
  }
}

function friendlyError(err) {
  const m = String(err.message || '');
  if (/Pix key not found/i.test(m)) return 'Chave Pix não encontrada';
  if (/insufficient|saldo/i.test(m)) return 'Saldo insuficiente';
  if (err.status === 403 || /Cloudflare|blocked/i.test(m)) return 'GOWD bloqueou o acesso (IP não liberado?)';
  return m.replace(/^GOWD HTTP \d+: /, '').slice(0, 120);
}

module.exports = { PixOrder, handlePixCommand, handlePixCallback, parseAmount, parseKey, canSend };
