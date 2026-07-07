import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { google } from 'googleapis';

const APP_ID = (process.env.FINANZAS_APPSHEET_APP_ID || process.env.PEDIDOS_APPSHEET_APP_ID || process.env.APPSHEET_APP_ID || '').trim();
const API_KEY = (process.env.FINANZAS_APPSHEET_API_KEY || process.env.PEDIDOS_APPSHEET_API_KEY || process.env.APPSHEET_API_KEY || '').trim();
const TABLE = (process.env.FINANZAS_APPSHEET_TABLE_PEDIDOS || process.env.PEDIDOS_APPSHEET_TABLE_PEDIDOS || 'PEDIDOS_LEY').trim();
const VIEW = (process.env.FINANZAS_APPSHEET_VIEW_SIN_LIBERACION || 'SIN LIBERACION').trim();
const FILES_DIR = process.env.PEDIDOS_LEY_FILES_DIR || path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'files');
const SENT_LOG_FILE = process.env.PEDIDOS_LEY_SENT_LOG_FILE || path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'sent-log.jsonl');
const DRIVE_CREDENTIALS_PATH = process.env.PEDIDOS_GOOGLE_CLIENT_CREDENTIALS || process.env.FACTURACION_GOOGLE_CREDENTIALS_PATH || '';
const DRIVE_TOKEN_PATH = process.env.PEDIDOS_GOOGLE_TOKEN_PATH || process.env.FACTURACION_GOOGLE_TOKEN_PATH || '';
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
  driveEntriesByRoot: new Map(),
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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

function extractDriveId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const directPatterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/uc\?id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return /^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : '';
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

function readCredentialsFile(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getDriveAuthClient() {
  if (!DRIVE_CREDENTIALS_PATH || !DRIVE_TOKEN_PATH) {
    return null;
  }

  const credentials = readCredentialsFile(DRIVE_CREDENTIALS_PATH);
  const token = readCredentialsFile(DRIVE_TOKEN_PATH);
  if (!credentials || !token) return null;

  const oauthConfig = credentials.installed || credentials.web || credentials;
  const clientId = oauthConfig.client_id;
  const clientSecret = oauthConfig.client_secret;
  const redirectUri = oauthConfig.redirect_uris?.[0];
  if (!clientId || !clientSecret || !redirectUri) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials(token);
  return auth;
}

function createDriveClient() {
  const auth = getDriveAuthClient();
  if (!auth) return null;
  return google.drive({ version: 'v3', auth });
}

function normalizeRow(row = {}) {
  const rowId = normalizeScalarText(getRowValue(row, ['Row ID', 'ROW ID', 'RowId', 'ROWID', 'ID', 'Id', 'id']));
  const facturadorId = extractFacturadorId(row);
  const facturadorNombre = resolveFacturadorNombre(facturadorId, row);
  const fecha = normalizeScalarText(getRowValue(row, ['FECHA', 'Fecha', 'fecha']));
  const status = normalizeScalarText(getRowValue(row, ['STATUS', 'Status', 'ESTATUS', 'Estatus']));
  const pedido = normalizeScalarText(getRowValue(row, ['PEDIDO', 'NO. PEDIDO', 'NO PEDIDO', 'Pedido']));
  const tiendaNombre = normalizeScalarText(getRowValue(row, ['tienda.nombre', 'TIENDA.NOMBRE', 'Tienda.Nombre', 'TIENDA', 'Tienda']));
  const tiendaDrive = normalizeScalarText(getRowValue(row, ['tienda.drive', 'TIENDA.DRIVE', 'Tienda.Drive', 'DRIVE', 'Drive']));
  const importe = normalizeScalarText(getRowValue(row, ['IMPORTE', 'Importe']));
  const descripcion = normalizeScalarText(getRowValue(row, ['DESCRIPCION', 'Descripcion', 'DESCRIPTION']));
  return {
    rowId,
    pedido,
    tienda: tiendaNombre,
    tiendaDrive,
    establecimiento: tiendaNombre || normalizeScalarText(getRowValue(row, ['ESTABLECIMIENTO', 'TIENDA', 'No. Tienda', 'No. tienda', 'No tienda'])),
    facturadorId,
    facturadorNombre,
    fecha,
    fechaYear: extractYear(fecha),
    status,
    importe,
    descripcion,
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
    fromEmail: String(entry.fromEmail || '').trim(),
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

async function listDriveChildren(drive, folderId, pageToken = '') {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, webContentLink, parents)',
    pageSize: 1000,
    pageToken: pageToken || undefined,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: 'allDrives',
  });

  return {
    files: Array.isArray(response?.data?.files) ? response.data.files : [],
    nextPageToken: response?.data?.nextPageToken || '',
  };
}

