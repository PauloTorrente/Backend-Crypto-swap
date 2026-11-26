// Leitura do "Pix copia e cola" (BR Code / EMV do Banco Central).
// Formato TLV: ID (2 dígitos) + tamanho (2 dígitos) + valor. Termina com 6304 + CRC16.

// CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), calculado sobre tudo até "6304" inclusive
function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function parseTLV(str) {
  const out = {};
  let i = 0;
  while (i + 4 <= str.length) {
    const id = str.slice(i, i + 2);
    const len = Number(str.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len)) return null;
    const value = str.slice(i + 4, i + 4 + len);
    if (value.length !== len) return null;
    out[id] = value;
    i += 4 + len;
  }
  return i === str.length ? out : null;
}

// Acha o código dentro do texto da mensagem (o nome do recebedor pode ter espaços).
// Retorna { code, rest } ou null.
function extract(text) {
  const m = String(text).match(/000201.*6304[0-9A-Fa-f]{4}/s);
  if (!m) return null;
  return { code: m[0], rest: String(text).slice(m.index + m[0].length).trim() };
}

// Retorna { valid, error, key, amount, name, city, txid, dynamic, url }
function parse(code) {
  const body = code.slice(0, -4);
  const crc = code.slice(-4).toUpperCase();
  if (!body.endsWith('6304')) return { valid: false, error: 'código incompleto' };
  if (crc16(body) !== crc) return { valid: false, error: 'código corrompido (dígito verificador não confere)' };

  const tlv = parseTLV(code);
  if (!tlv) return { valid: false, error: 'formato inválido' };
  const mai = parseTLV(tlv['26'] || '') || {}; // Merchant Account Information
  if (String(mai['00'] || '').toUpperCase() !== 'BR.GOV.BCB.PIX') return { valid: false, error: 'não é um Pix' };
  const extra = parseTLV(tlv['62'] || '') || {};

  return {
    valid: true,
    key: mai['01'] || null,
    url: mai['25'] || null, // QR dinâmico: o valor fica no servidor de quem cobra
    dynamic: Boolean(mai['25']) || tlv['01'] === '12',
    amount: tlv['54'] ? Number(tlv['54']) : null,
    name: (tlv['59'] || '').trim() || null,
    city: (tlv['60'] || '').trim() || null,
    txid: extra['05'] && extra['05'] !== '***' ? extra['05'] : null,
  };
}

module.exports = { extract, parse, crc16 };
