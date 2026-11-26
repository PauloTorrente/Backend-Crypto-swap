// Comprovante de Pix enviado (imagem PNG) com a identidade visual do site DonJuan (sitio-web):
// azul-marinho #0a2540, verde-água #00c9a7, fundo #f1f5f9, fonte Inter, logo em branco.
//
// Os dados vêm do aviso (webhook) da GOWD. NÃO é o comprovante oficial da instituição:
// é um recibo da DonJuan; a transação é verificável pelo ID E2E.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ASSETS = path.join(__dirname, '..', 'assets');
const FONT_FILES = ['Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-ExtraBold.ttf'].map((f) =>
  path.join(ASSETS, 'fonts', f)
);
let logoB64 = null;
const logo = () => (logoB64 ??= fs.readFileSync(path.join(ASSETS, 'logo.png')).toString('base64'));

const C = {
  primary: '#0a2540',
  primaryLight: '#1a3a5c',
  accent: '#00c9a7',
  danger: '#e63946',
  bg: '#f1f5f9',
  card: '#ffffff',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0',
};

const W = 1080;
const PAD = 72;

const esc = (t) =>
  String(t ?? '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return String(iso);
  const opt = { timeZone: 'America/Sao_Paulo' };
  const date = d.toLocaleDateString('pt-BR', { ...opt, day: '2-digit', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { ...opt, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date}, ${time}`;
}

function doc(d) {
  if (!d) return null;
  const type = typeof d === 'object' ? d.type : null;
  const num = String(typeof d === 'object' ? d.number : d);
  const digits = num.replace(/\D/g, '');
  if (!num.includes('*') && digits.length === 14) {
    return `CNPJ ${digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`;
  }
  if (!num.includes('*') && digits.length === 11) {
    return `CPF ${digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}`;
  }
  return `${type ? type + ' ' : ''}${num}`;
}

// Quebra de linha aproximada (Inter ~0.55em por caractere)
function wrap(text, fontSize, maxWidth) {
  const max = Math.max(8, Math.floor(maxWidth / (fontSize * 0.62)));
  const out = [];
  let cur = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= max) cur += ' ' + word;
    else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out.length ? out : ['-'];
}

// Monta as seções a partir do payload da GOWD (Pix enviado)
function sectionsFrom(p) {
  const r = p.receiver || {};
  const rb = r.bank || {};
  const o = p.ownerBank || {};
  const ob = o.bank || {};
  const pixKey = rb.pix && rb.pix.key ? `${rb.pix.type ? rb.pix.type + ' ' : ''}${rb.pix.key}` : null;
  const agConta = [ob.branch && `Ag ${ob.branch}`, ob.account && `Conta ${ob.account}`].filter(Boolean).join(' · ');

  const s = [
    {
      title: 'Destinatário',
      rows: [
        ['Nome', r.name],
        ['Documento', doc(r.document)],
        ['Instituição', rb.name || rb.ispb],
        ['Chave Pix', pixKey],
      ],
    },
    {
      title: 'Origem',
      rows: [
        ['Nome', o.name],
        ['Documento', doc(o.document)],
        ['Instituição', ob.name || ob.ispb],
        ['Agência / Conta', agConta || null],
      ],
    },
    {
      title: 'Transação',
      rows: [
        ['ID E2E', p.endToEndId],
        ['ID da operação', p.id],
        ['Descrição', p.description || null],
      ],
    },
  ];
  return s.map((sec) => ({ ...sec, rows: sec.rows.filter(([, v]) => v) })).filter((sec) => sec.rows.length);
}

function buildSvg(p) {
  const amount = (p.amount && p.amount.value) ?? p.amount;
  const parts = [];
  let y = 0;

  // ---- cabeçalho azul com logo em branco
  const headerH = 250;
  parts.push(`<rect width="${W}" height="${headerH}" fill="url(#hero)"/>`);
  const logoW = 330;
  const logoH = Math.round((logoW * 308) / 811);
  parts.push(
    `<image href="data:image/png;base64,${logo()}" x="${(W - logoW) / 2}" y="44" width="${logoW}" height="${logoH}" filter="url(#white)"/>`
  );
  parts.push(
    `<text x="${W / 2}" y="${headerH - 40}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="22" letter-spacing="3" fill="#94a3b8">COMPROVANTE DE TRANSFERÊNCIA PIX</text>`
  );
  y = headerH + 70;

  // ---- selo + valor + data
  const pill = 'PIX ENVIADO · CONCLUÍDO';
  const pillW = pill.length * 15 + 48;
  parts.push(
    `<rect x="${(W - pillW) / 2}" y="${y - 38}" width="${pillW}" height="52" rx="26" fill="${C.accent}" fill-opacity="0.15"/>`,
    `<text x="${W / 2}" y="${y - 3}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="22" letter-spacing="1" fill="#00a88a">${esc(pill)}</text>`
  );
  y += 110;
  parts.push(
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="92" letter-spacing="-2" fill="${C.primary}">${esc(money(amount))}</text>`
  );
  y += 58;
  parts.push(
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="Inter" font-size="28" fill="${C.muted}">${esc(dateTime(p.paidAt || p.updatedAt))}</text>`
  );
  y += 60;

  // ---- cartões
  const cardX = PAD;
  const cardW = W - PAD * 2;
  const labelW = 290;
  const valueX = cardX + 40 + labelW;
  const valueMaxW = cardW - 80 - labelW;
  for (const sec of sectionsFrom(p)) {
    const rowsSvg = [];
    let cy = 116;
    for (const [label, value] of sec.rows) {
      const lines = wrap(value, 28, valueMaxW);
      rowsSvg.push(
        `<text x="${cardX + 40}" y="${y + cy}" font-family="Inter" font-size="26" fill="${C.muted}">${esc(label)}</text>`
      );
      lines.forEach((ln, i) =>
        rowsSvg.push(
          `<text x="${valueX}" y="${y + cy + i * 38}" font-family="Inter" font-weight="600" font-size="28" fill="${C.text}">${esc(ln)}</text>`
        )
      );
      cy += 38 * lines.length + 22;
    }
    const cardH = cy + 6;
    parts.push(
      `<rect x="${cardX}" y="${y}" width="${cardW}" height="${cardH}" rx="24" fill="${C.card}" stroke="${C.border}" stroke-width="2" filter="url(#shadow)"/>`,
      `<rect x="${cardX}" y="${y + 24}" width="6" height="40" rx="3" fill="${C.accent}"/>`,
      `<text x="${cardX + 40}" y="${y + 54}" font-family="Inter" font-weight="800" font-size="24" letter-spacing="2" fill="${C.primary}">${esc(sec.title.toUpperCase())}</text>`,
      ...rowsSvg
    );
    y += cardH + 32;
  }

  // ---- rodapé
  y += 16;
  const foot = [
    'Comprovante emitido pela DonJuan com os dados enviados pela instituição',
    'de pagamento. A transação pode ser confirmada pelo ID E2E no Banco Central.',
  ];
  foot.forEach((ln, i) =>
    parts.push(
      `<text x="${W / 2}" y="${y + i * 34}" text-anchor="middle" font-family="Inter" font-size="22" fill="${C.muted}">${esc(ln)}</text>`
    )
  );
  y += foot.length * 34 + 40;
  parts.push(`<rect y="${y}" width="${W}" height="14" fill="${C.accent}"/>`);
  const H = y + 14;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.primary}"/><stop offset="1" stop-color="${C.primaryLight}"/>
    </linearGradient>
    <filter id="white"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.06"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  ${parts.join('\n  ')}
</svg>`;
}

// Retorna o PNG (Buffer) do comprovante de um Pix enviado
function pixSentReceipt(payload) {
  const svg = buildSvg(payload);
  const resvg = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}

module.exports = { pixSentReceipt };
