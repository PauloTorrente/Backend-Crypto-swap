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
  ANALYSIS: '[ ?? ] EM ANALISE',
  PENDING: '[ .. ] PROCESSANDO',
  INITIAL: '[ .. ] PROCESSANDO',
};
const STATUS_EMOJI = { PAID: '✅', SCHEDULED: '🕒', EXPIRED: '⌛', CANCELED: '🚫', ERROR: '❌', ANALYSIS: '🔎', PENDING: '⏳', INITIAL: '⏳' };

// ------------------------------------------------------------------ mensagens
// Classifica o aviso da GOWD: 'out' (enviado), 'in' (recebido) ou null (outro tipo de evento).
// A GOWD nem sempre manda "event": um Pix enviado pelo painel chega como type "TRANSFER"
// só com ownerBank/receiver.
function gowdDirection(p) {
  const event = String(p.event || '');
  const type = String(p.type || '');
  if (event.includes('PAYOUT') || ['PAY-OUT', 'PAYOUT', 'TRANSFER'].includes(type)) return 'out';
  if (event.includes('PAYIN') || ['PAY-IN', 'PAYIN', 'LOAD'].includes(type)) return 'in';
  if (p.receiver && !p.payer) return 'out';
  if (p.payer) return 'in';
  return null;
}

const pixKeyOf = (person) => {
  const pix = (person && person.bank && person.bank.pix) || {};
  return pix.key ? `${pix.type ? pix.type + ' ' : ''}${pix.key}` : null;
};