async function collectDriveEntries(drive, rootId) {
  if (!drive || !rootId) return [];
  const queue = [rootId];
  const visitedFolders = new Set();
  const results = [];

  while (queue.length) {
    const folderId = queue.shift();
    if (!folderId || visitedFolders.has(folderId)) continue;
    visitedFolders.add(folderId);

    let pageToken = '';
    do {
      const page = await listDriveChildren(drive, folderId, pageToken);
      for (const file of page.files) {
        const mimeType = String(file.mimeType || '').trim();
        const normalizedName = normalizeLooseName(file.name);
        const entry = {
          id: String(file.id || '').trim(),
          name: String(file.name || '').trim(),
          mimeType,
          modifiedTime: String(file.modifiedTime || '').trim(),
          size: Number(file.size || 0),
          webViewLink: String(file.webViewLink || '').trim(),
          webContentLink: String(file.webContentLink || '').trim(),
          normalizedName,
        };

        if (mimeType === 'application/vnd.google-apps.folder') {
          queue.push(entry.id);
        } else {
          results.push(entry);
        }
      }
      pageToken = page.nextPageToken || '';
    } while (pageToken);
  }

  return results;
}

async function getDriveEntriesForRoot(rootId, forceRefresh = false) {
  const normalizedRoot = String(rootId || '').trim();
  if (!normalizedRoot) return [];

  const driveClient = createDriveClient();
  if (!driveClient) return [];

  const cacheKey = normalizedRoot;
  const cached = cache.driveEntriesByRoot.get(cacheKey);
  const now = Date.now();
  if (!forceRefresh && cached && now - cached.at < CACHE_TTL_MS) {
    return cached.entries;
  }

  const entries = await collectDriveEntries(driveClient, normalizedRoot);
  cache.driveEntriesByRoot.set(cacheKey, { at: now, entries });
  return entries;
}

function matchStoreFiles(entries = [], tienda = '', tiendaDrive = '') {
  const storeText = normalizeLooseName(tienda || '');
  const driveText = String(tiendaDrive || '').trim();
  const keywords = [
    ['PIPC'],
    ['PLAN DE CONTINGENCIAS', 'PLANES DE CONTINGENCIA'],
  ];
  const source = Array.isArray(entries) ? entries : [];
  const matches = source.filter((entry) => {
    const text = normalizeLooseName(entry.name || '');
    if (!text) return false;
    return keywords.some((group) => group.some((term) => text.includes(normalizeLooseName(term))));
  });

  matches.sort((a, b) => {
    const score = (entry) => {
      const text = normalizeLooseName(entry.name || '');
      const exactStore = storeText && text.includes(storeText) ? 3 : 0;
      const pipc = text.includes('PIPC') ? 2 : 0;
      const contingency = text.includes('PLAN DE CONTINGENCIAS') || text.includes('PLANES DE CONTINGENCIA') ? 1 : 0;
      const driveHint = driveText && text.includes(driveText) ? 1 : 0;
      return exactStore + pipc + contingency + driveHint;
    };
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name, 'es');
  });

  return matches.map((entry) => ({
    id: entry.id,
    name: entry.name,
    relativePath: entry.id,
    size: entry.size,
    mimeType: entry.mimeType,
    mtimeMs: entry.modifiedTime ? Date.parse(entry.modifiedTime) : 0,
    openUrl: entry.webViewLink || `https://drive.google.com/file/d/${entry.id}/view`,
    downloadUrl: `/api/pedidos-ley/files?path=${encodeURIComponent(entry.id)}`,
  }));
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

