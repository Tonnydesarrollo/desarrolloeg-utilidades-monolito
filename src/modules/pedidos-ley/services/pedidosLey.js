import fs from 'fs';
import path from 'path';
import mime from 'mime-types';

const APP_ID = (process.env.FINANZAS_APPSHEET_APP_ID || process.env.PEDIDOS_APPSHEET_APP_ID || process.env.APPSHEET_APP_ID || '').trim();
const API_KEY = (process.env.FINANZAS_APPSHEET_API_KEY || process.env.PEDIDOS_APPSHEET_API_KEY || process.env.APPSHEET_API_KEY || '').trim();
const TABLE = (process.env.FINANZAS_APPSHEET_TABLE_PEDIDOS || process.env.PEDIDOS_APPSHEET_TABLE_PEDIDOS || 'PEDIDOS_LEY').trim();
const VIEW = (process.env.FINANZAS_APPSHEET_VIEW_SIN_LIBERACION || 'SIN LIBERACION').trim();
const FILES_DIR = process.env.PEDIDOS_LEY_FILES_DIR || path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'files');
const SENT_LOG_FILE = process.env.PEDIDOS_LEY_SENT_LOG_FILE || path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'sent-log.jsonl');
const CACHE_TTL_MS = Math.max(10_000, Number(process.env.PEDIDOS_LEY_CACHE_TTL_MS || 60_000));
const FACTURADOR_OPTIONS = new Map([
  ['EiHiUQ9YHf4mA-C7L_ziyc', 'SERGIO GONZALEZ CASTILLO'],
  ['xwDqa6Mt6a42iqKHzJG9L6', 'GONZALEZ GAMEZ Y ASOCIADOS'],
]);

let cache = {
  at: 0,
  rows: null,
  pending: null,
  filesAt: 0,
  files: null,
};

ensureDir(FILES_DIR);
ensureDir(path.dirname(SENT_LOG_FILE));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLooseName(value) {
  return normalizeText(value)
    .replace(/[^A-Z0-9\s._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeScalarText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const candidate = value.nombre || value.name || value.label || value.value || '';
    return String(candidate || '').trim();
  }
  return String(value).trim();
}

function extractFacturadorId(row = {}) {
  const candidates = [
    getRowValue(row, ['facturador', 'FACTURADOR', 'Facturador']),
    getRowValue(row, ['facturador.id', 'FACTURADOR.ID', 'Facturador.Id', 'facturadorId', 'FACTURADORID']),
    getRowValue(row, ['facturador.value', 'FACTURADOR.VALUE']),
  ];

  for (const candidate of candidates) {
    const text = normalizeScalarText(candidate);
    if (!text) continue;
    if (FACTURADOR_OPTIONS.has(text)) return text;
    const knownMatch = Array.from(FACTURADOR_OPTIONS.entries()).find(([, name]) => normalizeText(name) === normalizeText(text));
    if (knownMatch) return knownMatch[0];
    return text;
  }

  return '';
}

function resolveFacturadorNombre(facturadorId, row = {}) {
  const fromMap = FACTURADOR_OPTIONS.get(String(facturadorId || '').trim());
  if (fromMap) return fromMap;
  const fromRow = normalizeScalarText(getRowValue(row, ['facturador.nombre', 'FACTURADOR.NOMBRE', 'Facturador.Nombre']));
  return fromRow;
}

function extractYear(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getFullYear();
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoLike = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoLike) {
    const year = Number(isoLike[1]);
    return Number.isFinite(year) ? year : null;
  }

  const numeric = new Date(text);
  if (!Number.isNaN(numeric.getTime())) {
    return numeric.getFullYear();
  }

  return null;
}

function isTruthySent(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return ['SI', 'S', 'YES', 'Y', 'TRUE', '1', 'ENVIADO', 'SENT'].includes(text);
}

function getRowValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
    const normalizedKey = normalizeText(key);
    const matchedKey = Object.keys(row || {}).find((candidate) => normalizeText(candidate) === normalizedKey);
    if (matchedKey && String(row[matchedKey]).trim() !== '') {
      return row[matchedKey];
    }
  }
  return '';
}

function normalizeRow(row = {}) {
  const rowId = normalizeScalarText(getRowValue(row, ['Row ID', 'ROW ID', 'RowId', 'ROWID', 'ID', 'Id', 'id']));
  const facturadorId = extractFacturadorId(row);
  const facturadorNombre = resolveFacturadorNombre(facturadorId, row);
  const fecha = normalizeScalarText(getRowValue(row, ['FECHA', 'Fecha']));
  const status = normalizeScalarText(getRowValue(row, ['STATUS', 'Status', 'ESTATUS', 'Estatus']));
  return {
    rowId,
    pedido: normalizeScalarText(getRowValue(row, ['PEDIDO', 'NO. PEDIDO', 'NO PEDIDO', 'Pedido'])),
    establecimiento: normalizeScalarText(getRowValue(row, ['ESTABLECIMIENTO', 'TIENDA', 'No. Tienda', 'No. tienda', 'No tienda'])),
    facturadorId,
    facturadorNombre,
    fecha,
    fechaYear: extractYear(fecha),
    status,
    enviado: normalizeScalarText(getRowValue(row, ['ENVIADO', 'Enviado'])),
    raw: row,
  };
}