// Postbacks da GOWD (ORDER-PAYIN.* / ORDER-PAYOUT.* / LOAD / TRANSFER)
function gowdEvent(p) {
  const event = p.event || '';
  const status = p.status || '';
  const amount = p.amount || {};
  const valor = fmtMoney(amount.value, amount.currency || 'BRL');
  const method = str(p.paymentMethod);
  const saida = gowdDirection(p) === 'out';
  const who = (saida ? p.receiver : p.payer) || {};

  const header = saida
    ? ['>>>  $ TRANSFERENCIA $  >>>', 'E N V I A D A']
    : ['<<<  $ TRANSFERENCIA $  <<<', 'R E C E B I D A'];
  const title = `${saida ? '💸' : '💰'} <b>${escapeHtml(method)} ${saida ? 'ENVIADO' : 'RECEBIDO'}</b> ${STATUS_EMOJI[status] || ''}`;

  const list = [
    [saida ? 'Para' : 'De', who.name],
    ['Doc', docOf(who)],
    ['Banco', bankOf(who)],
  ];
  if (pixKeyOf(who)) list.push(['Chave', pixKeyOf(who)]);
  list.push(['Metodo', method], ['Data', fmtDate(p.paidAt || p.updatedAt)]);
  if (saida && status === 'SCHEDULED' && p.scheduledAt) list.push(['Agenda', fmtDate(p.scheduledAt)]);
  if (p.description) list.push(['Descr.', p.description]);
  if (status === 'ERROR' && p.message) list.push(['Erro', p.message]);

  const art = card(
    header,
    [`${saida ? '-' : '+'} ${valor}`, STATUS_LABEL[status] || status],
    list,
    [event || p.type].filter(Boolean)
  );
  const extras = [];
  if (p.endToEndId) extras.push(`🔑 E2E: <code>${escapeHtml(p.endToEndId)}</code>`);
  if (status === 'ANALYSIS') {
    extras.push('⚠️ <b>Pix retido pela GOWD para análise.</b> Aprove no Internet Banking da GOWD com o código enviado por e-mail (prazo: 24h).');
  }
  return wrapPre(title, art, extras.join('\n'));
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

// Outros eventos (KYC, ACCOUNT, ...): cartão genérico em vez de JSON cru
function gowdOther(p) {
  const name = String(p.event || p.type || 'EVENTO');
  const list = [
    ['Status', p.status],
    ['Data', fmtDate(p.updatedAt || p.createdAt)],
  ];
  if (p.message) list.push(['Msg', p.message]);
  if (p.id) list.push(['ID', p.id]);
  return wrapPre(
    `ℹ️ <b>Evento GOWD: ${escapeHtml(name)}</b>`,
    card(['[i]  AVISO DA GOWD  [i]'], [name], list)
  );
}

// /saldo: { PAYMENT: {balance, provisioned} | {error}, ADMINISTRATIVE: ... }
function balance(b) {
  const money = (x) => (x && x.value !== undefined ? fmtMoney(x.value, x.currency || 'BRL') : 'indisponivel');
  const pay = b.PAYMENT || {};
  const adm = b.ADMINISTRATIVE || {};
  const list = [];
  if (adm.error) list.push(['Admin.', 'erro ao consultar']);
  else {
    list.push(['Admin.', money(adm.balance)]);
    if (adm.provisioned && Number(adm.provisioned.value)) list.push(['A comp.', money(adm.provisioned)]);
  }
  list.push(['Data', fmtDate()]);
  const art = card(
    ['$$$   SALDO  DA  CONTA   $$$', 'G O W D'],
    pay.error ? ['erro ao consultar'] : [money(pay.balance), 'CONTA PAGAMENTO'],
    list
  );
  return wrapPre('🏦 <b>Saldo GOWD</b>', art);
}

// ------------------------------------------------------------------ /pix
const KEY_LABEL = { CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'E-mail', PHONE: 'Celular', RANDOM: 'Aleatoria', QRCODE: 'Copia e cola' };

const receiverRows = (o) => [
  ...(o.receiver_name ? [['Para', o.receiver_name]] : []),
  ...(o.receiver_city ? [['Cidade', o.receiver_city]] : []),
];

function pixConfirm(o, minutes) {
  const art = card(
    ['>>> CONFIRMAR ENVIO PIX >>>'],
    [`- ${fmtMoney(o.amount)}`, '[ ?? ] AGUARDANDO OK'],
    [
      ...receiverRows(o),
      ['Chave', o.pix_key],
      ['Tipo', KEY_LABEL[o.key_type] || o.key_type],
      ['Descr.', o.description],
      ['Pedido', o.requested_by],
    ],
    [`expira em ${minutes} min`]
  );
  const tip = o.receiver_name
    ? 'Confira o recebedor e o valor (lidos do Pix copia e cola).'
    : 'Confira a chave e o valor. O nome do destinatário aparece no aviso da GOWD após o envio.';
  return wrapPre('💸 <b>Confirmar Pix?</b>', art, tip);
}

const RESULT = {
  SENDING: ['⏳ <b>Enviando Pix...</b>', '[ .. ] ENVIANDO'],
  SENT: ['✅ <b>Pix enviado para a GOWD</b>', '[ OK ] SOLICITADO'],
  FAILED: ['❌ <b>Pix NÃO enviado</b>', '[ !! ] FALHOU'],
  CANCELED: ['🚫 <b>Pix cancelado</b>', '[ XX ] CANCELADO'],
  EXPIRED: ['⌛ <b>Confirmação expirada</b>', '[ -- ] EXPIRADO'],
};

function pixResult(o, state, r = {}) {
  const [title, label] = RESULT[state] || RESULT.FAILED;
  const list = [
    ...receiverRows(o),
    ['Chave', o.pix_key],
    ['Tipo', KEY_LABEL[o.key_type] || o.key_type],
    ['Descr.', o.description],
  ];
  if (r.status) list.push(['GOWD', STATUS_LABEL[r.status] || r.status]);
  if (r.errorMessage) list.push(['Erro', r.errorMessage]);
  list.push(['Data', fmtDate()]);
  let extra = '';
  if (state === 'SENT') extra = 'O comprovante chega como aviso <b>PIX ENVIADO</b> quando a GOWD concluir.';
  if (r.status === 'ANALYSIS') extra = '⚠️ Retido para análise: aprove no Internet Banking da GOWD (código por e-mail, prazo 24h).';
  return wrapPre(title, card(['>>>   ENVIO PIX (BOT)   >>>'], [`- ${fmtMoney(o.amount)}`, label], list), extra);
}

// ---------------------------------------------------------------- /cambio
// pairs: { bob_per_brl, margin, BOB_BRL, BRL_BOB } | usdt: { BRL: {mid, sources}, BOB: {...} }
function cambio(pairs, usdt, amount, defaultMargin) {
  const n = (v, d = 4) => Number(v).toFixed(d);
  const custom = defaultMargin !== undefined && Math.abs(pairs.margin - defaultMargin) > 1e-9;
  const list = [
    ['BOB->BRL', n(pairs.BOB_BRL)],
    ['BRL->BOB', n(pairs.BRL_BOB)],
  ];
  if (amount > 0) {
    const br = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    list.push(['Simul.', `${br(amount)} BRL = ${br(amount * pairs.BRL_BOB)} BOB`]);
    list.push(['Simul.', `${br(amount)} BOB = ${br(amount / pairs.BOB_BRL)} BRL`]);
  }
  const footer = [];
  for (const [cur, label] of [['BRL', 'USDT/BRL spot'], ['BOB', 'USDT/BOB p2p']]) {
    const u = usdt[cur];
    if (!u) continue;
    footer.push(`${label}: ${n(u.mid)}`);
    for (const s of u.sources || []) footer.push(`${s.exchange} ${n(s.buy)}/${n(s.sell)}`);
  }
  const art = card(
    ['$$$   CAMBIO  BOB/BRL   $$$'],
    [
      `BOB/BRL ${n(pairs.bob_per_brl)}`,
      `margem ${n(pairs.margin, 3)}` + (custom ? ` (padrao ${n(defaultMargin, 3)})` : ''),
    ],
    [...list, ['Data', fmtDate()]],
    footer
  );
  const line =
    `BOB/BRL ${n(pairs.bob_per_brl)} | BOB→BRL ${n(pairs.BOB_BRL)} | ` +
    `BRL→BOB ${n(pairs.BRL_BOB)} (margem ${n(pairs.margin, 3)})`;
  const title = custom ? `💱 <b>Câmbio BOB/BRL</b> — margem ${n(pairs.margin, 3)}` : '💱 <b>Câmbio BOB/BRL</b>';
  const note = custom ? '\n<i>Simulação com margem personalizada. A cotação do sistema continua com a margem padrão.</i>' : '';
  return wrapPre(title, art, `<code>${escapeHtml(line)}</code>${note}`);
}

// ----------------------------------------------------------------- /lucro
// r = resultado do withProfit (cambios.service), com os preços USDT de agora
function lucro(r) {
  const br = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const cur = (v, c) => (c === 'BRL' ? `R$ ${br(v)}` : `Bs ${br(v)}`);
  const ganho = r.profit_usdt >= 0;
  const art = card(
    ['$$$  SIMULACAO DE LUCRO  $$$'],
    [`${ganho ? '+' : '-'} R$ ${br(Math.abs(r.profit_brl))}`, `${br(r.profit_usdt, 2)} USDT | ${br(r.margin * 100, 2)}%`],
    [
      ['Recebe', cur(r.amount_received, r.currency_received)],
      ['  =USDT', br(r.received_usdt, 2)],
      ['Entrega', cur(r.amount_delivered, r.currency_delivered)],
      ['  =USDT', br(r.delivered_usdt, 2)],
      ['Mercado', cur(r.market_delivery, r.currency_delivered)],
      ['Data', fmtDate()],
    ],
    [
      `USDT/BRL ${Number(r.currency_received === 'BRL' ? r.usdt_price_received : r.usdt_price_delivered).toFixed(4)}`,
      `USDT/BOB ${Number(r.currency_received === 'BOB' ? r.usdt_price_received : r.usdt_price_delivered).toFixed(4)}`,
    ]
  );
  const title = ganho ? '📈 <b>Lucro do câmbio</b>' : '📉 <b>PREJUÍZO no câmbio</b>';
  return wrapPre(title, art, '<i>Simulação com o preço do USDT de agora. Nada foi registrado.</i>');
}

module.exports = { lucro, cambio, money: fmtMoney, pixConfirm, pixResult, escapeHtml, gowdDirection, gowdEvent, gowdOther, balance, loginAttempt, accessGranted, startup };
