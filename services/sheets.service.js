// Envia registros para a planilha do Google Drive através de um Apps Script publicado como
// aplicativo da web (ver scripts/google-sheets/Cambios.gs).
// Configuração no .env: SHEETS_WEBHOOK_URL e SHEETS_WEBHOOK_SECRET.

const TIMEOUT_MS = 20000;

function isConfigured() {
  return Boolean(process.env.SHEETS_WEBHOOK_URL && process.env.SHEETS_WEBHOOK_SECRET);
}

async function upsertCambioRow(row) {
  if (!isConfigured()) {
    throw new Error('Planilha não configurada (SHEETS_WEBHOOK_URL / SHEETS_WEBHOOK_SECRET)');
  }

  // O Apps Script responde com um redirect; o fetch segue e lê o JSON final
  const res = await fetch(process.env.SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: process.env.SHEETS_WEBHOOK_SECRET, action: 'upsertCambio', row }),
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida da planilha (HTTP ${res.status})`);
  }
  if (!body.ok) throw new Error(body.error || 'Erro desconhecido na planilha');
  return body; // { ok: true, row: <número da linha> }
}

module.exports = { isConfigured, upsertCambioRow };
