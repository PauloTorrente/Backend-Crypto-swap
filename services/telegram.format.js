// Mensagens do Telegram em ASCII art (bloco <pre> monoespaçado).
// Dentro do <pre> só vão caracteres de largura 1 (sem emoji), senão as bordas desalinham.
// Largura pensada para caber na tela do celular.

const W = 30; // largura interna da caixa
const LABEL = 8; // largura da coluna de rótulos

const escapeHtml = (t) =>
  String(t ?? '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const str = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));

function fmtMoney(value, currency = 'BRL') {
  const v = Number(value);
  if (!Number.isFinite(v)) return `${value} ${currency}`;
  const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + (currency === 'BRL' ? 'R$ ' : `${currency} `) + s;
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return String(iso);
  return d
    .toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    .replace(',', '');
}

const docOf = (p) => {
  const d = (p && p.document) || {};
  return `${d.type || ''} ${d.number || ''}`.trim() || '-';
};
const bankOf = (p) => {
  const b = (p && p.bank) || {};
  return b.name || b.ispb || '-';
};

// ------------------------------------------------------------- desenho da caixa
const center = (t) => {
  t = t.slice(0, W);
  const left = Math.floor((W - t.length) / 2);
  return ' '.repeat(left) + t + ' '.repeat(W - t.length - left);
};
const line = (t = '', align = 'center') =>
  `║${align === 'center' ? center(t) : (' ' + t).padEnd(W).slice(0, W)}║`;
const top = () => '╔' + '═'.repeat(W) + '╗';
const mid = () => '╠' + '═'.repeat(W) + '╣';
const bottom = () => '╚' + '═'.repeat(W) + '╝';

function wrap(text, width) {
  const out = [];
  let cur = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ' ' + word;
    else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out.length ? out : ['-'];
}

function rows(list) {
  const out = [];
  for (const [label, value] of list) {
    wrap(str(value), W - LABEL - 4).forEach((chunk, i) => {
      const prefix = i === 0 ? `${label.padEnd(LABEL)}: ` : ' '.repeat(LABEL + 2);
      out.push(line(prefix + chunk, 'left'));
    });
  }
  return out;
}

function card(header, highlight, list, footer) {
  const l = [top(), ...header.map((h) => line(h)), mid()];
  if (highlight && highlight.length) l.push(line(), ...highlight.map((h) => line(h)), line(), mid());
  l.push(...rows(list));
  if (footer && footer.length) l.push(mid(), ...footer.map((f) => line(f)));
  l.push(bottom());
  return l.join('\n');
}

const wrapPre = (title, art, extra = '') =>
  `${title}\n<pre>${escapeHtml(art)}</pre>` + (extra ? `\n${extra}` : '');

const STATUS_LABEL = {
  PAID: '[ OK ] CONCLUIDO',
  SCHEDULED: '[ .. ] AGENDADO',
  EXPIRED: '[ -- ] EXPIRADO',
  CANCELED: '[ XX ] CANCELADO',
  ERROR: '[ !! ] ERRO',
};
const STATUS_EMOJI = { PAID: '✅', SCHEDULED: '🕒', EXPIRED: '⌛', CANCELED: '🚫', ERROR: '❌' };

// ------------------------------------------------------------------ mensagens
// Postbacks da GOWD (ORDER-PAYIN.* / ORDER-PAYOUT.* / LOAD)
function gowdEvent(p) {
  const event = p.event || '';
  const status = p.status || '';
  const amount = p.amount || {};
  const valor = fmtMoney(amount.value, amount.currency || 'BRL');
  const method = str(p.paymentMethod);
  const saida = event.includes('PAYOUT') || p.type === 'PAY-OUT';
  const who = (saida ? p.receiver : p.payer) || {};

  const header = saida
    ? ['>>>  $ TRANSFERENCIA $  >>>', 'E N V I A D A']
    : ['<<<  $ TRANSFERENCIA $  <<<', 'R E C E B I D A'];
  const title = `${saida ? '💸' : '💰'} <b>${escapeHtml(method)} ${saida ? 'ENVIADO' : 'RECEBIDO'}</b> ${STATUS_EMOJI[status] || ''}`;

  const list = [
    [saida ? 'Para' : 'De', who.name],
    ['Doc', docOf(who)],
    ['Banco', bankOf(who)],
    ['Metodo', method],
    ['Data', fmtDate(p.paidAt || p.updatedAt)],
  ];
  if (saida && status === 'SCHEDULED' && p.scheduledAt) list.push(['Agenda', fmtDate(p.scheduledAt)]);
  if (p.description) list.push(['Descr.', p.description]);
  if (status === 'ERROR' && p.message) list.push(['Erro', p.message]);

  const art = card(
    header,
    [`${saida ? '-' : '+'} ${valor}`, STATUS_LABEL[status] || status],
    list,
    event ? [event] : null
  );
  const extra = p.endToEndId ? `🔑 E2E: <code>${escapeHtml(p.endToEndId)}</code>` : '';
  return wrapPre(title, art, extra);
}

function loginAttempt(d) {
  const ok = Boolean(d.success);
  const title = ok ? '🔓 <b>Login realizado</b>' : '🚨 <b>ALERTA: tentativa de login falhou</b> 🚨';
  const header = ok ? ['[*]  ACESSO AO SISTEMA  [*]'] : ['/!\\  ALERTA DE SEGURANCA  /!\\'];
  const highlight = ok ? ['LOGIN AUTORIZADO', '[ OK ]'] : ['!!! LOGIN NEGADO !!!', '[ XX ]'];
  const list = [
    ['Usuario', d.email],
    ['IP', d.ip],
    ['Browser', d.user_agent],
    ['Data', fmtDate(d.timestamp)],
  ];
  if (d.reason) list.push(['Motivo', d.reason]);
  return wrapPre(title, card(header, highlight, list));
}

function accessGranted() {
  return (
    wrapPre('🔐 <b>Bot liberado</b>', [top(), line('ACESSO  AUTORIZADO'), line('[ OK ]'), bottom()].join('\n')) +
    '\n🔔 Você vai receber os avisos de <b>login</b> e <b>transferências</b>.\nUse /stop para parar.'
  );
}

function startup() {
  const art = [
    top(),
    line(),
    line('____   ___  _   _'),
    line('|  _ \\ / _ \\| \\ | |'),
    line('| | | | | | |  \\| |'),
    line('| |_| | |_| | |\\  |'),
    line('|____/ \\___/|_| \\_|'),
    line(),
    line('J U A N   F I N A N C E'),
    mid(),
    line('bot de notificacoes ONLINE'),
    line(fmtDate()),
    bottom(),
  ].join('\n');
  return wrapPre('🤖 <b>Bot iniciado</b>', art);
}

module.exports = { escapeHtml, gowdEvent, loginAttempt, accessGranted, startup };
