/**
 * Recebe os registros de câmbio do backend e escreve na aba "Cambios".
 *
 * Instalação (uma vez):
 *   1. Na planilha (formato Google Sheets): Extensões → Apps Script → cole este arquivo.
 *   2. Configurações do projeto (engrenagem) → Propriedades do script → adicionar
 *      SECRET = o mesmo valor de SHEETS_WEBHOOK_SECRET do backend.
 *   3. Implantar → Nova implantação → tipo "App da Web":
 *      Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *   4. Copie a URL do app da Web para SHEETS_WEBHOOK_URL no backend.
 *
 * Só escreve as colunas A–J (ID, Fecha, Cliente, Moneda recibida, Monto recibido,
 * Moneda entregada, Monto entregado, Precio USDT recibida, Precio USDT entregada, Nota).
 * As colunas K–R continuam sendo as fórmulas da planilha.
 */

const SHEET_NAME = 'Cambios';
const FIRST_DATA_ROW = 2;
const COL_ID = 1;      // A
const COL_CLIENT = 3;  // C

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || body.secret !== secret) return json({ ok: false, error: 'Não autorizado' });
    if (body.action !== 'upsertCambio') return json({ ok: false, error: 'Ação desconhecida' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000); // evita dois registros na mesma linha
    try {
      return json({ ok: true, row: upsertCambio(body.row) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// Para testar no navegador se a URL está funcionando
function doGet() {
  return json({ ok: true, sheet: SHEET_NAME });
}

function upsertCambio(r) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Aba "' + SHEET_NAME + '" não encontrada');

  const row = findRow(sheet, r.id);
  sheet.getRange(row, 1, 1, 10).setValues([[
    r.id,
    new Date(r.date),
    r.client,
    r.currency_received,
    r.amount_received,
    r.currency_delivered,
    r.amount_delivered === null ? '' : r.amount_delivered,
    r.usdt_price_received,
    r.usdt_price_delivered,
    r.note || ''
  ]]);
  return row;
}

// Linha do registro (pelo ID na coluna A) ou a primeira linha livre depois do último cliente.
// As colunas de fórmula vão até o fim da aba, por isso não dá para usar getLastRow().
function findRow(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < FIRST_DATA_ROW) return FIRST_DATA_ROW;

  const values = sheet.getRange(FIRST_DATA_ROW, 1, lastRow - FIRST_DATA_ROW + 1, COL_CLIENT).getValues();
  let lastUsed = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i][COL_ID - 1] === id) return FIRST_DATA_ROW + i;
    if (values[i][COL_CLIENT - 1] !== '' || values[i][COL_ID - 1] !== '') lastUsed = i;
  }
  return FIRST_DATA_ROW + lastUsed + 1;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