async function appsheetAction(action, rows = [], selector = '') {
  if (!APP_ID || !API_KEY) {
    throw new Error('Faltan variables de AppSheet para finanzas');
  }

  const url = `https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent(TABLE)}/Action`;
  const body = {
    Action: action,
    Properties: {
      Locale: 'es-MX',
      Timezone: 'America/Mexico_City',
    },
    Rows: rows,
  };
  if (selector) {
    body.Properties.Selector = selector;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ApplicationAccessKey: API_KEY,
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (response.ok) {
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    lastError = new Error(`AppSheet ${action} fallo (${response.status}): ${text}`);
    if (!(response.status === 429 || response.status >= 500) || attempt === 4) {
      break;
    }

    await sleep(500 * attempt);
  }

  throw lastError || new Error(`AppSheet ${action} fallo`);
}

async function appsheetFindRows(selector = '') {
  const result = await appsheetAction('Find', [], selector);
  return Array.isArray(result) ? result : (result?.Rows || result?.rows || []);
}

function getFilesDir() {
  ensureDir(FILES_DIR);
  return FILES_DIR;
}

function getSentLogFile() {
  ensureDir(path.dirname(SENT_LOG_FILE));
  return SENT_LOG_FILE;
}

function readSentLog() {
  const filePath = getSentLogFile();
  if (!fs.existsSync(filePath)) return [];

  const entries = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.pedido) entries.push(parsed);
    } catch {
      continue;
    }
  }
  return entries;
}

function appendSentLog(entry = {}) {
  const pedido = String(entry.pedido || '').trim();
  if (!pedido) throw new Error('pedido requerido para bitacora');

  const payload = {
    pedido,
    rowId: String(entry.rowId || '').trim(),
    to: String(entry.to || '').trim(),
    facturadorId: String(entry.facturadorId || '').trim(),
    facturadorNombre: String(entry.facturadorNombre || '').trim(),
    subject: String(entry.subject || '').trim(),
    sentAt: String(entry.sentAt || new Date().toISOString()).trim(),
    recordedAt: new Date().toISOString(),
  };

  fs.appendFileSync(getSentLogFile(), JSON.stringify(payload) + '\n', 'utf8');
  return payload;
}

function collectFiles(dirPath, baseDir = dirPath) {
  const results = [];
  if (!fs.existsSync(dirPath)) return results;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(absolutePath, baseDir));
      continue;
    }

    const stat = fs.statSync(absolutePath);
    results.push({
      name: entry.name,
      relativePath: path.relative(baseDir, absolutePath),
      absolutePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mimeType: mime.lookup(entry.name) || 'application/octet-stream',
      normalizedName: normalizeLooseName(entry.name),
    });
  }

  return results;
}

function getCachedFiles(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cache.files && now - cache.filesAt < CACHE_TTL_MS) {
    return cache.files;
  }
  const files = collectFiles(getFilesDir());
  cache.files = files;
  cache.filesAt = now;
  return files;
}