async function buildResponse(rows, { facturadorId = '', includeSent = false, forceRefresh = false } = {}) {
  const normalizedFacturador = normalizeText(facturadorId);
  const sentLog = readSentLog();
  const sentByPedido = new Map();
  for (const entry of sentLog) {
    if (!entry?.pedido) continue;
    sentByPedido.set(String(entry.pedido).trim(), entry);
  }

  const filtered = (Array.isArray(rows) ? rows : [])
    .map(normalizeRow)
    .filter((row) => row.pedido && (row.tienda || row.establecimiento))
    .filter((row) => includeSent || !isTruthySent(row.enviado))
    .filter((row) => !normalizedFacturador || normalizeText(row.facturadorId) === normalizedFacturador);

  const enriched = [];
  for (const row of filtered) {
    const driveRoot = extractDriveId(row.tiendaDrive);
    let matchedFiles = [];
    const driveClient = createDriveClient();
    if (driveRoot && driveClient) {
      const driveEntries = await getDriveEntriesForRoot(driveRoot, forceRefresh);
      matchedFiles = matchStoreFiles(driveEntries, row.tienda || row.establecimiento || '', row.tiendaDrive);
    } else {
      const files = getCachedFiles(forceRefresh);
      matchedFiles = matchFilesForStore(row.tienda || row.establecimiento, files).map((file) => ({
        name: file.name,
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType,
        mtimeMs: file.mtimeMs,
        downloadUrl: `/api/pedidos-ley/files?path=${encodeURIComponent(file.relativePath)}`,
      }));
    }

    enriched.push({
      pedido: row.pedido,
      rowId: row.rowId,
      tienda: row.tienda,
      tiendaDrive: row.tiendaDrive,
      establecimiento: row.establecimiento,
      facturadorId: row.facturadorId,
      fecha: row.fecha,
      fechaYear: row.fechaYear,
      status: row.status,
      importe: row.importe,
      descripcion: row.descripcion,
      'facturador.nombre': row.facturadorNombre,
      facturador: row.facturadorId,
      facturadorNombre: row.facturadorNombre,
      enviado: row.enviado,
      enviadoBool: isTruthySent(row.enviado),
      sentLocal: sentByPedido.has(row.pedido),
      sentLocalAt: sentByPedido.get(row.pedido)?.sentAt || '',
      sentLocalTo: sentByPedido.get(row.pedido)?.to || '',
      sentLocalFrom: sentByPedido.get(row.pedido)?.fromEmail || '',
      matchedFiles,
      matchedCount: matchedFiles.length,
    });
  }

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
    const driveId = extractDriveId(safeRelative);
    if (driveId) {
      return { kind: 'drive', fileId: driveId };
    }
    throw new Error('Ruta de archivo no permitida');
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    const driveId = extractDriveId(safeRelative);
    if (driveId) {
      return { kind: 'drive', fileId: driveId };
    }
    throw new Error(`Archivo no encontrado: ${safeRelative}`);
  }

  return { kind: 'local', absolutePath };
}

export function streamPedidoLeyFile(res, relativePath) {
  const resolved = resolvePedidoLeyFile(relativePath);
  if (resolved.kind === 'drive') {
    const driveClient = createDriveClient();
    if (!driveClient) {
      throw new Error('No hay credenciales de Drive configuradas');
    }

    return driveClient.files.get(
      {
        fileId: resolved.fileId,
        alt: 'media',
        supportsAllDrives: true,
      },
      { responseType: 'stream' },
    ).then((response) => {
      const filename = String(response?.headers?.['content-disposition'] || '').match(/filename="?([^"]+)"?/i)?.[1] || resolved.fileId;
      const contentType = String(response?.headers?.['content-type'] || '').trim() || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${String(filename).replace(/"/g, '\\"')}"`);
      return response.data.pipe(res);
    });
  }

  const filename = path.basename(resolved.absolutePath);
  const mimeType = mime.lookup(filename) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '\\"')}"`);
  return fs.createReadStream(resolved.absolutePath).pipe(res);
}

export async function readPedidoLeyAttachment(relativePath) {
  const resolved = resolvePedidoLeyFile(relativePath);
  if (resolved.kind === 'drive') {
    const driveClient = createDriveClient();
    if (!driveClient) {
      throw new Error('No hay credenciales de Drive configuradas');
    }

    const response = await driveClient.files.get(
      {
        fileId: resolved.fileId,
        alt: 'media',
        supportsAllDrives: true,
      },
      { responseType: 'arraybuffer' },
    );

    const filename = String(response?.headers?.['content-disposition'] || '').match(/filename="?([^"]+)"?/i)?.[1] || resolved.fileId;
    const contentType = String(response?.headers?.['content-type'] || '').trim() || 'application/octet-stream';
    return {
      filename,
      mimeType: contentType,
      content: Buffer.from(response.data),
    };
  }

  return {
    filename: path.basename(resolved.absolutePath),
    mimeType: mime.lookup(path.basename(resolved.absolutePath)) || 'application/octet-stream',
    content: fs.readFileSync(resolved.absolutePath),
  };
}

export async function markPedidoLeyEnviado({ pedido, rowId, enviado } = {}) {
  const pedidoValue = String(pedido || '').trim();
  if (!pedidoValue) {
    throw new Error('pedido requerido');
  }

  const payload = {
    PEDIDO: pedidoValue,
    ENVIADO: enviado === false ? false : true,
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
    driveEntriesByRoot: new Map(),
  };
}

export function getPedidosLeyFilesDir() {
  return getFilesDir();
}
