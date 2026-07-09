import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { google } from 'googleapis';

const APP_ID = (process.env.FINANZAS_APPSHEET_APP_ID || process.env.PEDIDOS_APPSHEET_APP_ID || process.env.APPSHEET_APP_ID || '').trim();
const API_KEY = (process.env.FINANZAS_APPSHEET_API_KEY || process.env.PEDIDOS_APPSHEET_API_KEY || process.env.APPSHEET_API_KEY || '').trim();
const TABLE = (process.env.FINANZAS_APPSHEET_TABLE_PEDIDOS || process.env.PEDIDOS_APPSHEET_TABLE_PEDIDOS || 'PEDIDOS_LEY').trim();
const SUCURSALES_TABLE = (process.env.FINANZAS_APPSHEET_TABLE_SUCURSALES || process.env.PEDIDOS_APPSHEET_TABLE_SUCURSALES || process.env.APPSHEET_TABLE_SUCURSALES || 'SUCURSALES').trim();
const VIEW = (process.env.FINANZAS_APPSHEET_VIEW_SIN_LIBERACION || 'SIN LIBERACION').trim();
const FILES_DIR = process.env.PEDIDOS_LEY_FILES_DIR || path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'files');
const SENT_LOG_FILE = process.env.PEDIDOS_LEY_SENT_LOG_FILE || path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'sent-log.jsonl');
const DRIVE_CREDENTIALS_PATH = process.env.PEDIDOS_GOOGLE_CLIENT_CREDENTIALS || process.env.FACTURACION_GOOGLE_CREDENTIALS_PATH || '';
const DRIVE_TOKEN_PATH = process.env.PEDIDOS_GOOGLE_TOKEN_PATH || process.env.FACTURACION_GOOGLE_TOKEN_PATH || '';
const CACHE_TTL_MS = Math.max(10_000, Number(process.env.PEDIDOS_LEY_CACHE_TTL_MS || 15 * 60_000));
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
  sucursalesAt: 0,
  sucursalesLookup: null,
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

function extractAppSheetRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Rows)) return payload.Rows;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
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

function normalizeSucursalRow(row = {}) {
  const key = normalizeScalarText(getRowValue(row, ['id', 'ID', 'Id', 'Row ID', 'ROW ID']));
  const label = normalizeScalarText(
    getRowValue(row, [
      'Label',
      'LABEL',
      'label',
      'sucursales[label]',
      'SUCURSALES[LABEL]',
      'sucursales[Label]',
      'SUCURSALES[Label]',
      'tienda[label]',
      'TIENDA[LABEL]',
      'tienda[Label]',
      'LABEL2',
      'Label2',
      'title',
      'TITLE',
      'name',
      'NAME',
      'NOMBRE',
      'Nombre',
    ])
  );
  const drive = normalizeScalarText(
    getRowValue(row, [
      'DRIVE',
      'Drive',
      'drive',
      'sucursales[drive]',
      'SUCURSALES[DRIVE]',
      'sucursales[Drive]',
      'tienda[drive]',
      'TIENDA[DRIVE]',
      'tienda[Drive]',
    ])
  );
  const tienda = normalizeScalarText(getRowValue(row, ['TIENDA', 'Tienda', 'tienda']));
  const displayLabel = label || tienda || key;
  return { key, label, drive, tienda, displayLabel, raw: row };
}

function collectSucursalCandidates(value) {
  const candidates = [];
  const add = (candidate) => {
    const text = normalizeScalarText(candidate);
    if (!text) return;
    if (!candidates.includes(text)) candidates.push(text);
  };

  add(value);
  if (value && typeof value === 'object') {
    add(value.id);
    add(value.ID);
    add(value.Id);
    add(value.key);
    add(value.KEY);
    add(value.value);
    add(value.label);
    add(value.Label);
    add(value.name);
    add(value.NAME);
    add(value.tienda);
    add(value.TIENDA);
    add(value.drive);
    add(value.DRIVE);
    add(value['Row ID']);
    add(value['ROW ID']);
  }

  return candidates;
}

function matchSucursalRow(row = {}, candidates = []) {
  if (!row || !candidates.length) return false;
  const fields = [
    'id',
    'ID',
    'Id',
    'Row ID',
    'ROW ID',
    'tienda',
    'TIENDA',
    'Tienda',
    'Label',
    'LABEL',
    'label',
    'LABEL2',
    'Label2',
    'title',
    'TITLE',
    'name',
    'NAME',
    'NOMBRE',
    'Nombre',
  ];

  const normalizedRowValues = fields.flatMap((field) => collectSucursalCandidates(getRowValue(row, [field])));
  return candidates.some((candidate) => normalizedRowValues.includes(candidate));
}