function matchFilesForStore(establecimiento, files) {
  const value = String(establecimiento || '').trim();
  if (!value) return [];
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`);

  const matches = files.filter((file) => exact.test(file.normalizedName) || file.normalizedName.includes(value));
  matches.sort((a, b) => {
    const scoreA = a.normalizedName.includes(value) ? 2 : 1;
    const scoreB = b.normalizedName.includes(value) ? 2 : 1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.name.localeCompare(b.name, 'es');
  });
  return matches;
}

function buildResponse(rows, { facturadorId = '', includeSent = false, forceRefresh = false } = {}) {
  const normalizedFacturador = normalizeText(facturadorId);
  const files = getCachedFiles(forceRefresh);
  const sentLog = readSentLog();
  const sentByPedido = new Map();
  for (const entry of sentLog) {
    if (!entry?.pedido) continue;
    sentByPedido.set(String(entry.pedido).trim(), entry);
  }

  const filtered = (Array.isArray(rows) ? rows : [])
    .map(normalizeRow)
    .filter((row) => row.pedido && row.establecimiento)
    .filter((row) => includeSent || !isTruthySent(row.enviado))
    .filter((row) => !normalizedFacturador || normalizeText(row.facturadorId) === normalizedFacturador);

  const enriched = filtered.map((row) => {
    const matchedFiles = matchFilesForStore(row.establecimiento, files).map((file) => ({
      name: file.name,
      relativePath: file.relativePath,
      size: file.size,
      mimeType: file.mimeType,
      mtimeMs: file.mtimeMs,
      downloadUrl: `/api/pedidos-ley/files?path=${encodeURIComponent(file.relativePath)}`,
    }));

    return {
      pedido: row.pedido,
      rowId: row.rowId,
      establecimiento: row.establecimiento,
      facturadorId: row.facturadorId,
      fecha: row.fecha,
      fechaYear: row.fechaYear,
      status: row.status,
      'facturador.nombre': row.facturadorNombre,
      facturador: row.facturadorId,
      facturadorNombre: row.facturadorNombre,
      enviado: row.enviado,
      enviadoBool: isTruthySent(row.enviado),
      sentLocal: sentByPedido.has(row.pedido),
      sentLocalAt: sentByPedido.get(row.pedido)?.sentAt || '',
      sentLocalTo: sentByPedido.get(row.pedido)?.to || '',
      matchedFiles,
      matchedCount: matchedFiles.length,
    };
  });

  return {
    ok: true,
    view: VIEW,
    table: TABLE,
    total: enriched.length,
    filesDir: getFilesDir(),
    rows: enriched,
  };
}

export async function fetchPedidosLeySinLiberacion({ facturadorId = '', includeSent = false, forceRefresh = false } = {}) {
  const normalizedFacturadorId = String(facturadorId || '').trim();
  const now = Date.now();
  const selector = 'Filter(PEDIDOS_LEY, AND([STATUS]="SIN LIBERACION", YEAR([fecha(DATE)])>=2025))';
  if (!forceRefresh && cache.rows && now - cache.at < CACHE_TTL_MS) {
    return buildResponse(cache.rows, { facturadorId: normalizedFacturadorId, includeSent, forceRefresh });
  }

  if (!forceRefresh && cache.pending) {
    const rows = await cache.pending;
    return buildResponse(rows, { facturadorId: normalizedFacturadorId, includeSent, forceRefresh });
  }

  cache.pending = appsheetFindRows(selector)
    .then((rows) => {
      cache.rows = Array.isArray(rows) ? rows : [];
      cache.at = Date.now();
      cache.pending = null;
      return cache.rows;
    })
    .catch((error) => {
      cache.pending = null;
      throw error;
    });

  const rows = await cache.pending;
  return buildResponse(rows, { facturadorId: normalizedFacturadorId, includeSent, forceRefresh });
}

export function resolvePedidoLeyFile(relativePath) {
  const safeRelative = String(relativePath || '').replace(/^[\\/]+/, '');
  if (!safeRelative) {
    throw new Error('path requerido');
  }

  const filesDir = path.resolve(getFilesDir());
  const absolutePath = path.resolve(filesDir, safeRelative);
  if (!absolutePath.startsWith(filesDir + path.sep) && absolutePath !== filesDir) {
    throw new Error('Ruta de archivo no permitida');
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Archivo no encontrado: ${safeRelative}`);
  }

  return absolutePath;
}

export function streamPedidoLeyFile(res, relativePath) {
  const absolutePath = resolvePedidoLeyFile(relativePath);
  const filename = path.basename(absolutePath);
  const mimeType = mime.lookup(filename) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '\\"')}"`);
  return fs.createReadStream(absolutePath).pipe(res);
}

export async function markPedidoLeyEnviado({ pedido, rowId, enviado } = {}) {
  const pedidoValue = String(pedido || '').trim();
  if (!pedidoValue) {
    throw new Error('pedido requerido');
  }

  const payload = {
    PEDIDO: pedidoValue,
    ENVIADO: true,
  };

  return appsheetAction('Edit', [payload]);
}

export function recordPedidoLeySent(entry = {}) {
  return appendSentLog(entry);
}

function buildEditPayloadFromSentEntry(entry) {
  const pedido = String(entry?.pedido || '').trim();
  if (!pedido) return null;

  return {
    PEDIDO: pedido,
    ENVIADO: true,
  };
}

function normalizeSentEntries(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') return Object.values(input);
  return [];
}

export async function reconcilePedidoLeyEnviados(sentEntries = []) {
  const sentLog = normalizeSentEntries(sentEntries).length ? normalizeSentEntries(sentEntries) : readSentLog();
  const seen = new Set();
  const payloads = [];
  for (const entry of sentLog) {
    const payload = buildEditPayloadFromSentEntry(entry);
    if (!payload) continue;
    const dedupeKey = `pedido:${payload.PEDIDO}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    payloads.push(payload);
  }

  if (!payloads.length) {
    return { ok: true, updated: 0, payloads: [] };
  }

  const result = await appsheetAction('Edit', payloads);
  clearPedidosLeyCache();
  return { ok: true, updated: payloads.length, result };
}

export function clearPedidosLeyCache() {
  cache = {
    at: 0,
    rows: null,
    pending: null,
    filesAt: 0,
    files: null,
  };
}

export function getPedidosLeyFilesDir() {
  return getFilesDir();
}
