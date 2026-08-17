import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { google } from 'googleapis';

const APP_ID = (process.env.FINANZAS_APPSHEET_APP_ID || process.env.PEDIDOS_APPSHEET_APP_ID || process.env.APPSHEET_APP_ID || '').trim();
const API_KEY = (process.env.FINANZAS_APPSHEET_API_KEY || process.env.PEDIDOS_APPSHEET_API_KEY || process.env.APPSHEET_API_KEY || '').trim();
const TABLE = (process.env.FINANZAS_APPSHEET_TABLE_PEDIDOS || process.env.PEDIDOS_APPSHEET_TABLE_PEDIDOS || 'PEDIDOS_LEY').trim();
const SUCURSALES_TABLE = (process.env.FINANZAS_APPSHEET_TABLE_SUCURSALES || process.env.PEDIDOS_APPSHEET_TABLE_SUCURSALES || process.env.APPSHEET_TABLE_SUCURSALES || 'SUCURSALES').trim();
const MUNICIPIO_TABLE = (process.env.PEDIDOS_APPSHEET_TABLE_MUNICIPIO || process.env.PEDIDOS_APPSHEET_TABLE_MUNICIPIOS || 'MUNICIPIOS').trim();
const ESTADO_TABLE = (process.env.PEDIDOS_APPSHEET_TABLE_ESTADO || process.env.PEDIDOS_APPSHEET_TABLE_ESTADOS || 'ESTADOS').trim();
const VIEW = (process.env.FINANZAS_APPSHEET_VIEW_SIN_LIBERACION || 'SIN LIBERACION').trim();
const FILES_DIR = process.env.PEDIDOS_LEY_FILES_DIR || path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'files');
const SENT_LOG_FILE = process.env.PEDIDOS_LEY_SENT_LOG_FILE || path.resolve(process.cwd(), 'runtime', 'pedidos-ley', 'sent-log.jsonl');
const DRIVE_CREDENTIALS_PATH = process.env.PEDIDOS_GOOGLE_CLIENT_CREDENTIALS || process.env.FACTURACION_GOOGLE_CREDENTIALS_PATH || '';
const DRIVE_TOKEN_PATH = process.env.PEDIDOS_GOOGLE_TOKEN_PATH || process.env.FACTURACION_GOOGLE_TOKEN_PATH || '';
const CACHE_TTL_MS = Math.max(10_000, Number(process.env.PEDIDOS_LEY_CACHE_TTL_MS || 15 * 60_000));
const DEFAULT_STATE_THRESHOLD = 32000;
const DEFAULT_MUNICIPAL_THRESHOLD = 9794.98;
const DEFAULT_ADMIN_FACTURADOR_ID = 'xwDqa6Mt6a42iqKHzJG9L6';
const CULIACAN_MUNICIPAL_FACTURADOR_ID = 'EiHiUQ9YHf4mA-C7L_ziyc';
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

const lookupCache = {
  empresas: { at: 0, lookup: null },
  municipios: { at: 0, lookup: null },
  estados: { at: 0, lookup: null },
  sucursales: { at: 0, lookup: null },
};

const dashboardCache = new Map();

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

function looksLikeIdentifier(value) {
  const text = normalizeScalarText(value);
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^[a-f0-9-]{8,}$/i.test(text) && !/\s/.test(text)) return true;
  return false;
}

function getFirstMeaningfulText(row = {}, keys = []) {
  for (const key of keys) {
    const value = normalizeScalarText(getRowValue(row, [key]));
    if (value && !looksLikeIdentifier(value)) return value;
  }
  return '';
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

function collectReferenceCandidates(value) {
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
    add(value.nombre);
    add(value.NOMBRE);
    add(value.title);
    add(value.TITLE);
    add(value['Row ID']);
    add(value['ROW ID']);
  }

  return candidates;
}

function parseMoneyValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim();
  if (!text) return null;

  const cleaned = text
    .replace(/\s+/g, '')
    .replace(/[$€£MXN]/gi, '')
    .replace(/[^\d,.-]/g, '');

  if (!cleaned) return null;

  let normalized = cleaned;
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/,/g, '');
  } else if (normalized.includes(',') && !normalized.includes('.')) {
    normalized = normalized.replace(/,/g, '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyPedidoImporte(importeNumber, { estatalMin = DEFAULT_STATE_THRESHOLD, municipalMin = DEFAULT_MUNICIPAL_THRESHOLD } = {}) {
  const amount = Number(importeNumber);
  if (!Number.isFinite(amount)) {
    return 'sin-clasificar';
  }
  if (amount >= Number(estatalMin)) {
    return 'estatal';
  }
  if (amount >= Number(municipalMin)) {
    return 'municipal';
  }
  return 'sin-clasificar';
}

function classifyPedidoDescripcion(descripcion = "") {
  const text = normalizeText(descripcion);
  if (!text) {
    return null;
  }

  const hasEstatal = text.includes("ESTATAL");
  const hasMunicipal = text.includes("MUNICIPAL");
  if (hasEstatal && !hasMunicipal) return "estatal";
  if (hasMunicipal && !hasEstatal) return "municipal";
  return null;
}

function classifyPedidoTipo(descripcion, importeNumber, thresholds = {}) {
  const fromDescription = classifyPedidoDescripcion(descripcion);
  if (fromDescription) {
    return fromDescription;
  }
  return classifyPedidoImporte(importeNumber, thresholds);
}

function normalizeTruthValue(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return ['SI', 'S', 'YES', 'Y', 'TRUE', '1', 'ENVIADO', 'PAGADO', 'PAGO', 'LIBERADO', 'FACTURADO', 'CHEQUE'].includes(text);
}

function resolveLookupRow(value, lookup = null) {
  if (!lookup) return null;
  const candidates = collectReferenceCandidates(value).map((item) => normalizeText(item));
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    const direct = lookup.rowByKey?.get(candidate);
    if (direct) return direct;
  }

  for (const candidate of candidates) {
    const byLabel = lookup.rowByLabel?.get(candidate);
    if (byLabel) return byLabel;
  }

  return null;
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

function normalizeMunicipioRow(row = {}) {
  const key = normalizeScalarText(getRowValue(row, ['ID', 'Id', 'id', 'Row ID', 'ROW ID']));
  const nombre = getFirstMeaningfulText(row, [
    'NOMBRE',
    'Nombre',
    'nombre',
    'LABEL',
    'Label',
    'label',
    'LABEL2',
    'Label2',
    'NOMBRE MUNICIPIO',
    'Nombre Municipio',
    'nombre municipio',
    'MUNICIPIO',
    'Municipio',
    'CITY',
    'City',
    'NAME',
    'Name',
  ]);
  const escudo = normalizeScalarText(getRowValue(row, ['ESCUDO', 'Escudo', 'escudo']));
  const displayLabel = nombre || getFirstMeaningfulText(row, ['DISPLAYLABEL', 'DisplayLabel', 'displayLabel', 'LABEL2', 'Label2', 'LABEL', 'Label']) || key;
  return { key, nombre, escudo, displayLabel, raw: row };
}

function normalizeEstadoRow(row = {}) {
  const key = normalizeScalarText(getRowValue(row, ['ID', 'Id', 'id', 'Row ID', 'ROW ID']));
  const nombre = getFirstMeaningfulText(row, [
    'NOMBRE',
    'Nombre',
    'nombre',
    'LABEL',
    'Label',
    'label',
    'LABEL2',
    'Label2',
    'ESTADO',
    'Estado',
    'STATE',
    'State',
    'NAME',
    'Name',
  ]);
  const escudo = normalizeScalarText(getRowValue(row, ['ESCUDO', 'Escudo', 'escudo']));
  const displayLabel = nombre || getFirstMeaningfulText(row, ['DISPLAYLABEL', 'DisplayLabel', 'displayLabel', 'LABEL2', 'Label2', 'LABEL', 'Label']) || key;
  return { key, nombre, escudo, displayLabel, raw: row };
}

function normalizeSucursalRow(row = {}, catalogs = {}) {
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
  const label2 = normalizeScalarText(getRowValue(row, ['LABEL2', 'Label2', 'label2']));
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
  const empresaIdRaw = getRowValue(row, ['ID EMPRESA', 'EMPRESA', 'Empresa', 'empresa']);
  const municipioIdRaw = getRowValue(row, ['MUNICIPIO', 'Municipio', 'municipio']);
  const estadoIdRaw = getRowValue(row, ['ESTADO', 'Estado', 'estado']);
  const municipioRow = resolveLookupRow(municipioIdRaw, catalogs.municipiosLookup);
  const estadoRow = resolveLookupRow(estadoIdRaw, catalogs.estadosLookup);
  const direccion = normalizeScalarText(getRowValue(row, ['DIRECCION', 'Direccion', 'direccion']));
  const direccionGoogle = normalizeScalarText(getRowValue(row, ['DIRECCION GOOGLE', 'Direccion Google', 'direccionGoogle', 'DIRECCION_GOOGLE']));
  const status = normalizeScalarText(getRowValue(row, ['STATUS', 'Status', 'status']));
  const vencimientoMunicipal = normalizeScalarText(getRowValue(row, ['VENCIMIENTO MUNICIPAL', 'Vencimiento Municipal', 'vencimiento municipal']));
  const trabajos = normalizeScalarText(getRowValue(row, ['TRABAJOS', 'Trabajos', 'trabajos']));
  const tipo = normalizeScalarText(getRowValue(row, ['TIPO', 'Tipo', 'tipo']));
  const nivelRiesgo = normalizeScalarText(getRowValue(row, ['NIVEL DE RIESGO', 'Nivel de Riesgo', 'nivel de riesgo']));
  const precioEstatal = parseMoneyValue(getRowValue(row, ['PRECIO ESTATAL', 'Precio Estatal', 'precio estatal']));
  const precioMunicipal = parseMoneyValue(getRowValue(row, ['PRECIO MUNICIPAL', 'Precio Municipal', 'precio municipal']));
  const idPc = normalizeScalarText(getRowValue(row, ['ID_PC', 'ID PC', 'Id Pc', 'id_pc']));
  const logo = normalizeScalarText(getRowValue(row, ['LOGO', 'Logo']));
  const ultimoPipcEstatal = normalizeScalarText(getRowValue(row, ['ULTIMO PIPC ESTATAL', 'Ultimo PIPC Estatal', 'ultimo pipc estatal']));
  const ultimoPipcMunicipal = normalizeScalarText(getRowValue(row, ['ULTIMO MUNICIPAL', 'Ultimo Municipal', 'ultimo municipal']));
  const pedido = normalizeScalarText(getRowValue(row, ['PEDIDO', 'Pedido', 'pedido']));
  const latLng = normalizeScalarText(getRowValue(row, ['lat/lng', 'LAT/LNG', 'LAT LNG', 'latlng', 'LATLNG']));
  const mesPlaneacion = normalizeScalarText(getRowValue(row, ['MES PLANEACION', 'Mes Planeacion', 'mes planeacion']));
  const displayLabel = label || label2 || tienda || key;
  return {
    key,
    label,
    label2,
    drive,
    tienda,
    displayLabel,
    empresaId: normalizeScalarText(empresaIdRaw),
    empresaLabel: normalizeScalarText(empresaIdRaw),
    municipioId: normalizeScalarText(municipioIdRaw),
    municipioLabel: municipioRow?.displayLabel || municipioRow?.nombre || normalizeScalarText(municipioIdRaw),
    municipioNombre: municipioRow?.nombre || municipioRow?.displayLabel || normalizeScalarText(municipioIdRaw),
    estadoId: normalizeScalarText(estadoIdRaw),
    estadoLabel: estadoRow?.displayLabel || estadoRow?.nombre || normalizeScalarText(estadoIdRaw),
    direccion,
    direccionGoogle,
    status,
    vencimientoMunicipal,
    trabajos,
    tipo,
    nivelRiesgo,
    precioEstatal,
    precioMunicipal,
    idPc,
    logo,
    ultimoPipcEstatal,
    ultimoPipcMunicipal,
    pedido,
    latLng,
    mesPlaneacion,
    municipio: municipioRow || null,
    estado: estadoRow || null,
    raw: row,
  };
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

function normalizeRow(row = {}, catalogs = {}, thresholds = {}) {
  const sucursalesLookup = catalogs.sucursalesLookup || null;
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
  const companyIdRaw = lookupByKey?.empresaId || getRowValue(row, ['ID EMPRESA', 'EMPRESA', 'Empresa', 'empresa']);
  const municipalityIdRaw = lookupByKey?.municipioId || getRowValue(row, ['MUNICIPIO', 'Municipio', 'municipio']);
  const stateIdRaw = lookupByKey?.estadoId || getRowValue(row, ['ESTADO', 'Estado', 'estado']);
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
  const importeNumber = parseMoneyValue(importe);
  const descripcion = normalizeScalarText(getRowValue(row, ['DESCRIPCION', 'Descripcion', 'DESCRIPTION']));
  const establecimiento = tiendaKey || normalizeScalarText(getRowValue(row, ['ESTABLECIMIENTO', 'No. Tienda', 'No. tienda', 'No tienda']));
  const liberacion = normalizeScalarText(getRowValue(row, ['LIBERACION', 'Liberacion', 'LIBERADO']));
  const pago = normalizeScalarText(getRowValue(row, ['PAGO', 'Pago', 'PAGADO']));
  const facturaEnLey = normalizeScalarText(getRowValue(row, ['FACTURA EN LEY', 'Factura En Ley', 'FACTURAENLEY', 'FACTURA_EN_LEY']));
  const folioClubFactura = normalizeScalarText(getRowValue(row, ['FOLIO CLUBFACTURA', 'Folio ClubFactura', 'FOLIO_CLUBFACTURA']));
  const cheque = normalizeScalarText(getRowValue(row, ['CHEQUE', 'Cheque']));
  const uuid = normalizeScalarText(getRowValue(row, ['UUID', 'Uuid', 'uuid']));
  const relatedLiberaciones = normalizeScalarText(getRowValue(row, ['Related LIBERACIONESs', 'Related LIBERACIONES', 'related liberaciones']));
  const fechaDate = extractYear(getRowValue(row, ['fecha(DATE)', 'FECHA(DATE)', 'fecha']));
  const tipoClasificacion = classifyPedidoTipo(descripcion, importeNumber, thresholds);
  const municipioRow = resolveLookupRow(municipalityIdRaw, catalogs.municipiosLookup);
  const estadoRow = resolveLookupRow(stateIdRaw, catalogs.estadosLookup);
  const municipioNombre = municipioRow?.nombre || municipioRow?.displayLabel || getFirstMeaningfulText(municipioRow?.raw || {}, ['NOMBRE', 'Nombre', 'LABEL', 'Label', 'LABEL2', 'Label2', 'MUNICIPIO', 'Municipio', 'NAME', 'Name']) || normalizeScalarText(municipalityIdRaw);
  const estadoNombre = estadoRow?.nombre || estadoRow?.displayLabel || getFirstMeaningfulText(estadoRow?.raw || {}, ['NOMBRE', 'Nombre', 'LABEL', 'Label', 'LABEL2', 'Label2', 'ESTADO', 'Estado', 'NAME', 'Name']) || normalizeScalarText(stateIdRaw);
  const isCuliacanMunicipal = normalizeText(municipioNombre).includes('CULIACAN') && tipoClasificacion === 'municipal';
  const clasificacionLabel = isCuliacanMunicipal
    ? 'Municipal Culiacán'
    : tipoClasificacion === 'estatal'
      ? 'Estatal'
      : tipoClasificacion === 'municipal'
        ? 'Municipal'
        : 'Sin clasificar';
  const clasificacionDetalle = isCuliacanMunicipal ? 'Municipal de Culiacán asignado a Sergio González Castillo' : '';
  const resolvedFacturadorId = isCuliacanMunicipal ? CULIACAN_MUNICIPAL_FACTURADOR_ID : facturadorId;
  const resolvedFacturadorNombre = isCuliacanMunicipal
    ? (FACTURADOR_OPTIONS.get(CULIACAN_MUNICIPAL_FACTURADOR_ID) || facturadorNombre)
    : facturadorNombre;
  return {
    rowId,
    pedido,
    tienda: {
      id: tiendaKey,
      label: resolvedTiendaLabel,
      drive: resolvedTiendaDrive,
      ultimoPipcEstatal,
      ultimoPipcMunicipal,
      empresaId: normalizeScalarText(companyIdRaw),
      empresaLabel: normalizeScalarText(companyIdRaw),
      municipioId: normalizeScalarText(municipalityIdRaw),
      municipioLabel: municipioNombre,
      municipioNombre,
      estadoId: normalizeScalarText(stateIdRaw),
      estadoLabel: estadoNombre,
      estadoNombre,
      estadoRawLabel: estadoRow?.nombre || estadoRow?.displayLabel || normalizeScalarText(stateIdRaw),
    },
    tiendaLabel: resolvedTiendaLabel,
    tiendaDrive: resolvedTiendaDrive,
    tiendaKey,
    establecimiento,
    facturadorId: resolvedFacturadorId,
    facturadorNombre: resolvedFacturadorNombre,
    fecha,
    fechaYear: fechaDate || extractYear(fecha),
    status,
    importe,
    importeNumber,
    descripcion,
    liberacion,
    liberacionBool: normalizeTruthValue(liberacion),
    relatedLiberaciones,
    pago,
    pagoBool: normalizeTruthValue(pago),
    facturaEnLey,
    facturaEnLeyBool: normalizeTruthValue(facturaEnLey),
    folioClubFactura,
    cheque,
    chequeBool: normalizeTruthValue(cheque),
    uuid,
    ultimoPipcEstatal,
    ultimoPipcMunicipal,
    enviado: normalizeScalarText(getRowValue(row, ['ENVIADO', 'Enviado'])),
    enviadoBool: normalizeTruthValue(getRowValue(row, ['ENVIADO', 'Enviado'])),
    tipoClasificacion,
    clasificacionLabel,
    clasificacionDetalle,
    municipio: municipioRow || null,
    estado: estadoRow || null,
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

async function fetchLookupRows(tableName, normalizer, cacheKey, forceRefresh = false, lookupBuilder = null) {
  const now = Date.now();
  const cacheEntry = lookupCache[cacheKey];
  if (!cacheEntry) {
    throw new Error(`Lookup cache no definido para ${cacheKey}`);
  }

  if (!forceRefresh && cacheEntry.lookup && now - cacheEntry.at < CACHE_TTL_MS) {
    return cacheEntry.lookup;
  }

  const rows = await appsheetFindRows(`Filter(${tableName}, true)`, tableName);
  const normalizedRows = rows.map((row) => normalizer(row)).filter((row) => row.key);
  const lookup = typeof lookupBuilder === 'function'
    ? lookupBuilder(normalizedRows)
    : { rows: normalizedRows };

  lookupCache[cacheKey] = {
    at: now,
    lookup,
  };

  return lookup;
}

function buildIndexedLookup(rows, { labelSelector = (row) => row.displayLabel || row.label || row.nombre || row.razonSocial || row.key, extraAliases = [] } = {}) {
  const rowByKey = new Map();
  const rowByLabel = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeText(row.key);
    if (!key) continue;
    rowByKey.set(key, row);
    const label = normalizeText(labelSelector(row));
    if (label) rowByLabel.set(label, row);
    for (const alias of Array.isArray(extraAliases) ? extraAliases : []) {
      const aliasValue = normalizeText(alias(row));
      if (aliasValue) rowByKey.set(aliasValue, row);
    }
  }

  return {
    rows,
    rowByKey,
    rowByLabel,
  };
}

async function fetchSucursalesLookup(forceRefresh = false, catalogs = {}) {
  return fetchLookupRows(
    SUCURSALES_TABLE,
    (row) => normalizeSucursalRow(row, catalogs),
    'sucursales',
    forceRefresh,
    (rows) => {
      const indexed = buildIndexedLookup(rows, {
        labelSelector: (row) => row.displayLabel || row.label || row.label2 || row.tienda || row.key,
      });
      const driveByKey = new Map();
      for (const row of rows) {
        if (row.key && row.drive) driveByKey.set(normalizeText(row.key), row.drive);
        if (row.tienda && row.drive) driveByKey.set(normalizeText(row.tienda), row.drive);
      }
      return { ...indexed, driveByKey };
    }
  );
}

async function fetchMunicipiosLookup(forceRefresh = false) {
  return fetchLookupRows(
    MUNICIPIO_TABLE,
    normalizeMunicipioRow,
    'municipios',
    forceRefresh,
    (rows) => buildIndexedLookup(rows, {
      labelSelector: (row) => row.displayLabel || row.nombre || row.key,
    })
  );
}

async function fetchEstadosLookup(forceRefresh = false) {
  return fetchLookupRows(
    ESTADO_TABLE,
    normalizeEstadoRow,
    'estados',
    forceRefresh,
    (rows) => buildIndexedLookup(rows, {
      labelSelector: (row) => row.displayLabel || row.nombre || row.key,
    })
  );
}

async function fetchPedidosLeyCatalogs(forceRefresh = false) {
  const [municipiosLookup, estadosLookup] = await Promise.all([
    fetchMunicipiosLookup(forceRefresh),
    fetchEstadosLookup(forceRefresh),
  ]);

  const sucursalesLookup = await fetchSucursalesLookup(forceRefresh, {
    municipiosLookup,
    estadosLookup,
  });

  return {
    municipiosLookup,
    estadosLookup,
    sucursalesLookup,
  };
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
    ['PLAN DE CONTINGENCIAS', 'PLANES DE CONTINGENCIA', 'PLAN DE CONTINGENCIA', 'PLAN DE CONTINUIDAD'],
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
        || text.includes('PLAN DE CONTINUIDAD')
        || pathText.includes('PLAN DE CONTINGENCIAS')
        || pathText.includes('PLANES DE CONTINGENCIA')
        || pathText.includes('PLAN DE CONTINGENCIA')
        || pathText.includes('PLAN DE CONTINUIDAD')
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
  const catalogs = await fetchPedidosLeyCatalogs(forceRefresh);
  const sucursalesLookup = catalogs.sucursalesLookup;
  const filtered = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeRow(row, catalogs))
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

export function getPedidosLeyAdminDefaultThresholds() {
  return {
    estatalMin: DEFAULT_STATE_THRESHOLD,
    municipalMin: DEFAULT_MUNICIPAL_THRESHOLD,
  };
}

export async function fetchPedidosLeyAdminDashboardData({
  year = new Date().getFullYear(),
  forceRefresh = false,
  facturadorId = DEFAULT_ADMIN_FACTURADOR_ID,
  thresholds = {},
} = {}) {
  const normalizedYear = Number.parseInt(String(year || '').trim(), 10);
  const targetYear = Number.isFinite(normalizedYear) ? normalizedYear : new Date().getFullYear();
  const normalizedFacturadorId = String(facturadorId || '').trim();
  const normalizedThresholds = {
    estatalMin: Number.isFinite(Number.parseFloat(thresholds.estatalMin)) ? Number.parseFloat(thresholds.estatalMin) : DEFAULT_STATE_THRESHOLD,
    municipalMin: Number.isFinite(Number.parseFloat(thresholds.municipalMin)) ? Number.parseFloat(thresholds.municipalMin) : DEFAULT_MUNICIPAL_THRESHOLD,
  };
  const cacheKey = JSON.stringify({
    year: targetYear,
    facturadorId: normalizedFacturadorId,
    estatalMin: normalizedThresholds.estatalMin,
    municipalMin: normalizedThresholds.municipalMin,
  });
  const cached = dashboardCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const candidateYears = [targetYear, targetYear - 1, targetYear - 2].filter((value, index, array) => Number.isFinite(value) && value >= 2020 && array.indexOf(value) === index);
  const catalogsPromise = fetchPedidosLeyCatalogs(forceRefresh);
  let rows = [];
  let loadedYear = targetYear;
  for (const candidateYear of candidateYears) {
    const selector = `Filter(${TABLE}, YEAR([fecha(DATE)]) = ${candidateYear})`;
    const result = await appsheetFindRows(selector, TABLE);
    rows = Array.isArray(result) ? result : [];
    loadedYear = candidateYear;
    if (rows.length > 0) break;
  }
  const catalogs = await catalogsPromise;
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeRow(row, catalogs, normalizedThresholds))
    .filter((row) => row.pedido)
    .filter((row) => !normalizedFacturadorId || normalizeText(row.facturadorId) === normalizeText(normalizedFacturadorId));

  const data = {
    ok: true,
    year: loadedYear,
    requestedYear: targetYear,
    facturadorId: normalizedFacturadorId,
    facturadorLabel: FACTURADOR_OPTIONS.get(normalizedFacturadorId) || normalizedFacturadorId,
    thresholds: normalizedThresholds,
    table: TABLE,
    rows: normalizedRows,
    catalogs,
  };
  dashboardCache.set(cacheKey, {
    at: Date.now(),
    data,
  });
  return data;
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

  const catalogs = await fetchPedidosLeyCatalogs(forceRefresh);
  const sucursalesLookup = catalogs.sucursalesLookup;
  const normalizedRow = normalizeRow(rawRow, catalogs);
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
  for (const entry of Object.values(lookupCache)) {
    entry.at = 0;
    entry.lookup = null;
  }
  dashboardCache.clear();
}

export function clearPedidosLeyRowsCache() {
  cache.at = 0;
  cache.rows = null;
  cache.pending = null;
}

export function getPedidosLeyFilesDir() {
  return getFilesDir();
}