function resolveSucursalForPedido(tiendaValue, tiendaKey, sucursalesLookup = null) {
  const candidates = [
    ...collectSucursalCandidates(tiendaValue),
    ...collectSucursalCandidates(tiendaKey),
  ];

  if (!candidates.length || !sucursalesLookup) return null;

  for (const candidate of candidates) {
    const direct = sucursalesLookup.rowByKey?.get(candidate);
    if (direct) return direct;
  }

  for (const row of Array.isArray(sucursalesLookup.rows) ? sucursalesLookup.rows : []) {
    if (matchSucursalRow(row, candidates)) {
      return normalizeSucursalRow(row);
    }
  }

  return null;
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
    const pathKey = String(key || '')
      .replace(/\[([^\]]+)\]/g, '.$1')
      .replace(/^\.+/, '');
    if (pathKey.includes('.')) {
      const parts = pathKey.split('.');
      let current = row;
      let found = true;
      for (const part of parts) {
        if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
          current = current[part];
        } else {
          found = false;
          break;
        }
      }
      if (found && current !== undefined && current !== null && String(current).trim() !== '') {
        return current;
      }
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

function normalizeRow(row = {}, sucursalesLookup = null) {
  const rowId = normalizeScalarText(getRowValue(row, ['Row ID', 'ROW ID', 'RowId', 'ROWID', 'ID', 'Id', 'id']));
  const facturadorId = extractFacturadorId(row);
  const facturadorNombre = resolveFacturadorNombre(facturadorId, row);
  const fecha = normalizeScalarText(getRowValue(row, ['FECHA', 'Fecha', 'fecha']));
  const status = normalizeScalarText(getRowValue(row, ['STATUS', 'Status', 'ESTATUS', 'Estatus']));
  const pedido = normalizeScalarText(getRowValue(row, ['PEDIDO', 'NO. PEDIDO', 'NO PEDIDO', 'Pedido']));
  const tiendaValue = getRowValue(row, ['tienda', 'TIENDA', 'Tienda']);
  const tiendaKey = normalizeScalarText(
    (tiendaValue && typeof tiendaValue === 'object'
      ? tiendaValue.id
        || tiendaValue.ID
        || tiendaValue.Id
        || tiendaValue.key
        || tiendaValue.KEY
        || tiendaValue.value
        || tiendaValue.label
        || tiendaValue.Label
        || tiendaValue.name
        || tiendaValue.NAME
      : tiendaValue)
    || getRowValue(row, ['ESTABLECIMIENTO', 'Establecimiento', 'establecimiento'])
  );
  const lookupByKey = resolveSucursalForPedido(tiendaValue, tiendaKey, sucursalesLookup);
  const tiendaObject = tiendaValue && typeof tiendaValue === 'object' ? tiendaValue : null;
  const resolvedTiendaLabel = normalizeScalarText(
    lookupByKey?.label
    || lookupByKey?.displayLabel
    || getRowValue(row, ['tienda.label', 'TIENDA.LABEL', 'Tienda.Label', 'tienda[Label]', 'tienda[title]', 'tienda.title', 'tienda.name'])
    || getRowValue(row, ['sucursales[label]', 'SUCURSALES[LABEL]', 'sucursales[Label]', 'SUCURSALES[Label]', 'tienda[label]', 'TIENDA[LABEL]'])
    || tiendaObject?.Label
    || tiendaObject?.label
    || tiendaObject?.name
    || tiendaObject?.title
    || tiendaKey
  );
  const resolvedTiendaDrive = normalizeScalarText(
    lookupByKey?.drive
    || getRowValue(row, ['tienda.drive', 'TIENDA.DRIVE', 'Tienda.Drive', 'tienda[drive]'])
    || getRowValue(row, ['sucursales[drive]', 'SUCURSALES[DRIVE]', 'sucursales[Drive]', 'tienda[drive]', 'TIENDA[DRIVE]'])
    || tiendaObject?.drive
  );
  const ultimoPipcEstatal = normalizeScalarText(getRowValue(row, ['ultimo pipc estatal', 'ULTIMO PIPC ESTATAL', 'ultimoPipcEstatal', 'ultimo_pipc_estatal']));
  const ultimoPipcMunicipal = normalizeScalarText(getRowValue(row, ['ultimo municipal', 'ULTIMO MUNICIPAL', 'ultimoPipcMunicipal', 'ultimo_pipc_municipal']));
  const importe = normalizeScalarText(getRowValue(row, ['IMPORTE', 'Importe']));
  const descripcion = normalizeScalarText(getRowValue(row, ['DESCRIPCION', 'Descripcion', 'DESCRIPTION']));
  const establecimiento = tiendaKey || normalizeScalarText(getRowValue(row, ['ESTABLECIMIENTO', 'No. Tienda', 'No. tienda', 'No tienda']));
  return {
    rowId,
    pedido,
    tienda: {
      id: tiendaKey,
      label: resolvedTiendaLabel,
      drive: resolvedTiendaDrive,
      ultimoPipcEstatal,
      ultimoPipcMunicipal,
    },
    tiendaLabel: resolvedTiendaLabel,
    tiendaDrive: resolvedTiendaDrive,
    tiendaKey,
    establecimiento,
    facturadorId,
    facturadorNombre,
    fecha,
    fechaYear: extractYear(fecha),
    status,
    importe,
    descripcion,
    ultimoPipcEstatal,
    ultimoPipcMunicipal,
    enviado: normalizeScalarText(getRowValue(row, ['ENVIADO', 'Enviado'])),
    raw: row,
  };
}

async function appsheetAction(action, rows = [], selector = '', tableName = TABLE) {
  if (!APP_ID || !API_KEY) {
    throw new Error('Faltan variables de AppSheet para finanzas');
  }

  const url = `https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent(tableName)}/Action`;
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

async function appsheetFindRows(selector = '', tableName = TABLE) {
  const result = await appsheetAction('Find', [], selector, tableName);
  return extractAppSheetRows(result);
}

async function fetchSucursalesLookup(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cache.sucursalesLookup && now - cache.sucursalesAt < CACHE_TTL_MS) {
    return cache.sucursalesLookup;
  }

  const rows = await appsheetFindRows(`Filter(${SUCURSALES_TABLE}, true)`, SUCURSALES_TABLE);
  const rowByKey = new Map();
  const labelByKey = new Map();
  const driveByKey = new Map();

  for (const row of rows) {
    const sucursal = normalizeSucursalRow(row);
    if (!sucursal.key) continue;
    rowByKey.set(sucursal.key, sucursal);
    if (sucursal.tienda) rowByKey.set(sucursal.tienda, sucursal);
    if (sucursal.raw?.RowID) rowByKey.set(String(sucursal.raw.RowID).trim(), sucursal);
    if (sucursal.raw?.['Row ID']) rowByKey.set(String(sucursal.raw['Row ID']).trim(), sucursal);
    if (sucursal.displayLabel) labelByKey.set(sucursal.key, sucursal.displayLabel);
    if (sucursal.tienda && sucursal.displayLabel) labelByKey.set(sucursal.tienda, sucursal.displayLabel);
    if (sucursal.drive) driveByKey.set(sucursal.key, sucursal.drive);
    if (sucursal.tienda && sucursal.drive) driveByKey.set(sucursal.tienda, sucursal.drive);
  }

  const lookup = { rows, rowByKey, labelByKey, driveByKey };
  cache.sucursalesAt = now;
  cache.sucursalesLookup = lookup;
  return lookup;
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
  const queue = [{ id: rootId, path: '' }];
  const visitedFolders = new Set();
  const results = [];

  while (queue.length) {
    const current = queue.shift();
    const folderId = current.id;
    if (!folderId || visitedFolders.has(folderId)) continue;
    visitedFolders.add(folderId);

    let pageToken = '';
    do {
      const page = await listDriveChildren(drive, folderId, pageToken);
      for (const file of page.files) {
        const mimeType = String(file.mimeType || '').trim();
        const normalizedName = normalizeLooseName(file.name);
        const pathLabel = current.path ? `${current.path}/${String(file.name || '').trim()}` : String(file.name || '').trim();
        const entry = {
          id: String(file.id || '').trim(),
          name: String(file.name || '').trim(),
          mimeType,
          modifiedTime: String(file.modifiedTime || '').trim(),
          size: Number(file.size || 0),
          webViewLink: String(file.webViewLink || '').trim(),
          webContentLink: String(file.webContentLink || '').trim(),
          normalizedName,
          pathLabel,
          normalizedPath: normalizeLooseName(pathLabel),
        };

        if (mimeType === 'application/vnd.google-apps.folder') {
          queue.push({ id: entry.id, path: pathLabel });
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

function createConcurrencyLimiter(limit = 6) {
  const max = Math.max(1, Number(limit) || 1);
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= max) return;
    const task = queue.shift();
    if (!task) return;
    active += 1;
    Promise.resolve()
      .then(task.fn)
      .then(task.resolve, task.reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
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
    const pathText = normalizeLooseName(entry.pathLabel || '');
    if (!text && !pathText) return false;

    const keywordHit = keywords.some((group) => group.some((term) => text.includes(normalizeLooseName(term)) || pathText.includes(normalizeLooseName(term))));

    return keywordHit;
  });

  matches.sort((a, b) => {
    const score = (entry) => {
      const text = normalizeLooseName(entry.name || '');
      const pathText = normalizeLooseName(entry.pathLabel || '');
      const pipc = text.includes('PIPC') || pathText.includes('PIPC') ? 4 : 0;
      const contingency = text.includes('PLAN DE CONTINGENCIAS')
        || text.includes('PLANES DE CONTINGENCIA')
        || text.includes('PLAN DE CONTINGENCIA')
        || pathText.includes('PLAN DE CONTINGENCIAS')
        || pathText.includes('PLANES DE CONTINGENCIA')
        || pathText.includes('PLAN DE CONTINGENCIA')
        ? 3
        : 0;
      const storeHint = storeText && (text.includes(storeText) || pathText.includes(storeText)) ? 1 : 0;
      const driveHint = driveText && (text.includes(driveText) || pathText.includes(driveText)) ? 1 : 0;
      return pipc + contingency + storeHint + driveHint;
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
    pathLabel: entry.pathLabel,
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

  const driveClient = createDriveClient();
  if (!driveClient) {
    throw new Error('No hay credenciales de Drive configuradas para pedidos');
  }
  const sucursalesLookup = await fetchSucursalesLookup(forceRefresh);
  const filtered = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeRow(row, sucursalesLookup))
    .filter((row) => row.pedido && (row.tiendaLabel || row.tiendaKey || row.establecimiento))
    .filter((row) => includeSent || !isTruthySent(row.enviado))
    .filter((row) => !normalizedFacturador || normalizeText(row.facturadorId) === normalizedFacturador);

  const uniqueRoots = Array.from(new Set(
    filtered.map((row) => extractDriveId(row.tiendaDrive)).filter(Boolean)
  ));
  const driveEntriesByRoot = new Map();
  const limit = createConcurrencyLimiter(6);
  await Promise.all(uniqueRoots.map((root) => limit(async () => {
    const entries = await getDriveEntriesForRoot(root, forceRefresh);
    driveEntriesByRoot.set(root, entries);
  })));

  const enriched = filtered.map((normalizedRow) => {
    const driveRoot = extractDriveId(normalizedRow.tiendaDrive);
    const driveEntries = driveRoot ? (driveEntriesByRoot.get(driveRoot) || []) : [];
    const matchedFiles = driveEntries.length
      ? matchStoreFiles(driveEntries, normalizedRow.tiendaLabel || normalizedRow.establecimiento || '', normalizedRow.tiendaDrive)
      : [];

    const { raw, ...safeRow } = normalizedRow;
    return {
      ...safeRow,
      pedido: normalizedRow.pedido,
      rowId: normalizedRow.rowId,
      tienda: normalizedRow.tienda,
      tiendaLabel: normalizedRow.tiendaLabel,
      tiendaDrive: normalizedRow.tiendaDrive,
      establecimiento: normalizedRow.establecimiento,
      facturadorId: normalizedRow.facturadorId,
      fecha: normalizedRow.fecha,
      fechaYear: normalizedRow.fechaYear,
      status: normalizedRow.status,
      importe: normalizedRow.importe,
      descripcion: normalizedRow.descripcion,
      ultimoPipcEstatal: normalizedRow.ultimoPipcEstatal,
      ultimoPipcMunicipal: normalizedRow.ultimoPipcMunicipal,
      'facturador.nombre': normalizedRow.facturadorNombre,
      facturador: normalizedRow.facturadorId,
      facturadorNombre: normalizedRow.facturadorNombre,
      enviado: normalizedRow.enviado,
      enviadoBool: isTruthySent(normalizedRow.enviado),
      sentLocal: sentByPedido.has(normalizedRow.pedido),
      sentLocalAt: sentByPedido.get(normalizedRow.pedido)?.sentAt || '',
      sentLocalTo: sentByPedido.get(normalizedRow.pedido)?.to || '',
      sentLocalFrom: sentByPedido.get(normalizedRow.pedido)?.fromEmail || '',
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

export async function debugPedidoLey({ pedido = '', forceRefresh = false } = {}) {
  const normalizedPedido = String(pedido || '').trim();
  if (!normalizedPedido) {
    throw new Error('pedido requerido');
  }

  const rows = await appsheetFindRows(`Filter(${TABLE}, [PEDIDO]="${normalizedPedido}")`, TABLE);
  const rawRow = Array.isArray(rows) ? rows[0] : null;
  if (!rawRow) {
    return {
      ok: true,
      pedido: normalizedPedido,
      pedidoRow: null,
      sucursal: null,
      driveRoot: '',
      driveEntriesCount: 0,
      matchedFiles: [],
    };
  }

  const sucursalesLookup = await fetchSucursalesLookup(forceRefresh);
  const normalizedRow = normalizeRow(rawRow, sucursalesLookup);
  const lookupByKey = resolveSucursalForPedido(rawRow?.TIENDA || rawRow?.tienda || rawRow?.Tienda, normalizedRow.tiendaKey, sucursalesLookup);
  const lookupHasKey = normalizedRow.tiendaKey ? Boolean(sucursalesLookup?.rowByKey?.has(String(normalizedRow.tiendaKey))) : false;
  const driveRoot = extractDriveId(normalizedRow.tiendaDrive || lookupByKey?.drive || '');
  let driveEntries = [];
  let matchedFiles = [];

  if (driveRoot) {
    driveEntries = await getDriveEntriesForRoot(driveRoot, forceRefresh);
    matchedFiles = matchStoreFiles(driveEntries, normalizedRow.tiendaLabel || normalizedRow.establecimiento || '', normalizedRow.tiendaDrive || lookupByKey?.drive || '');
  }

  return {
    ok: true,
    pedido: normalizedPedido,
    pedidoRow: rawRow,
    normalizedRow,
    sucursal: lookupByKey,
    lookupHasKey,
    lookupKeysSample: Array.from(sucursalesLookup?.rowByKey?.keys?.() || []).slice(0, 8),
    sucursalesRowsCount: Array.isArray(sucursalesLookup?.rows) ? sucursalesLookup.rows.length : 0,
    sucursalesFirstRowKeys: Array.isArray(sucursalesLookup?.rows) && sucursalesLookup.rows[0] ? Object.keys(sucursalesLookup.rows[0]).slice(0, 20) : [],
    driveRoot,
    driveEntriesCount: driveEntries.length,
    matchedFiles,
    matchedFilesCount: matchedFiles.length,
  };
}

export function resolvePedidoLeyFile(relativePath) {
  const safeRelative = String(relativePath || '').replace(/^[\\/]+/, '');
  if (!safeRelative) {
    throw new Error('path requerido');
  }

  const driveId = extractDriveId(safeRelative);
  if (driveId) {
    return { kind: 'drive', fileId: driveId };
  }

  throw new Error('Ruta de archivo no válida para Drive');
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

  throw new Error('La lectura local de archivos está deshabilitada para pedidos');
}

export async function readPedidoLeyAttachment(relativePath) {
  const resolved = resolvePedidoLeyFile(relativePath);
  if (resolved.kind === 'drive') {
    const driveClient = createDriveClient();
    if (!driveClient) {
      throw new Error('No hay credenciales de Drive configuradas');
    }

    const metadataResponse = await driveClient.files.get({
      fileId: resolved.fileId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });
    const metadata = metadataResponse?.data || {};

    const response = await driveClient.files.get(
      {
        fileId: resolved.fileId,
        alt: 'media',
        supportsAllDrives: true,
      },
      { responseType: 'arraybuffer' },
    );

    const filename = String(metadata.name || '').trim() || String(response?.headers?.['content-disposition'] || '').match(/filename="?([^"]+)"?/i)?.[1] || resolved.fileId;
    const contentType = String(metadata.mimeType || response?.headers?.['content-type'] || '').trim() || 'application/octet-stream';
    return {
      filename,
      mimeType: contentType,
      content: Buffer.from(response.data),
    };
  }

  throw new Error('La lectura local de adjuntos está deshabilitada para pedidos');
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
  clearPedidosLeyRowsCache();
  return { ok: true, updated: payloads.length, result };
}

export function clearPedidosLeyCache() {
  cache.at = 0;
  cache.rows = null;
  cache.pending = null;
  cache.filesAt = 0;
  cache.files = null;
  cache.driveEntriesByRoot = new Map();
  cache.sucursalesAt = 0;
  cache.sucursalesLookup = null;
}

export function clearPedidosLeyRowsCache() {
  cache.at = 0;
  cache.rows = null;
  cache.pending = null;
}

export function getPedidosLeyFilesDir() {
  return getFilesDir();
}
