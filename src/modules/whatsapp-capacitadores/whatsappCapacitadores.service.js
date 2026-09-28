import fs from "fs";
import path from "path";
import readline from "readline";
import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import mime from "mime-types";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import P from "pino";
import pkg from "whatsapp-web.js";
import { google } from "googleapis";
import { readLocalRows } from "../../services/desarrolloegLocalDb.js";
import { readLocalOperationalTable } from "../../services/localOperationalRepository.js";
import { resolvePcEstatalBySucursal } from "../home/pcEstatal.service.js";
import { searchAuthorizedDocumentation, searchAuthorizedOperationalData } from "./authorizedKnowledge.js";
import { executeAuthorizedDataQuery } from "./authorizedDataQuery.js";
import { semanticCatalogForIdentity } from "./semanticEntities.js";
import { resolvePortalAccessProfile } from "../home/portalAccessPolicy.js";

const { Client, LocalAuth, MessageMedia } = pkg;
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];
const WHATSAPP_BOOT_WATCHDOG_MS = 90000;
const WHATSAPP_AUTH_WATCHDOG_MS = 120000;
const WHATSAPP_AUTH_WATCHDOG_INTERVAL_MS = 15000;

const serviceState = {
  enabled: false,
  status: "disabled",
  startedAt: null,
  readyAt: null,
  qrGeneratedAt: null,
  lastError: null,
  sessionDir: "",
  connected: false,
  qrPayload: null,
  startPromise: null,
};

const runtime = {
  config: null,
  logger: null,
  client: null,
  driveClientPromise: null,
  refreshTimer: null,
  reconnectTimer: null,
  authWatchdogTimer: null,
  authenticatedAt: null,
  recovering: false,
  intentionalStop: false,
};

const menuContext = new Map();
const uploadContext = new Map();
const storePhotosContext = new Map();
const archivoContext = new Map();
const driveLookupContext = new Map();
const aiConversationContext = new Map();
const sucursalInformationContext = new Map();

const employeesCache = {
  ts: 0,
  phoneSet: new Set(),
  phoneToEmployeeKeys: new Map(),
  nameByKey: new Map(),
  profileByPhone: new Map(),
};

const empresasCache = {
  ts: 0,
  rowsByKey: new Map(),
};

const sucursalesCache = {
  ts: 0,
  rows: [],
  nameByKey: new Map(),
  keyByTienda: new Map(),
  driveByKey: new Map(),
};

const whatsappCacheNamespacePrefix = "whatsapp.tables";
const whatsappTableCacheTtlMs = Number(process.env.WHATSAPP_TABLE_CACHE_TTL_MS || 5 * 60 * 1000);

function normalizeAppSheetRows(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.Rows) ? data.Rows : [];
}

function tableCacheNamespace(tableName) {
  return `${whatsappCacheNamespacePrefix}.${String(tableName || "").trim().toLowerCase()}`;
}

async function loadCachedAppSheetRows({ table, selector, cacheKey = "rows" }) {
  void selector;
  void cacheKey;
  return readLocalOperationalTable(table);
}

function readEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return fallback;
}

function readSecret(names, fileNames) {
  const direct = readEnv(names, "");
  if (direct) return direct;
  const filePath = readEnv(fileNames, "");
  if (!filePath) return "";
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function readBoolean(names, fallback = false) {
  const value = readEnv(names, "");
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readNumber(names, fallback) {
  const value = readEnv(names, "");
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function phoneIdentityKey(raw) {
  const phone = normalizePhone(raw);
  return phone.length >= 10 ? phone.slice(-10) : phone;
}

function readBooleanValue(value) {
  if (String(value || "").trim().toLowerCase() === "y") return true;
  return ["1", "true", "yes", "si", "sí", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitWords(raw) {
  return normalizeText(raw)
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function levenshteinDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitution
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function stringSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return Math.min(0.98, 0.72 + (shorter / Math.max(longer, 1)) * 0.26);
  }

  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;
  const distance = levenshteinDistance(a, b);
  return Math.max(0, 1 - distance / maxLen);
}

function normalizeDisplay(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function getFirstFlexible(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    if (row && typeof row === "object") {
      const normalizedKey = normalizeText(key);
      const matchKey = Object.keys(row).find((candidateKey) => normalizeText(candidateKey) === normalizedKey);
      const matchValue = matchKey ? row[matchKey] : undefined;
      if (matchValue !== undefined && matchValue !== null && String(matchValue).trim() !== "") {
        return matchValue;
      }
    }
  }
  return "";
}

function uniqueDisplayParts(values) {
  const parts = [];
  for (const value of values) {
    const text = normalizeDisplay(value);
    if (!text) continue;
    if (!parts.some((part) => normalizeText(part) === normalizeText(text))) {
      parts.push(text);
    }
  }
  return parts;
}

function isLikelyIdentifier(value) {
  const text = normalizeDisplay(value);
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^[A-Z0-9_-]{3,}$/.test(text) && !/\s/.test(text)) return true;
  return false;
}

function getFieldValues(row, fields) {
  return fields
    .map((field) => normalizeDisplay(row[field]))
    .filter(Boolean);
}

export function scoreSucursalCandidate(query, candidate) {
  const normalizedQuery = normalizeText(query);
  const searchText = candidate.searchText || "";
  if (!normalizedQuery || !searchText) return 0;

  const queryTokens = splitWords(normalizedQuery);
  if (candidate.tienda && queryTokens.includes(normalizeText(candidate.tienda))) return 1;
  if (candidate.key && queryTokens.includes(normalizeText(candidate.key))) return 0.99;

  let score = 0;
  const exactText = stringSimilarity(normalizedQuery, searchText);
  score = Math.max(score, exactText * 0.8);

  for (const token of queryTokens) {
    if (!token) continue;
    if (searchText.includes(token)) {
      score += 0.16;
      continue;
    }

    let bestTokenScore = 0;
    for (const sourceToken of candidate.tokens) {
      const tokenScore = stringSimilarity(token, sourceToken);
      if (tokenScore > bestTokenScore) bestTokenScore = tokenScore;
    }

    if (bestTokenScore >= 0.82) {
      score += 0.14 * bestTokenScore;
    } else if (bestTokenScore >= 0.65) {
      score += 0.08 * bestTokenScore;
    }
  }

  const normalizedTokens = queryTokens;
  if (normalizedTokens.length) {
    const hits = normalizedTokens.filter((token) => searchText.includes(token)).length;
    score += (hits / normalizedTokens.length) * 0.18;
  }

  if (candidate.tienda && normalizedQuery === normalizeText(candidate.tienda)) score = Math.max(score, 1);
  if (candidate.key && normalizedQuery === normalizeText(candidate.key)) score = Math.max(score, 0.98);

  return Math.max(0, Math.min(score, 1));
}

function buildSucursalDisplay(candidate) {
  const label = normalizeDisplay(candidate.label || candidate.nombreComercial || candidate.tienda || candidate.key || "");
  const leftSide = uniqueDisplayParts([
    candidate.empresa,
    candidate.razonSocial,
  ])
    .filter((part) => !label || normalizeText(part) !== normalizeText(label))
    .join(" / ");
  const fallbackLeft = uniqueDisplayParts([candidate.name, candidate.tienda, candidate.key])
    .filter((part) => !label || normalizeText(part) !== normalizeText(label))
    .join(" / ");
  if (leftSide && label) return `${leftSide} | ${label}`;
  if (fallbackLeft && label) return `${fallbackLeft} | ${label}`;
  if (leftSide) return leftSide;
  if (fallbackLeft) return fallbackLeft;
  if (label) return label;
  return normalizeDisplay(candidate.name || candidate.tienda || candidate.key || "");
}

function isStrongSucursalMatch(best, second) {
  if (!best) return false;
  if (best.score >= 0.93 && (!second || best.score - second.score >= 0.12)) return true;
  if (best.score >= 0.98) return true;
  return false;
}

function getDefaultChromePath() {
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  return "/usr/bin/chromium";
}

function getConfig() {
  const sessionDir = readEnv(
    ["WHATSAPP_CAP_SESSION_DIR", "SESSION_DIR"],
    path.resolve(process.cwd(), "runtime", "whatsapp-capacitadores", "session")
  );
  const tmpDir = readEnv(
    ["WHATSAPP_CAP_TMP_DIR"],
    path.resolve(process.cwd(), "runtime", "whatsapp-capacitadores", "tmp")
  );
  const capacitacionesDateCol = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_DATE_COL", "CAPACITACIONES_DATE_COL"],
    "FECHA CAPACITACION"
  );
  const capacitacionesCapacitadoresCol = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_CAPACITADORES_COL", "CAPACITACIONES_CAPACITADORES_COL"],
    "CAPACITADORES"
  );
  const capacitacionesSucursalesCol = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_SUCURSALES_COL", "CAPACITACIONES_SUCURSALES_COL"],
    "SUCURSALES"
  );
  const capacitacionesCedeCol = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_CEDE_COL", "CAPACITACIONES_CEDE_COL"],
    "CEDE"
  );
  const capacitacionesFieldsRaw = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_FIELDS", "CAPACITACIONES_FIELDS"],
    `${capacitacionesDateCol},${capacitacionesCedeCol},${capacitacionesSucursalesCol},${capacitacionesCapacitadoresCol}`
  );

  return {
    enabled: readBoolean(["WHATSAPP_CAP_ENABLED"], false),
    logLevel: readEnv(["WHATSAPP_CAP_LOG_LEVEL", "LOG_LEVEL"], "info"),
    botName: readEnv(["WHATSAPP_CAP_BOT_NAME", "BOT_NAME"], "Bot"),
    saveMedia: readBoolean(["WHATSAPP_CAP_SAVE_MEDIA", "SAVE_MEDIA"], false),
    allowedNumbers: splitList(readEnv(["WHATSAPP_CAP_ALLOWED_NUMBERS", "ALLOWED_NUMBERS"], "")).map(normalizePhone),
    allowLidFallback: readBoolean(["WHATSAPP_CAP_ALLOW_LID_FALLBACK", "ALLOW_LID_FALLBACK"], true),
    aiServerUrl: readEnv(["WHATSAPP_CAP_AI_SERVER_URL", "AI_SERVER_URL"], "").replace(/\/$/, ""),
    aiClientId: readEnv(["WHATSAPP_CAP_AI_CLIENT_ID", "AI_CLIENT_ID"], ""),
    aiClientToken: readSecret(
      ["WHATSAPP_CAP_AI_CLIENT_TOKEN", "AI_CLIENT_TOKEN"],
      ["WHATSAPP_CAP_AI_CLIENT_TOKEN_FILE", "AI_CLIENT_TOKEN_FILE"]
    ),
    aiTimeoutMs: readNumber(["WHATSAPP_CAP_AI_TIMEOUT_MS", "AI_TIMEOUT_MS"], 180000),
    sessionDir,
    tmpDir,
    chromePath: readEnv(
      ["WHATSAPP_CAP_CHROME_PATH", "CHROME_PATH"],
      getDefaultChromePath()
    ),
    webVersion: readEnv(["WHATSAPP_CAP_WEB_VERSION"], ""),
    webVersionRemotePath: readEnv(["WHATSAPP_CAP_WEB_VERSION_REMOTE_PATH"], ""),
    keywordCapacitaciones: normalizeText(
      readEnv(["WHATSAPP_CAP_KEYWORD_CAPACITACIONES", "KEYWORD_CAPACITACIONES"], "CAPACITACIONES")
    ),
    keywordSubirImagenes: normalizeText(
      readEnv(
        ["WHATSAPP_CAP_KEYWORD_SUBIR_IMAGENES", "KEYWORD_SUBIR_IMAGENES"],
        "SUBIR IMAGENES DE CAPACITACION"
      )
    ),
    keywordArchivo: normalizeText(readEnv(["WHATSAPP_CAP_KEYWORD_ARCHIVO", "KEYWORD_ARCHIVO"], "ARCHIVO")),
    keywordArchivos: normalizeText(readEnv(["WHATSAPP_CAP_KEYWORD_ARCHIVOS", "KEYWORD_ARCHIVOS"], "ARCHIVOS")),
    keywordReintentar: normalizeText(
      readEnv(["WHATSAPP_CAP_KEYWORD_REINTENTAR", "KEYWORD_REINTENTAR"], "REINTENTAR")
    ),
    menuWindowMinutes: readNumber(["WHATSAPP_CAP_MENU_WINDOW_MINUTES", "MENU_WINDOW_MINUTES"], 5),
    authRefreshMinutes: readNumber(["WHATSAPP_CAP_AUTH_REFRESH_MINUTES", "AUTH_REFRESH_MINUTES"], 30),
    notifyNumber: normalizePhone(readEnv(["WHATSAPP_CAP_NOTIFY_NUMBER", "NOTIFY_NUMBER"], "")),
    notifyMessage: readEnv(
      ["WHATSAPP_CAP_NOTIFY_MESSAGE", "NOTIFY_MESSAGE"],
      "Imagenes guardadas. Sucursal: {SUCURSAL}. Total: {TOTAL}"
    ),
    appsheetAppId: readEnv(["WHATSAPP_CAP_APPSHEET_APP_ID", "APPSHEET_APP_ID"], ""),
    appsheetAccessKey: readEnv(["WHATSAPP_CAP_APPSHEET_ACCESS_KEY", "APPSHEET_ACCESS_KEY"], ""),
    appsheetRegion: readEnv(["WHATSAPP_CAP_APPSHEET_REGION", "APPSHEET_REGION"], "www.appsheet.com"),
    appsheetLocale: readEnv(["WHATSAPP_CAP_APPSHEET_LOCALE", "APPSHEET_LOCALE"], "es-MX"),
    appsheetTimezone: readEnv(["WHATSAPP_CAP_APPSHEET_TIMEZONE", "APPSHEET_TIMEZONE"], "America/Mexico_City"),
    appsheetTableEmpleados: readEnv(["WHATSAPP_CAP_TABLE_EMPLEADOS", "APPSHEET_TABLE_EMPLEADOS"], "EMPLEADOS"),
    appsheetTableCapacitaciones: readEnv(
      ["WHATSAPP_CAP_TABLE_CAPACITACIONES", "APPSHEET_TABLE_CAPACITACIONES"],
      "CAPACITACIONES"
    ),
    appsheetTableSucursales: readEnv(["WHATSAPP_CAP_TABLE_SUCURSALES", "APPSHEET_TABLE_SUCURSALES"], "SUCURSALES"),
    empleadosKeyCol: readEnv(["WHATSAPP_CAP_EMPLEADOS_KEY_COL", "EMPLEADOS_KEY_COL"], "Row ID"),
    empleadosPhoneCol1: readEnv(["WHATSAPP_CAP_EMPLEADOS_PHONE_COL1", "EMPLEADOS_PHONE_COL1"], "TELEFONO"),
    empleadosPhoneCol2: readEnv(["WHATSAPP_CAP_EMPLEADOS_PHONE_COL2", "EMPLEADOS_PHONE_COL2"], "TELEFONO 2"),
    empleadosNameCol: readEnv(["WHATSAPP_CAP_EMPLEADOS_NAME_COL", "EMPLEADOS_NAME_COL"], "NOMBRE"),
    sucursalesKeyCol: readEnv(["WHATSAPP_CAP_SUCURSALES_KEY_COL", "SUCURSALES_KEY_COL"], "ID"),
    sucursalesTiendaCol: readEnv(["WHATSAPP_CAP_SUCURSALES_TIENDA_COL", "SUCURSALES_TIENDA_COL"], "TIENDA"),
    sucursalesNameCol: readEnv(["WHATSAPP_CAP_SUCURSALES_NAME_COL", "SUCURSALES_NAME_COL"], "NOMBRE"),
    sucursalesDriveCol: readEnv(["WHATSAPP_CAP_SUCURSALES_DRIVE_COL", "SUCURSALES_DRIVE_COL"], "DRIVE"),
    sucursalesRazonSocialCol: readEnv(
      ["WHATSAPP_CAP_SUCURSALES_RAZON_SOCIAL_COL", "SUCURSALES_RAZON_SOCIAL_COL"],
      "RAZON SOCIAL"
    ),
    sucursalesEmpresaCol: readEnv(["WHATSAPP_CAP_SUCURSALES_EMPRESA_COL", "SUCURSALES_EMPRESA_COL"], "EMPRESA"),
    sucursalesLabelCol: readEnv(["WHATSAPP_CAP_SUCURSALES_LABEL_COL", "SUCURSALES_LABEL_COL"], "LABEL"),
    sucursalesNombreComercialCol: readEnv(
      ["WHATSAPP_CAP_SUCURSALES_NOMBRE_COMERCIAL_COL", "SUCURSALES_NOMBRE_COMERCIAL_COL"],
      "NOMBRE COMERCIAL"
    ),
    capacitacionesDateCol,
    capacitacionesCapacitadoresCol,
    capacitacionesSucursalesCol,
    capacitacionesCedeCol,
    capacitacionesFields: splitList(capacitacionesFieldsRaw),
    googleServiceAccountJson: readEnv(
      ["WHATSAPP_CAP_GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT_JSON"],
      ""
    ),
    googleOauthTokenPath: readEnv(
      ["WHATSAPP_CAP_GOOGLE_OAUTH_TOKEN_PATH", "GOOGLE_OAUTH_TOKEN_PATH"],
      path.resolve(process.cwd(), "runtime", "whatsapp-capacitadores", "token.json")
    ),
    driveFolderId: readEnv(["WHATSAPP_CAP_DRIVE_FOLDER_ID", "DRIVE_FOLDER_ID"], ""),
  };
}

function getLogger() {
  return runtime.logger || console;
}

function ensureRuntimeConfig() {
  if (!runtime.config) throw new Error("WhatsApp Capacitadores no esta configurado.");
  return runtime.config;
}

async function ensureTmpDir() {
  const config = ensureRuntimeConfig();
  await fs.promises.mkdir(config.tmpDir, { recursive: true });
  return config.tmpDir;
}

function getTextMessage(msg) {
  if (!msg) return "";
  return msg.body || "";
}

function setMenuContext(jid) {
  menuContext.set(jid, Date.now());
}

function hasMenuContext(jid) {
  const config = ensureRuntimeConfig();
  const ts = menuContext.get(jid) || 0;
  if (!ts) return false;
  return Date.now() - ts <= config.menuWindowMinutes * 60 * 1000;
}

async function appsheetFind({ table, selector }) {
  const config = ensureRuntimeConfig();
  if (!config.appsheetAppId) throw new Error("WHATSAPP_CAP_APPSHEET_APP_ID no configurado");
  if (!config.appsheetAccessKey) throw new Error("WHATSAPP_CAP_APPSHEET_ACCESS_KEY no configurado");

  const url = `https://${config.appsheetRegion}/api/v2/apps/${config.appsheetAppId}/tables/${encodeURIComponent(table)}/Action`;
  const body = {
    Action: "Find",
    Properties: {
      Locale: config.appsheetLocale,
      Timezone: config.appsheetTimezone,
    },
  };
  if (selector) body.Properties.Selector = selector;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ApplicationAccessKey: config.appsheetAccessKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AppSheet API error ${response.status}: ${text}`);
  }

  return response.json();
}

function mapLocalEmployeeRow(row = {}) {
  return {
    "Row ID": String(row.row_id || row.id || "").trim(),
    ID: String(row.id || row.row_id || "").trim(),
    NOMBRE: String(row.nombre || "").trim(),
    PUESTO: String(row.puesto || "").trim(),
    CORREO: String(row.correo || "").trim(),
    FIRMA: String(row.firma || "").trim(),
    TELEFONO: String(row.telefono || "").trim(),
    "TELEFONO 2": String(row.telefono_2 || "").trim(),
    CAPACITA: String(row.capacita || "").trim(),
    PERMISO: String(row.permiso || "").trim(),
    COLOR: String(row.color || "").trim(),
    "CUMPLEAÑOS": String(row.cumpleanos || "").trim(),
    INICIALES: String(row.iniciales || "").trim(),
  };
}

function mapLocalEmpresaRow(row = {}) {
  return {
    ID: String(row.id || "").trim(),
    "Row ID": String(row.id || "").trim(),
    RAZON_SOCIAL: String(row.razon_social || "").trim(),
    "RAZON SOCIAL": String(row.razon_social || "").trim(),
    NOMBRE_COMERCIAL: String(row.nombre_comercial || "").trim(),
    "NOMBRE COMERCIAL": String(row.nombre_comercial || "").trim(),
    NOMBRE_MOSTRADO: String(row.nombre_mostrado || row.nombre_comercial || row.razon_social || "").trim(),
    LABEL: String(row.nombre_mostrado || row.nombre_comercial || row.razon_social || "").trim(),
    logo: String(row.logo || "").trim(),
  };
}

function mapLocalSucursalRow(row = {}) {
  const empresaName = String(row.empresa_nombre || row.razon_social || row.nombre_mostrado || "").trim();
  return {
    ID: String(row.id || "").trim(),
    "Row ID": String(row.id || "").trim(),
    NOMBRE: String(row.nombre || "").trim(),
    TIENDA: String(row.tienda || "").trim(),
    EMPRESA: empresaName,
    "RAZON SOCIAL": empresaName,
    "NOMBRE COMERCIAL": String(row.nombre_comercial || empresaName || "").trim(),
    LABEL: String(row.address || row.nombre || row.tienda || "").trim(),
    LABEL2: String(row.tienda || row.nombre || "").trim(),
    DIRECCION: String(row.direccion || "").trim(),
    MUNICIPIO: String(row.municipio_nombre || "").trim(),
    ESTADO: String(row.estado_nombre || "").trim(),
    LATITUD: String(row.lat ?? "").trim(),
    LONGITUD: String(row.lng ?? "").trim(),
    TIPO: String(row.tipo || "").trim(),
    "NIVEL DE RIESGO": String(row.nivel_riesgo || "").trim(),
    TRABAJOS: String(row.trabajos || "").trim(),
    CAPACITADORES: String(row.capacitadores || "").trim(),
    "ID PC": String(row.id_pc || "").trim(),
    "MES PLANEACION": String(row.mes_planeacion ?? "").trim(),
    "VENCIMIENTO ESTATAL": String(row.vencimiento_estatal || "").trim(),
    "VENCIMIENTO MUNICIPAL": String(row.vencimiento_municipal || "").trim(),
    PEDIDO: String(row.pedido || "").trim(),
    "ESTATUS PLANEACION": String(row.planeacion_status || "").trim(),
    DRIVE: String(row.drive || "").trim(),
  };
}

function mapLocalCapacitacionRow(row = {}) {
  return {
    ID: String(row.id || "").trim(),
    "Row ID": String(row.id || "").trim(),
    "FECHA CAPACITACION": String(row.fecha_capacitacion || "").trim(),
    CEDE: String(row.cede_sucursal_id || "").trim(),
    STATUS: String(row.status || "").trim(),
    "HORA INICIO": String(row.hora_inicio || "").trim(),
    "HORA FIN": String(row.hora_fin || "").trim(),
    DIPLOMAS: String(row.diplomas || "").trim(),
    NOTAS: String(row.notas || "").trim(),
    CAPACITADORES: String(row.capacitadores_ids || "").trim(),
    SUCURSALES: String(row.sucursales_ids || "").trim(),
  };
}

function loadLocalWhatsAppRows(tableName) {
  const normalizedTable = normalizeText(tableName).replace(/\s+/g, " ").trim();
  if (!normalizedTable) return [];

  if (normalizedTable === "empleados") {
    return readLocalRows(
      `
        SELECT id, row_id, nombre, puesto, correo, firma, telefono, telefono_2, capacita, permiso, color, cumpleanos, iniciales
        FROM empleados
      `
    ).map(mapLocalEmployeeRow);
  }

  if (normalizedTable === "empresas") {
    return readLocalRows(
      `
        SELECT id, razon_social, nombre_comercial, logo,
               COALESCE(NULLIF(TRIM(nombre_comercial), ''), razon_social) AS nombre_mostrado
        FROM empresas
      `
    ).map(mapLocalEmpresaRow);
  }

  if (normalizedTable === "sucursales") {
    return readLocalRows(
      `
        SELECT
          s.id,
          s.nombre,
          s.tienda,
          s.empresa_id,
          e.razon_social AS empresa_nombre,
          e.nombre_comercial AS nombre_comercial,
          s.direccion,
          s.lat,
          s.lng,
          s.drive,
          s.mes_planeacion,
          s.capacitadores,
          s.id_pc,
          s.vencimiento_estatal,
          s.vencimiento_municipal,
          s.trabajos,
          s.tipo,
          s.nivel_riesgo,
          s.pedido,
          s.planeacion_status,
          m.nombre AS municipio_nombre,
          es.nombre AS estado_nombre,
          TRIM(
            COALESCE(s.nombre, '') ||
            CASE WHEN m.nombre IS NOT NULL AND m.nombre <> '' THEN ', ' || m.nombre ELSE '' END ||
            CASE WHEN es.nombre IS NOT NULL AND es.nombre <> '' THEN ', ' || es.nombre ELSE '' END ||
            ', Mexico'
          ) AS address
        FROM sucursales s
        LEFT JOIN empresas e ON e.id = s.empresa_id
        LEFT JOIN municipios m ON m.id = s.municipio_id
        LEFT JOIN estados es ON es.id = s.estado_id
      `
    ).map(mapLocalSucursalRow);
  }

  if (normalizedTable === "capacitaciones") {
    return readLocalRows(
      `
        SELECT
          c.id,
          c.fecha_capacitacion,
          c.cede_sucursal_id,
          c.status,
          c.hora_inicio,
          c.hora_fin,
          c.diplomas,
          c.notas,
          (
            SELECT group_concat(x.empleado_id, ', ')
            FROM (
              SELECT cc.empleado_id
              FROM capacitacion_capacitadores cc
              WHERE cc.capacitacion_id = c.id
              ORDER BY cc.orden, cc.empleado_id
            ) x
          ) AS capacitadores_ids,
          (
            SELECT group_concat(x.sucursal_id, ', ')
            FROM (
              SELECT cs.sucursal_id
              FROM capacitacion_sucursales cs
              WHERE cs.capacitacion_id = c.id
              ORDER BY cs.orden, cs.sucursal_id
            ) x
          ) AS sucursales_ids
        FROM capacitaciones c
      `
    ).map(mapLocalCapacitacionRow);
  }

  return [];
}

async function loadEmployeesCache() {
  const config = ensureRuntimeConfig();
  const ttlMs = config.authRefreshMinutes * 60 * 1000;
  if (Date.now() - employeesCache.ts < ttlMs) return employeesCache;

  const rows = await loadCachedAppSheetRows({
    table: config.appsheetTableEmpleados,
    selector: `Filter(${config.appsheetTableEmpleados}, true)`,
  });
  const phoneSet = new Set();
  const phoneToEmployeeKeys = new Map();
  const nameByKey = new Map();
  const profileByPhone = new Map();

  for (const row of rows || []) {
    const key = row[config.empleadosKeyCol];
    const phone1 = normalizePhone(row[config.empleadosPhoneCol1]);
    const phone2 = normalizePhone(row[config.empleadosPhoneCol2]);
    const name = row[config.empleadosNameCol];

    if (key && name) nameByKey.set(String(key), String(name));
    for (const phone of [phone1, phone2]) {
      if (!phone) continue;
      const accessProfile = resolvePortalAccessProfile({
        puesto: row.PUESTO,
        capacita: readBooleanValue(row.CAPACITA),
      });
      const profile = {
        id: String(key || ""),
        name: String(name || ""),
        position: String(row.PUESTO || ""),
        role: accessProfile.role,
        accessProfile,
      };
      phoneSet.add(phone);
      profileByPhone.set(phone, profile);
      profileByPhone.set(phoneIdentityKey(phone), profile);
      const list = phoneToEmployeeKeys.get(phone) || [];
      if (key && !list.includes(key)) list.push(key);
      phoneToEmployeeKeys.set(phone, list);
    }
  }

  employeesCache.ts = Date.now();
  employeesCache.phoneSet = phoneSet;
  employeesCache.phoneToEmployeeKeys = phoneToEmployeeKeys;
  employeesCache.nameByKey = nameByKey;
  employeesCache.profileByPhone = profileByPhone;
  return employeesCache;
}

async function handleAiText(client, jid, text, identity) {
  const config = ensureRuntimeConfig();
  if (!config.aiServerUrl || !config.aiClientId || !config.aiClientToken) return false;

  const history = aiConversationContext.get(jid) || [];
  const searchQuery = resolveAiSearchQuery(text, history);
  const businessContext = await buildAuthorizedAiContext(identity, searchQuery);
  const normalizedQuery = normalizeText(text);
  if (/\b(proteccion civil|sistema pc|pc estatal)\b/.test(normalizedQuery)
    && /\b(casa ley|ley)\b/.test(normalizedQuery)
    && hasSucursalDocumentAccess(identity)) {
    const status = ["visitada", "rechazada", "subsanadas", "firmada", "autorizada", "creada", "en captura", "revision campo"]
      .find((value) => normalizedQuery.includes(value.slice(0, 5))) || "";
    businessContext.pcEstatal = await executeAiToolCall({
      function: { name: "consultar_pc_estatal", arguments: { empresa: "ley", estatus: status } },
    }, identity);
    if (!businessContext.pcEstatal.error) {
      const result = businessContext.pcEstatal;
      const label = result.estatus === "todos" ? "solicitudes" : `solicitudes con estatus ${result.estatus}`;
      const lines = result.registros.map((row, index) =>
        `${index + 1}. ${row.tienda} ${row.sucursal}`.replace(/\s+/g, " ").trim()
        + ` | ${row.estatus} | ${row.fechaRegistro}`
      );
      await client.sendMessage(jid,
        `${result.empresa}: ${result.total} ${label} en Proteccion Civil Estatal (${result.anio}).`
        + (lines.length ? `\n\n${lines.join("\n")}` : "")
      );
      aiConversationContext.delete(jid);
      return true;
    }
  }
  history.push({ role: "user", content: String(text).slice(0, 4000) });
  const messages = history.slice(-10);
  try {
    let answer = "";
    for (let step = 0; step < 3; step += 1) {
      const response = await fetchAiResponse(`${config.aiServerUrl}/v1/respond`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-client-id": config.aiClientId,
          authorization: `Bearer ${config.aiClientToken}`,
        },
        body: JSON.stringify({ identity, businessContext, messages }),
        signal: AbortSignal.timeout(config.aiTimeoutMs),
      });
      if (!response.ok) throw new Error(`ai_http_${response.status}`);
      const payload = await response.json();
      const toolCalls = Array.isArray(payload?.toolCalls) ? payload.toolCalls.slice(0, 2) : [];
      if (!toolCalls.length) {
        answer = String(payload?.content || "").trim();
        break;
      }
      messages.push({ role: "assistant", content: "", tool_calls: toolCalls });
      for (const call of toolCalls) {
        const result = await executeAiToolCall(call, identity);
        messages.push({ role: "tool", tool_name: call?.function?.name, content: JSON.stringify(result) });
      }
    }
    if (!answer) throw new Error("ai_empty_response");
    if (isFabricatedInfrastructureResponse(text, answer)) {
      getLogger().warn({ jid }, "AI returned unsupported infrastructure explanation");
      answer = "No pude verificar esa informacion con los datos disponibles en este momento. Intenta de nuevo en unos minutos.";
    }
    history.push({ role: "assistant", content: answer });
    aiConversationContext.set(jid, history.slice(-10));
    await client.sendMessage(jid, answer.slice(0, 12000));
  } catch (error) {
    getLogger().error({ error: error?.message || String(error), jid }, "local AI request failed");
    await client.sendMessage(jid, "El asistente inteligente no esta disponible en este momento. Intenta de nuevo en unos minutos.");
  }
  return true;
}

export async function fetchAiResponse(url, options, {
  fetchImpl = fetch,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  maxBusyRetries = 36,
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, options);
    if (response.status !== 429 || attempt >= maxBusyRetries) return response;

    let retryAfterSeconds = Number(response.headers?.get?.("retry-after"));
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
      try {
        const payload = await response.json();
        retryAfterSeconds = Number(payload?.retryAfterSeconds);
      } catch {}
    }
    const delayMs = Math.min(10_000, Math.max(1_000, (retryAfterSeconds || 5) * 1000));
    getLogger().warn({ attempt: attempt + 1, delayMs }, "local AI busy; retrying");
    await sleep(delayMs);
  }
}

export function isFabricatedInfrastructureResponse(query, answer) {
  const asksInfrastructure = /\b(puerto|servidor|conexion|url|api|docker)\b/.test(normalizeText(query));
  return !asksInfrastructure && /\b(puerto\s+\d+|servidor local|url (correcta|solicitada)|acceder al servidor)\b/.test(normalizeText(answer));
}

export function resolveAiSearchQuery(text, history = []) {
  const current = String(text || "").trim();
  const normalized = normalizeText(current);
  const refersBack = /\b(eso|esa|ese|esas|esos|similar|similares|anterior|anteriores|tambien|ahora|mism[ao]s?)\b/.test(normalized);
  if (!refersBack && normalized.split(/\s+/).length > 3) return current;
  const previous = [...history].reverse().find((item) => item?.role === "user" && item.content);
  return previous ? `${String(previous.content).slice(0, 500)} ${current}` : current;
}

export function isTrainingStatusRequest(text) {
  const normalized = normalizeText(text);
  return /\b(programad[ao]s?|finalizad[ao]s?|terminad[ao]s?)\b/.test(normalized)
    && (/\b(capacitacion|capacitaciones)\b/.test(normalized)
      || normalized.split(/\s+/).length <= 4);
}

export function selectTrainingRowsByStatus(rows, status, today = new Date()) {
  const boundary = new Date(today);
  boundary.setHours(0, 0, 0, 0);
  const target = normalizeText(status).startsWith("program") ? "programadas" : "finalizadas";
  return (rows || []).filter((row) => {
    const rawDate = String(row["FECHA CAPACITACION"] || "").trim();
    if (!rawDate) return false;
    const date = parseBusinessDate(rawDate);
    if (Number.isNaN(date.getTime())) return false;
    return target === "programadas" ? date >= boundary : date < boundary;
  }).sort((left, right) => {
    const difference = parseBusinessDate(left["FECHA CAPACITACION"]) - parseBusinessDate(right["FECHA CAPACITACION"]);
    return target === "programadas" ? difference : -difference;
  });
}

async function handleVerifiedTrainingStatusRequest(client, jid, text, identity) {
  if (!isTrainingStatusRequest(text)) return false;
  const permission = identity?.accessProfile?.views?.capacitaciones;
  if (!permission?.actions?.includes("view")) {
    await client.sendMessage(jid, "No tienes permiso para consultar capacitaciones.");
    return true;
  }
  const status = /\b(programad[ao]s?)\b/.test(normalizeText(text)) ? "programadas" : "finalizadas";
  const employeeId = String(identity.id || "");
  const rows = readLocalOperationalTable("CAPACITACIONES").filter((row) =>
    permission.scope === "all" || splitEnumList(row.CAPACITADORES).map(String).includes(employeeId)
  );
  const selected = selectTrainingRowsByStatus(rows, status);
  const resolved = await resolveNames(selected.slice(0, status === "programadas" ? 20 : 10));
  const lines = resolved.map((row, index) => [
    `${index + 1}. ${formatAiDate(row["FECHA CAPACITACION"])}`,
    `Sede: ${aiLabel(row.CEDE, "Sin sede")}`,
    `Capacitadores: ${aiLabelList(row.CAPACITADORES, "Sin capacitadores")}`,
  ].join(" | "));
  const detail = status === "programadas" ? "" : " (mostrando las 10 mas recientes)";
  await client.sendMessage(jid, `${selected.length} capacitaciones ${status}.`
    + (lines.length ? `\n\n${lines.join("\n")}${selected.length > lines.length ? detail : ""}` : ""));
  aiConversationContext.delete(jid);
  return true;
}

async function buildAuthorizedAiContext(identity, queryText = "") {
  if (!identity || identity.role === "sin-acceso") {
    return { access: "denied", reason: "No se encontro un empleado con acceso autorizado." };
  }

  const views = identity.accessProfile?.views || {};
  const normalizedQuery = normalizeText(queryText);
  const asksTraining = /\b(capacitacion|capacitaciones|siguiente|siguientes|proxima|proximas)\b/.test(normalizedQuery);
  const asksCertificates = /\b(constancia|constancias|diploma|diplomas)\b/.test(normalizedQuery);
  const moduleLabels = {
    calendario: "Calendario",
    capacitaciones: "Capacitaciones",
    "constancias-faltantes": "Constancias faltantes",
    "crear-constancias-por-capacitador": "Constancias por capacitador",
    "crear-constancias-por-capacitacion": "Constancias por capacitacion",
    "informacion-sucursales": "Informacion de sucursales",
    notas: "Notas",
    pedidos: "Pedidos",
    "faltantes-ley": "Faltantes Ley",
    gestion: "Gestion",
    jobs: "Procesos programados",
    whatsapp: "WhatsApp",
    facturacion: "Facturacion y cotizaciones",
    planeacion: "Planeacion",
    documentos: "Documentos",
    reportes: "Reportes",
    poliza: "Polizas",
  };
  const actionLabels = {
    view: "consultar",
    create: "crear",
    edit: "editar",
    delete: "eliminar",
  };
  const scopeLabels = {
    all: "todos los registros",
    own: "solo sus registros",
    none: "sin acceso",
  };
  const authorizedModules = Object.entries(views).filter(([, permission]) =>
    permission?.scope !== "none" && permission?.actions?.length
  ).map(([module, permission]) => ({
    clave: module,
    nombre: moduleLabels[module] || module,
    acciones: (permission.actions || []).map((action) => actionLabels[action] || action),
    alcance: scopeLabels[permission.scope] || scopeLabels.none,
  }));
  const config = ensureRuntimeConfig();
  const rows = await loadCapacitacionesRows().catch(() => []);
  const employeeId = String(identity.id || "");
  const visibleRows = identity.role === "admin" ? rows : rows.filter((row) => {
    return splitEnumList(row[config.capacitacionesCapacitadoresCol]).map(String).includes(employeeId);
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const resolvedRows = await resolveNames(visibleRows);
  const upcoming = resolvedRows
    .filter((row) => parseBusinessDate(row[config.capacitacionesDateCol]) >= today)
    .sort((a, b) => parseBusinessDate(a[config.capacitacionesDateCol]) - parseBusinessDate(b[config.capacitacionesDateCol]))
    .slice(0, asksTraining ? 12 : 0)
    .map((row) => ({
      fecha: formatAiDate(row[config.capacitacionesDateCol]),
      sede: aiLabel(row[config.capacitacionesCedeCol], "Sede sin etiqueta"),
      sucursales: aiLabelList(row[config.capacitacionesSucursalesCol], "Sin sucursales etiquetadas"),
      capacitadores: aiLabelList(row[config.capacitacionesCapacitadoresCol], "Sin capacitadores etiquetados"),
    }));

  const constanciasPermission = views["constancias-faltantes"] || { actions: [], scope: "none" };
  const mentionedEmployeeIds = identity.role === "admin"
    ? findMentionedEmployeeIds(queryText, employeesCache.nameByKey)
    : [];
  const pendingRows = resolvedRows
    .filter((row, index) => {
      const rawRow = visibleRows[index];
      const date = parseBusinessDate(rawRow[config.capacitacionesDateCol]);
      if (Number.isNaN(date.getTime()) || date >= today || readBooleanValue(rawRow.DIPLOMAS)) return false;
      if (!mentionedEmployeeIds.length) return true;
      const assignedIds = new Set(splitEnumList(rawRow[config.capacitacionesCapacitadoresCol]).map(String));
      return mentionedEmployeeIds.some((employeeId) => assignedIds.has(employeeId));
    })
    .sort((a, b) => parseBusinessDate(b[config.capacitacionesDateCol]) - parseBusinessDate(a[config.capacitacionesDateCol]));
  const pendingConstancias = constanciasPermission.actions.includes("view")
    ? pendingRows.slice(0, asksCertificates ? 30 : 0).map((row) => ({
        fecha: formatAiDate(row[config.capacitacionesDateCol]),
        sede: aiLabel(row[config.capacitacionesCedeCol], "Sede sin etiqueta"),
        sucursales: aiLabelList(row[config.capacitacionesSucursalesCol], "Sin sucursales etiquetadas"),
        capacitadores: aiLabelList(row[config.capacitacionesCapacitadoresCol], "Sin capacitadores etiquetados"),
      }))
    : [];

  const context = {
    generatedAt: new Date().toISOString(),
    source: "Monolito Desarrollo EG y base local sincronizada",
    employee: { nombre: identity.name, puesto: identity.position, rol: identity.role, identidadVerificada: true },
    authorization: {
      defaultPolicy: "denegar",
      enforcement: "El monolito vuelve a validar cada herramienta; el modelo no puede ampliar permisos.",
      modules: authorizedModules,
      rules: [
        "Solo consultar entidades cuyos modulos aparecen autorizados.",
        "Alcance propio significa registros asignados al empleado autenticado.",
        "Consultar no autoriza crear, editar ni eliminar.",
        "No revelar datos usados para evaluar una solicitud rechazada por permisos.",
      ],
    },
    documentacion: searchAuthorizedDocumentation(queryText, identity),
    datosOperativos: searchAuthorizedOperationalData(queryText, identity, readLocalOperationalTable),
    systemModel: {
      purpose: "Explicar y consultar la operacion de Desarrollo EG usando datos actuales y documentacion autorizada.",
      entities: {
        empresa: "Cliente que agrupa sucursales y razones sociales.",
        sucursal: "Centro de trabajo identificado por tienda; pertenece a una empresa y relaciona ubicacion, riesgo, trabajos, planeacion, capacitaciones y carpeta Drive.",
        capacitacion: "Evento con fecha, sede, sucursales participantes, capacitadores, horario, notas y estatus de constancias.",
        empleado: "Usuario interno con puesto, rol, permisos y alcance propio o global.",
        documento: "Archivo almacenado en la carpeta Drive de una sucursal.",
        trabajo: "Servicio estatal, municipal, dictamen u otra operacion contratada para una sucursal.",
        cotizacion: "Operacion comercial relacionada con empresas, sucursales, conceptos y precios.",
      },
      relations: [
        "Una empresa tiene muchas sucursales.",
        "Una sucursal puede participar en muchas capacitaciones y cada capacitacion puede incluir varias sucursales.",
        "Una capacitacion tiene una sede y uno o varios capacitadores.",
        "Los documentos pertenecen a la carpeta Drive de la sucursal.",
        "Los permisos del empleado determinan las entidades, registros y operaciones disponibles.",
      ],
      responseRules: [
        "Usar nombres y etiquetas, nunca IDs internos salvo que el usuario los pida.",
        "Expresar fechas como dia, mes y anio.",
        "No pedir URL ni acceso a sistemas: los datos autorizados ya estan en este contexto.",
        "No inventar campos ausentes; indicar claramente cuando un dato no esta registrado.",
      ],
    },
    authorizedModules,
    semanticEntities: semanticCatalogForIdentity(identity),
    capacitaciones: {
      visibleTotal: visibleRows.length,
      programadasTotal: selectTrainingRowsByStatus(visibleRows.map((row) => ({
        ...row, "FECHA CAPACITACION": row[config.capacitacionesDateCol],
      })), "programadas", today).length,
      finalizadasTotal: selectTrainingRowsByStatus(visibleRows.map((row) => ({
        ...row, "FECHA CAPACITACION": row[config.capacitacionesDateCol],
      })), "finalizadas", today).length,
      proximas: upcoming,
    },
    constanciasPendientes: constanciasPermission.actions.includes("view")
      ? { total: pendingRows.length, registros: pendingConstancias }
      : { acceso: "sin permiso" },
  };

  if (identity.role === "admin") {
    const [empresas, sucursales] = await Promise.all([
      loadCachedAppSheetRows({ table: "EMPRESAS" }).catch(() => []),
      loadCachedAppSheetRows({ table: "SUCURSALES" }).catch(() => []),
    ]);
    context.organizationSummary = {
      empresas: empresas.length,
      sucursales: sucursales.length,
      capacitaciones: rows.length,
    };
  }

  if (hasSucursalDocumentAccess(identity)) {
    const candidates = await findSucursalCandidates(queryText).catch(() => []);
    if (candidates[0] && isStrongSucursalMatch(candidates[0], candidates[1])) {
      context.requestedSucursal = buildSucursalContextRecord(candidates[0]);
    }
  }
  return context;
}

function findMentionedEmployeeIds(queryText, namesByKey) {
  const query = normalizeText(queryText);
  if (!query) return [];
  const matches = [];
  for (const [employeeId, employeeName] of namesByKey.entries()) {
    const normalizedName = normalizeText(employeeName);
    const meaningfulParts = normalizedName.split(" ").filter((part) => part.length >= 4);
    if (query.includes(normalizedName) || meaningfulParts.some((part) => query.includes(part))) {
      matches.push(String(employeeId));
    }
  }
  return matches;
}

export function isPendingConstanciasRequest(text) {
  const normalized = normalizeText(text);
  return /\b(constancia|constancias|diploma|diplomas)\b/.test(normalized)
    && /\b(pendiente|pendientes|faltante|faltantes)\b/.test(normalized);
}

export function isPendingSistemaPcRequest(text) {
  const normalized = normalizeText(text);
  return /\b(sistema (de )?proteccion civil|sistema pc)\b/.test(normalized)
    && /\b(pendiente|pendientes|falta|faltan|sin subir|subir)\b/.test(normalized)
    && /\b(sucursal|sucursales|tienda|tiendas)\b/.test(normalized);
}

export function isCreatedSistemaPcRequest(text) {
  const normalized = normalizeText(text);
  return /\b(proteccion civil|sistema pc|pc estatal)\b/.test(normalized)
    && /\bcread[ao]s?\b/.test(normalized)
    && /\b(sucursal|sucursales|tienda|tiendas)\b/.test(normalized);
}

export function selectSistemaPcRows(pcRows, sucursales, companyId, year, requestedStatus = "") {
  const branches = sucursales.filter((branch) =>
    String(getFirstFlexible(branch.raw, ["ID EMPRESA", "EMPRESA"])) === String(companyId)
  );
  const latest = resolvePcEstatalBySucursal({
    sucursales: branches.map((branch) => ({ id: branch.key, tienda: branch.tienda, id_pc: branch.idPc })),
    pcRows,
    year,
  });
  return branches
    .flatMap((branch) => {
      const status = latest.get(String(branch.key));
      if (!status) return [];
      const actual = normalizeText(status.status).replace(/\bcreado\b/g, "creada");
      const requested = normalizeText(requestedStatus).replace(/\bcreado\b/g, "creada");
      return !requested || actual === requested ? [{ branch, status }] : [];
    })
    .sort((a, b) => Number(a.branch.tienda) - Number(b.branch.tienda));
}

export function selectCreatedSistemaPcRows(pcRows, sucursales, companyId, year) {
  return selectSistemaPcRows(pcRows, sucursales, companyId, year, "creada");
}

async function executeAiToolCall(call, identity) {
  const toolName = call?.function?.name;
  if (!["consultar_pc_estatal", "consultar_datos_operativos"].includes(toolName)) return { error: "Herramienta no autorizada" };
  let args = call.function.arguments || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return { error: "Argumentos invalidos" }; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return { error: "Argumentos invalidos" };
  if (toolName === "consultar_datos_operativos") {
    const result = executeAuthorizedDataQuery(args, identity, readLocalOperationalTable);
    getLogger().info({
      herramienta: toolName,
      empleadoId: String(identity?.id || ""),
      entidad: String(args.entidad || ""),
      autorizado: !result?.error,
      total: Number.isInteger(result?.total) ? result.total : undefined,
    }, "AI authorized tool query");
    return result;
  }
  if (!hasSucursalDocumentAccess(identity)) return { error: "Sin permiso para consultar sucursales" };
  const companyQuery = normalizeText(String(args.empresa || "").slice(0, 100));
  if (!companyQuery) return { error: "Indica la empresa" };
  const year = Number(args.anio || new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2020 || year > new Date().getFullYear() + 1) {
    return { error: "Ano invalido" };
  }
  const [pcRows, sucursales, empresas] = await Promise.all([
    loadCachedAppSheetRows({ table: "STATUS SISTEMA PC" }),
    loadSucursalesCache(),
    loadEmpresasCache(),
  ]);
  const company = [...empresas.rowsByKey.entries()].find(([, row]) =>
    normalizeText(getFirstFlexible(row, ["RAZON SOCIAL", "RAZON_SOCIAL", "NOMBRE COMERCIAL", "NOMBRE_COMERCIAL", "LABEL"]))
      .includes(companyQuery)
  );
  if (!company) return { error: "Empresa no encontrada" };
  const rows = selectSistemaPcRows(pcRows, sucursales.rows, company[0], year, String(args.estatus || "").slice(0, 60));
  return {
    empresa: getFirstFlexible(company[1], ["RAZON SOCIAL", "NOMBRE COMERCIAL", "LABEL"]),
    anio: year,
    estatus: String(args.estatus || "todos"),
    total: rows.length,
    registros: rows.slice(0, 100).map(({ branch, status }) => ({
      tienda: branch.tienda,
      sucursal: [branch.tipo, branch.name || branch.nombreComercial].filter(Boolean).join(" "),
      estatus: status.status,
      fechaRegistro: formatAiDate(status.registroFecha),
    })),
    truncado: rows.length > 100,
  };
}

async function handleVerifiedOperationalRequest(client, jid, text, identity) {
  const query = normalizeText(text);
  const wantsCompanies = /\bempresa(?:s)?\b/.test(query)
    && /\b(?:registrad\w*|tenemos|lista|dame|muestr\w*)\b/.test(query)
    && !/\b(?:sucursal(?:es)?|tienda(?:s)?)\b/.test(query);
  const company = /\bmilano\b/.test(query) ? "milano" : /\b(?:casa )?ley\b/.test(query) ? "ley" : "";
  const entity = wantsCompanies ? "empresas" : /\bmunicipal(?:es)?\b/.test(query) ? "municipales"
    : /\b(?:pipc|trabajo(?:s)? estatal(?:es)?)\b/.test(query) ? "pipc"
      : /\b(?:sucursal(?:es)?|tienda(?:s)?)\b/.test(query) && /\b(?:registrad|muestr|dame|lista)\w*\b/.test(query) ? "sucursales" : "";
  if ((!company && !wantsCompanies) || !entity) return false;
  const year = Number(query.match(/\b20\d{2}\b/)?.[0] || new Date().getFullYear());
  const city = /\bculiacan\b/.test(query) ? "culiacan" : "";
  const result = executeAuthorizedDataQuery({ entidad: entity, empresa: company, anio: year,
    municipio: city, detalle: true, limite: entity === "empresas" ? 100 : 30 }, identity, readLocalOperationalTable);
  if (result.error) {
    await client.sendMessage(jid, result.error);
    return true;
  }
  if (entity === "empresas") {
    const rows = result.registros.map((row, index) => `${index + 1}. ${row.nombre}`
      + (row.razonSocial && normalizeText(row.razonSocial) !== normalizeText(row.nombre)
        ? ` | ${row.razonSocial}` : ""));
    await client.sendMessage(jid, `${result.total} empresas registradas.\n\n${rows.join("\n")}`
      + (result.truncado ? `\n\nMostrando ${rows.length} de ${result.total}.` : ""));
    aiConversationContext.delete(jid);
    return true;
  }
  const subject = entity === "municipales" ? `trabajo municipal en ${year}`
    : entity === "pipc" ? `trabajo estatal/PIPC en ${year}` : "registradas";
  const place = city ? ` en ${city}` : "";
  const rows = result.registros.map((row, index) =>
    `${index + 1}. ${[row.tienda, row.sucursal, row.municipio].filter(Boolean).join(" | ")}`
  );
  await client.sendMessage(jid, `${company.toUpperCase()}: ${result.total} sucursales${place} con ${subject}.`
    + (rows.length ? `\n\n${rows.join("\n")}` : "")
    + (result.truncado ? "\n\nMostrando las primeras 30." : ""));
  aiConversationContext.delete(jid);
  return true;
}

async function handleCreatedSistemaPcRequest(client, jid, text, identity) {
  if (!isCreatedSistemaPcRequest(text)) return false;
  if (!hasSucursalDocumentAccess(identity)) {
    await client.sendMessage(jid, "No tienes permiso para consultar informacion de sucursales.");
    return true;
  }
  if (!/\b(casa ley|ley)\b/.test(normalizeText(text))) {
    await client.sendMessage(jid, "Indica la empresa para consultar el estatus en Proteccion Civil.");
    return true;
  }
  const [pcRows, sucursales, empresas] = await Promise.all([
    loadCachedAppSheetRows({ table: "STATUS SISTEMA PC" }),
    loadSucursalesCache(),
    loadEmpresasCache(),
  ]);
  const company = [...empresas.rowsByKey.entries()].find(([, row]) =>
    normalizeText(getFirstFlexible(row, ["RAZON SOCIAL", "RAZON_SOCIAL", "NOMBRE COMERCIAL", "NOMBRE_COMERCIAL"])).includes("ley")
  );
  if (!company) {
    await client.sendMessage(jid, "No encontre la empresa Casa Ley en la base local.");
    return true;
  }
  const year = new Date().getFullYear();
  const created = selectCreatedSistemaPcRows(pcRows, sucursales.rows, company[0], year);
  aiConversationContext.delete(jid);
  if (!created.length) {
    await client.sendMessage(jid, `No hay tiendas de Casa Ley con estatus Creada en Proteccion Civil en ${year}.`);
    return true;
  }
  const lines = created.map(({ branch, status }, index) =>
    `${index + 1}. ${branch.tienda} ${branch.tipo || ""} ${branch.name || branch.nombreComercial}`.replace(/\s+/g, " ").trim()
    + ` | Registro: ${formatAiDate(status.registroFecha)}`
  );
  await client.sendMessage(jid, `Casa Ley: ${created.length} tiendas con estatus Creada en Proteccion Civil (${year}).\n\n${lines.join("\n")}`);
  return true;
}

export function selectPendingSistemaPcRows(rows, sucursales, companyId, year) {
  const byKey = new Map(sucursales.map((row) => [String(row.key), row]));
  const latest = new Map();
  for (const row of rows) {
    const branch = byKey.get(String(getFirstFlexible(row, ["SUCURSAL", "sucursal_id"])));
    if (!branch || String(getFirstFlexible(branch.raw, ["ID EMPRESA", "EMPRESA"])) !== String(companyId)) continue;
    const date = String(getFirstFlexible(row, ["FECHA", "CAPACITACION"])) || "";
    if (!date.includes(String(year))) continue;
    const key = String(branch.key);
    const timestamp = parseBusinessDate(date).getTime() || 0;
    const previous = latest.get(key);
    if (!previous || timestamp >= previous.timestamp) latest.set(key, { branch, row, timestamp });
  }
  return [...latest.values()]
    .filter(({ row }) => normalizeText(getFirstFlexible(row, ["SISTEMA PC"])) !== "en sistema pc")
    .sort((a, b) => Number(a.branch.tienda) - Number(b.branch.tienda));
}

async function handlePendingSistemaPcRequest(client, jid, text, identity) {
  if (!isPendingSistemaPcRequest(text)) return false;
  if (!hasSucursalDocumentAccess(identity)) {
    await client.sendMessage(jid, "No tienes permiso para consultar informacion de sucursales.");
    return true;
  }
  const companyQuery = normalizeText(text);
  if (!/\b(casa ley|ley)\b/.test(companyQuery)) {
    await client.sendMessage(jid, "Indica la empresa para consultar las sucursales pendientes de subir al Sistema de Proteccion Civil.");
    return true;
  }
  const [estatales, sucursales, empresas] = await Promise.all([
    loadCachedAppSheetRows({ table: "ESTATALES" }),
    loadSucursalesCache(),
    loadEmpresasCache(),
  ]);
  const company = [...empresas.rowsByKey.entries()].find(([, row]) =>
    normalizeText(getFirstFlexible(row, ["RAZON SOCIAL", "RAZON_SOCIAL", "NOMBRE COMERCIAL", "NOMBRE_COMERCIAL"])).includes("ley")
  );
  if (!company) {
    await client.sendMessage(jid, "No encontre la empresa Casa Ley en la base local.");
    return true;
  }
  const year = new Date().getFullYear();
  const pending = selectPendingSistemaPcRows(estatales, sucursales.rows, company[0], year);
  aiConversationContext.delete(jid);
  if (!pending.length) {
    await client.sendMessage(jid, `No hay sucursales de Casa Ley pendientes de subir al Sistema de Proteccion Civil en ${year}.`);
    return true;
  }
  const lines = pending.map(({ branch, row }, index) =>
    `${index + 1}. ${branch.tienda} ${branch.tipo || ""} ${branch.name || branch.nombreComercial}`.replace(/\s+/g, " ").trim()
    + ` | PIPC: ${getFirstFlexible(row, ["PIPC"]) || "Sin estatus"}`
  );
  await client.sendMessage(jid,
    `Casa Ley: ${pending.length} sucursales pendientes de subir al Sistema de Proteccion Civil (${year}).\n` +
    `El estatus PIPC indica el avance del documento, no si ya esta en el sistema.\n\n${lines.join("\n")}`
  );
  return true;
}

async function handlePendingConstanciasRequest(client, jid, text, identity) {
  if (!isPendingConstanciasRequest(text)) return false;
  const permission = identity?.accessProfile?.views?.["constancias-faltantes"];
  if (!permission?.actions?.includes("view")) {
    await client.sendMessage(jid, "No tienes permiso para consultar constancias pendientes.");
    return true;
  }

  const config = ensureRuntimeConfig();
  const [rows, employees] = await Promise.all([loadCapacitacionesRows(), loadEmployeesCache()]);
  const mentionedIds = findMentionedEmployeeIds(text, employees.nameByKey);
  const employeeId = String(identity?.id || "");
  let authorizedRows = identity?.role === "admin"
    ? rows
    : rows.filter((row) => splitEnumList(row[config.capacitacionesCapacitadoresCol]).map(String).includes(employeeId));
  if (mentionedIds.length) {
    authorizedRows = authorizedRows.filter((row) => {
      const assignedIds = new Set(splitEnumList(row[config.capacitacionesCapacitadoresCol]).map(String));
      return mentionedIds.some((id) => assignedIds.has(id));
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pending = (await resolveNames(authorizedRows))
    .filter((row) => {
      const date = parseBusinessDate(row[config.capacitacionesDateCol]);
      return !Number.isNaN(date.getTime()) && date < today && !readBooleanValue(row.DIPLOMAS);
    })
    .sort((a, b) => parseBusinessDate(b[config.capacitacionesDateCol]) - parseBusinessDate(a[config.capacitacionesDateCol]));

  aiConversationContext.delete(jid);
  if (!pending.length) {
    const target = mentionedIds.length ? " para la persona indicada" : "";
    await client.sendMessage(jid, `No hay constancias pendientes${target}.`);
    return true;
  }

  const targetNames = mentionedIds.map((id) => employees.nameByKey.get(id)).filter(Boolean);
  const title = targetNames.length
    ? `Constancias pendientes de ${targetNames.join(", ")}: ${pending.length}`
    : `Constancias pendientes: ${pending.length}`;
  const lines = pending.map((row, index) => [
    `${index + 1}. ${formatAiDate(row[config.capacitacionesDateCol])}`,
    `Sede: ${aiLabel(row[config.capacitacionesCedeCol], "Sin sede")}`,
    `Sucursales: ${aiLabelList(row[config.capacitacionesSucursalesCol], "Sin sucursales etiquetadas")}`,
  ].join(" | "));
  await client.sendMessage(jid, `${title}\n\n${lines.join("\n")}`.slice(0, 12000));
  return true;
}

function formatAiDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Fecha no indicada";
  const parts = businessDateParts(raw);
  const date = parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function parseBusinessDate(value) {
  const raw = String(value || "").trim();
  const parts = businessDateParts(raw);
  if (parts) return new Date(parts.year, parts.month - 1, parts.day);
  return new Date(raw || 0);
}

function businessDateParts(raw) {
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let year;
  let month;
  let day;
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const localMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (!localMatch) return null;
    const first = Number(localMatch[1]);
    const second = Number(localMatch[2]);
    year = Number(localMatch[3]);
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return { year, month, day };
}

function aiLabel(value, fallback) {
  const label = normalizeDisplay(value);
  return !label || isLikelyIdentifier(label) ? fallback : label;
}

function aiLabelList(value, fallback) {
  const labels = splitEnumList(value).map(normalizeDisplay).filter((item) => item && !isLikelyIdentifier(item));
  return labels.length ? labels.join(", ") : fallback;
}

async function loadEmpresasCache() {
  const config = ensureRuntimeConfig();
  const ttlMs = 5 * 60 * 1000;
  if (Date.now() - empresasCache.ts < ttlMs && empresasCache.rowsByKey.size) return empresasCache;

  const rows = await loadCachedAppSheetRows({
    table: "EMPRESAS",
    selector: "Filter(EMPRESAS, true)",
  });
  const rowsByKey = new Map();

  for (const row of rows || []) {
    const key = String(
      getFirstFlexible(row, ["ID", "Id", "id", "Row ID", "ROW ID", "RowId"]) ?? ""
    ).trim();
    if (!key) continue;
    rowsByKey.set(key, row);
  }

  empresasCache.ts = Date.now();
  empresasCache.rowsByKey = rowsByKey;
  return empresasCache;
}

async function loadSucursalesCache() {
  const config = ensureRuntimeConfig();
  const ttlMs = 5 * 60 * 1000;
  if (Date.now() - sucursalesCache.ts < ttlMs) return sucursalesCache;

  const [data, empresas] = await Promise.all([
    loadCachedAppSheetRows({
      table: config.appsheetTableSucursales,
      selector: `Filter(${config.appsheetTableSucursales}, true)`,
    }),
    loadEmpresasCache(),
  ]);

  const rows = data;
  const searchableFields = [
    config.sucursalesRazonSocialCol,
    config.sucursalesEmpresaCol,
    config.sucursalesLabelCol,
    config.sucursalesTiendaCol,
    config.sucursalesNameCol,
    config.sucursalesNombreComercialCol,
  ];
  const nameByKey = new Map();
  const keyByTienda = new Map();
  const driveByKey = new Map();
  const indexedRows = [];

  for (const row of rows || []) {
    const key = row[config.sucursalesKeyCol];
    const name = row[config.sucursalesNameCol];
    const tienda = row[config.sucursalesTiendaCol];
    const drive = row[config.sucursalesDriveCol];
    const empresaId = normalizeDisplay(getFirstFlexible(row, [config.sucursalesEmpresaCol, "ID EMPRESA", "Empresa", "EMPRESA", "empresa"]));
    const empresaRow = empresaId ? empresas.rowsByKey.get(empresaId) || null : null;
    const empresaDesdeFila = normalizeDisplay(
      getFirstFlexible(row, [
        config.sucursalesEmpresaCol,
        "EMPRESA",
        "Empresa",
        "NOMBRE EMPRESA",
        "Nombre Empresa",
      ])
    );
    const empresaDesdeRelacion = normalizeDisplay(
      getFirstFlexible(empresaRow, ["NOMBRE", "Nombre", "LABEL2", "Label2", "LABEL", "Label"])
    );
    const empresa = uniqueDisplayParts([
      isLikelyIdentifier(empresaDesdeFila) ? "" : empresaDesdeFila,
      empresaDesdeRelacion,
    ]).join(" / ");
    const razonSocial = normalizeDisplay(
      getFirstFlexible(row, [
        config.sucursalesRazonSocialCol,
        "RAZON SOCIAL",
        "Razón Social",
        "Razon Social",
        "razon social",
      ]) || getFirstFlexible(empresaRow, ["RAZON SOCIAL", "Razón Social", "Razon Social", "razon social", "NOMBRE"])
    );
    const label = normalizeDisplay(row[config.sucursalesLabelCol]);
    const nombreComercial = normalizeDisplay(row[config.sucursalesNombreComercialCol]);
    const values = getFieldValues(row, searchableFields);
    const searchText = normalizeText(values.join(" "));
    const tokens = splitWords(searchText);
    if (key && name) nameByKey.set(String(key), String(name));
    if (tienda && key) keyByTienda.set(String(tienda).trim(), String(key));
    if (key && drive) driveByKey.set(String(key), String(drive).trim());
    indexedRows.push({
      key: key ? String(key) : "",
      name: normalizeDisplay(name),
      tienda: normalizeDisplay(tienda),
      drive: normalizeDisplay(drive),
      razonSocial,
      empresa,
      label,
      nombreComercial,
      direccion: normalizeDisplay(row.DIRECCION),
      municipio: normalizeDisplay(getFirstFlexible(row, ["MUNICIPIO_NOMBRE", "MUNICIPIO NOMBRE", "Municipio Nombre"])),
      estado: normalizeDisplay(getFirstFlexible(row, ["ESTADO_NOMBRE", "ESTADO NOMBRE", "Estado Nombre"])),
      latitud: normalizeDisplay(getFirstFlexible(row, ["LATITUD", "LAT"])),
      longitud: normalizeDisplay(getFirstFlexible(row, ["LONGITUD", "LNG"])),
      tipo: normalizeDisplay(row.TIPO),
      nivelRiesgo: normalizeDisplay(row["NIVEL DE RIESGO"]),
      trabajos: normalizeDisplay(row.TRABAJOS),
      capacitadores: normalizeDisplay(row.CAPACITADORES),
      idPc: normalizeDisplay(getFirstFlexible(row, ["ID PC", "ID_PC"])),
      mesPlaneacion: normalizeDisplay(row["MES PLANEACION"]),
      vencimientoEstatal: normalizeDisplay(row["VENCIMIENTO ESTATAL"]),
      vencimientoMunicipal: normalizeDisplay(row["VENCIMIENTO MUNICIPAL"]),
      pedido: normalizeDisplay(row.PEDIDO),
      estatusPlaneacion: normalizeDisplay(getFirstFlexible(row, ["ESTATUS PLANEACION", "STATUS"])),
      searchText,
      tokens,
      raw: row,
    });
  }

  sucursalesCache.ts = Date.now();
  sucursalesCache.rows = indexedRows;
  sucursalesCache.nameByKey = nameByKey;
  sucursalesCache.keyByTienda = keyByTienda;
  sucursalesCache.driveByKey = driveByKey;
  return sucursalesCache;
}

async function loadCapacitacionesRows() {
  const config = ensureRuntimeConfig();
  return loadCachedAppSheetRows({
    table: config.appsheetTableCapacitaciones,
    selector: `Filter(${config.appsheetTableCapacitaciones}, true)`,
  });
}

function extractDriveId(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    raw = String(parsed?.Url || parsed?.url || raw).trim();
  } catch {
    // Plain Drive URLs and folder IDs are expected too.
  }
  if (!raw.includes("/")) return raw;

  try {
    const url = new URL(raw);
    const directId = url.searchParams.get("id");
    if (directId) return directId.trim();
  } catch {
    // ignore invalid urls and continue with path parsing
  }

  const match = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1] || "";
    if (lastPart && lastPart.toLowerCase() !== "folders" && lastPart.toLowerCase() !== "open") {
      return lastPart;
    }
    return "";
  } catch {
    return "";
  }
}

function splitEnumList(value) {
  return splitList(value);
}

async function resolveNames(rows) {
  const config = ensureRuntimeConfig();
  const [employees, sucursales] = await Promise.all([loadEmployeesCache(), loadSucursalesCache()]);

  return rows.map((row) => {
    const copy = { ...row };
    const cedeKey = String(row[config.capacitacionesCedeCol] ?? "");
    if (cedeKey && sucursales.nameByKey.has(cedeKey)) {
      copy[config.capacitacionesCedeCol] = sucursales.nameByKey.get(cedeKey);
    }

    const sucursalesList = splitEnumList(row[config.capacitacionesSucursalesCol]);
    if (sucursalesList.length) {
      copy[config.capacitacionesSucursalesCol] = sucursalesList
        .map((item) => sucursales.nameByKey.get(item) || item)
        .join(", ");
    }

    const capacitadoresList = splitEnumList(row[config.capacitacionesCapacitadoresCol]);
    if (capacitadoresList.length) {
      copy[config.capacitacionesCapacitadoresCol] = capacitadoresList
        .map((item) => employees.nameByKey.get(item) || item)
        .join(", ");
    }

    return copy;
  });
}

function formatCapacitaciones(rows, fields) {
  const config = ensureRuntimeConfig();
  const selectedFields = fields || config.capacitacionesFields;

  return rows.map((row) => {
    const parts = selectedFields.map((field) => {
      if (field === config.capacitacionesDateCol) {
        return `Fecha: ${formatAiDate(row[field])}`;
      }
      if (field === config.capacitacionesCedeCol) return `Cede: ${row[field] ?? ""}`;
      if (field === config.capacitacionesSucursalesCol) return `Sucursales: ${row[field] ?? ""}`;
      if (field === config.capacitacionesCapacitadoresCol) return `Capacitadores: ${row[field] ?? ""}`;
      return `${field}: ${row[field] ?? ""}`;
    });
    return `- ${parts.join(" | ")}`;
  }).join("\n");
}

function sortByDate(rows) {
  const config = ensureRuntimeConfig();
  return rows.sort((a, b) => {
    const aDate = parseBusinessDate(a[config.capacitacionesDateCol]);
    const bDate = parseBusinessDate(b[config.capacitacionesDateCol]);
    return aDate - bDate;
  });
}

async function loadOAuthClient(config, jsonPath) {
  const content = await fs.promises.readFile(jsonPath, "utf8");
  const credentials = JSON.parse(content);
  const { client_id: clientId, client_secret: clientSecret, redirect_uris: redirectUris } =
    credentials.installed || credentials.web || {};

  if (!clientId || !clientSecret || !redirectUris?.length) {
    throw new Error("Invalid OAuth client JSON");
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUris[0]);

  try {
    const token = await fs.promises.readFile(config.googleOauthTokenPath, "utf8");
    client.setCredentials(JSON.parse(token));
    return client;
  } catch {
    // continue
  }

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("Authorize this app by visiting this url:\n", authUrl);
  const code = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Enter the code from that page here: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  await fs.promises.mkdir(path.dirname(config.googleOauthTokenPath), { recursive: true });
  await fs.promises.writeFile(config.googleOauthTokenPath, JSON.stringify(tokens), "utf8");
  return client;
}

async function buildDriveClient() {
  const config = ensureRuntimeConfig();
  if (!config.googleServiceAccountJson) {
    throw new Error("WHATSAPP_CAP_GOOGLE_SERVICE_ACCOUNT_JSON no configurado");
  }

  const jsonPath = path.resolve(config.googleServiceAccountJson);
  const raw = await fs.promises.readFile(jsonPath, "utf8");
  const credentials = JSON.parse(raw);

  let auth = null;
  if (credentials.client_email && credentials.private_key) {
    auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SCOPES,
    });
  } else if (credentials.installed || credentials.web) {
    auth = await loadOAuthClient(config, jsonPath);
  } else {
    throw new Error("Unsupported credentials format");
  }

  return google.drive({ version: "v3", auth });
}

async function getDriveClient() {
  if (!runtime.driveClientPromise) {
    runtime.driveClientPromise = buildDriveClient().catch((error) => {
      runtime.driveClientPromise = null;
      throw error;
    });
  }
  return runtime.driveClientPromise;
}

async function uploadToDrive(drive, filePath, fileName, folderId = "") {
  const config = ensureRuntimeConfig();
  const mimeType = mime.lookup(filePath) || "application/octet-stream";
  const requestBody = { name: fileName };
  const targetFolder = folderId || config.driveFolderId;
  if (targetFolder) requestBody.parents = [targetFolder];

  const response = await drive.files.create({
    requestBody,
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });

  return response.data;
}

async function ensureFolder(drive, name, parentId = "") {
  const safeName = name.replace(/'/g, "\\'");
  const parts = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${safeName}'`,
    "trashed=false",
  ];
  if (parentId) parts.push(`'${parentId}' in parents`);

  const list = await drive.files.list({
    q: parts.join(" and "),
    fields: "files(id,name,webViewLink)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if (list.data.files?.length) return list.data.files[0];

  const requestBody = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) requestBody.parents = [parentId];

  const response = await drive.files.create({
    requestBody,
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });
  return response.data;
}

function createFlowContext() {
  return {
    step: "store",
    storeKey: null,
    storeLabel: null,
    storeDrive: null,
    files: [],
    failedFiles: [],
    uploading: false,
    retrying: false,
    targetFolderId: "",
    targetFolderName: "",
    targetFolderLink: "",
  };
}

function createArchivoFlowContext() {
  return {
    step: "query",
    query: "",
    matches: [],
    selectedCandidate: null,
    storeKey: null,
    storeLabel: null,
    storeDrive: null,
    files: [],
    failedFiles: [],
    uploading: false,
    retrying: false,
    targetFolderId: "",
    targetFolderName: "",
    targetFolderLink: "",
  };
}

async function beginUploadFlow(jid, client) {
  uploadContext.set(jid, createFlowContext());
  await client.sendMessage(jid, "Escribe el numero de tienda.");
}

async function beginStorePhotosFlow(jid, client) {
  storePhotosContext.set(jid, createFlowContext());
  await client.sendMessage(jid, "Escribe el numero de tienda.");
}

async function beginArchivoFlow(jid, client) {
  archivoContext.set(jid, createArchivoFlowContext());
  await client.sendMessage(
    jid,
    "Escribe la tienda, nombre comercial o razon social para buscar la sucursal."
  );
}

async function findSucursalCandidates(query) {
  const cache = await loadSucursalesCache();
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const candidates = cache.rows
    .map((row) => {
      const candidate = {
        key: row.key,
        tienda: row.tienda,
        name: row.name || cache.nameByKey.get(row.key) || "",
        drive: row.drive || cache.driveByKey.get(row.key) || "",
        razonSocial: row.razonSocial,
        empresa: row.empresa,
        label: row.label,
        nombreComercial: row.nombreComercial,
        direccion: row.direccion,
        municipio: row.municipio,
        estado: row.estado,
        latitud: row.latitud,
        longitud: row.longitud,
        tipo: row.tipo,
        nivelRiesgo: row.nivelRiesgo,
        trabajos: row.trabajos,
        capacitadores: row.capacitadores,
        idPc: row.idPc,
        mesPlaneacion: row.mesPlaneacion,
        vencimientoEstatal: row.vencimientoEstatal,
        vencimientoMunicipal: row.vencimientoMunicipal,
        pedido: row.pedido,
        estatusPlaneacion: row.estatusPlaneacion,
        searchText: row.searchText,
        tokens: row.tokens || [],
      };
      return {
        ...candidate,
        score: scoreSucursalCandidate(normalizedQuery, candidate),
      };
    })
    .filter((candidate) => candidate.score > 0.2)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftLabel = buildSucursalDisplay(left);
      const rightLabel = buildSucursalDisplay(right);
      return leftLabel.localeCompare(rightLabel, "es");
    });

  return candidates.slice(0, 3);
}

function formatSucursalChoices(matches) {
  return matches
    .slice(0, 3)
    .map((match, index) => {
      const label = buildSucursalDisplay(match);
      return `${index + 1}. ${label}`;
    })
    .join("\n");
}

function hasSucursalDocumentAccess(identity) {
  const permission = identity?.accessProfile?.views?.["informacion-sucursales"];
  return Boolean(permission?.actions?.includes("view"));
}

function buildSucursalContextRecord(candidate) {
  return {
    etiqueta: buildSucursalDisplay(candidate),
    tienda: candidate.tienda || "No registrada",
    nombre: candidate.name || candidate.nombreComercial || "No registrado",
    tipo: candidate.tipo || "No registrado",
    empresa: candidate.empresa || "No registrada",
    razonSocial: candidate.razonSocial || "No registrada",
    direccion: candidate.direccion || "No registrada",
    municipio: candidate.municipio || "No registrado",
    estado: candidate.estado || "No registrado",
    nivelRiesgo: candidate.nivelRiesgo || "No registrado",
    trabajos: candidate.trabajos || "No registrados",
    capacitadores: candidate.capacitadores || "No registrados",
    idProteccionCivil: candidate.idPc || "No registrado",
    mesPlaneacion: candidate.mesPlaneacion || "No registrado",
    estatusPlaneacion: candidate.estatusPlaneacion || "No registrado",
    vencimientoEstatal: candidate.vencimientoEstatal || "No registrado",
    vencimientoMunicipal: candidate.vencimientoMunicipal || "No registrado",
    pedido: candidate.pedido || "No registrado",
    drive: driveFolderLink(candidate.drive) || "No configurado",
  };
}

export function isSucursalInformationRequest(text) {
  const normalized = normalizeText(text);
  const asksInformation = /\b(informacion|datos|detalle|detalles|informacion general|general)\b/.test(normalized);
  const mentionsSucursal = /\b(sucursal|tienda|centro de trabajo)\b/.test(normalized) || /\b\d{3,}\b/.test(normalized);
  const asksDocument = /\b(documento|archivo|drive|lista de asistencia|dc3|bitacora|inventario)\b/.test(normalized);
  return asksInformation && mentionsSucursal && !asksDocument;
}

async function handleSucursalInformationRequest(client, jid, text, identity) {
  const normalized = normalizeText(text);
  const isGeneralFollowUp = /^(informacion general|general|datos generales|detalles generales)$/.test(normalized);
  const previous = sucursalInformationContext.get(jid) || null;
  const isSearchFollowUp = Boolean(previous?.candidates?.length);
  if (!isSucursalInformationRequest(text) && !(isGeneralFollowUp && previous?.candidate) && !isSearchFollowUp) return false;
  if (!hasSucursalDocumentAccess(identity)) {
    await client.sendMessage(jid, "No tienes permiso para consultar informacion de sucursales.");
    return true;
  }

  let candidate = null;
  if (isGeneralFollowUp) candidate = previous?.candidate || null;
  if (isSearchFollowUp) {
    const choice = Number.parseInt(normalized, 10);
    if (/^\d+$/.test(normalized) && choice >= 1 && choice <= previous.candidates.length) {
      candidate = previous.candidates[choice - 1];
    } else {
      const clarified = previous.candidates
        .map((item) => ({ ...item, score: scoreSucursalCandidate(text, item) }))
        .sort((left, right) => right.score - left.score);
      if (clarified[0]?.score >= 0.35 && (!clarified[1] || clarified[0].score - clarified[1].score >= 0.08)) {
        [candidate] = clarified;
      } else {
        const freshMatches = await findSucursalCandidates(text);
        if (freshMatches[0] && isStrongSucursalMatch(freshMatches[0], freshMatches[1])) [candidate] = freshMatches;
      }
    }
    if (!candidate) {
      await client.sendMessage(jid, `No pude identificar la opcion. Responde con el numero o nombre:\n${formatSucursalChoices(previous.candidates)}`);
      return true;
    }
  }
  if (!candidate) {
    const matches = await findSucursalCandidates(text);
    if (!matches.length) {
      await client.sendMessage(jid, "No encontre una sucursal con esa referencia. Escribe el numero de tienda o su nombre.");
      return true;
    }
    if (!isStrongSucursalMatch(matches[0], matches[1])) {
      sucursalInformationContext.set(jid, { candidates: matches });
      await client.sendMessage(jid, `Encontre varias sucursales. Indica una opcion:\n${formatSucursalChoices(matches)}`);
      return true;
    }
    [candidate] = matches;
  }

  sucursalInformationContext.set(jid, { candidate });
  aiConversationContext.delete(jid);
  const record = buildSucursalContextRecord(candidate);
  const location = uniqueDisplayParts([record.municipio, record.estado]).join(", ") || "No registrada";
  const lines = [
    `Informacion general de ${record.etiqueta}`,
    `Tienda: ${record.tienda}`,
    `Nombre: ${record.nombre}`,
    `Tipo: ${record.tipo}`,
    `Empresa: ${record.empresa}`,
    `Razon social: ${record.razonSocial}`,
    `Direccion: ${record.direccion}`,
    `Ubicacion: ${location}`,
    `Nivel de riesgo: ${record.nivelRiesgo}`,
    `Trabajos: ${record.trabajos}`,
    `Capacitadores: ${record.capacitadores}`,
    `ID Proteccion Civil: ${record.idProteccionCivil}`,
    `Planeacion: mes ${record.mesPlaneacion}; estatus ${record.estatusPlaneacion}`,
    `Vencimiento estatal: ${record.vencimientoEstatal}`,
    `Vencimiento municipal: ${record.vencimientoMunicipal}`,
    `Pedido: ${record.pedido}`,
    `Documentos: ${record.drive}`,
  ];
  await client.sendMessage(jid, lines.join("\n"));
  return true;
}

export function isNaturalDriveRequest(text) {
  const normalized = normalizeText(text);
  const mentionsDocument = /\b(documento|documentos|archivo|archivos|drive|dc3|bitacora|bitacoras|inventario|cedula|cedulas|acta|actas|fotografia|fotografias)\b/.test(normalized)
    || /\blista de asistencia\b/.test(normalized)
    || /\breporte de servicio\b/.test(normalized);
  const identifiesBranch = /\b(sucursal|tienda|drive|documento|archivo)\b/.test(normalized)
    || /\b\d{3,}\b/.test(normalized);
  return mentionsDocument && identifiesBranch;
}

export function isBulkPendingAttendanceRequest(text) {
  const normalized = normalizeText(text);
  return /\blistas? de asistencia\b/.test(normalized)
    && /\b(todas|todos|cada)\b/.test(normalized)
    && /\bconstancias?\b/.test(normalized)
    && /\b(capacitada|capacitadas|capacitado|capacitados|capacitador|capacitadora)\b/.test(normalized);
}

function extractRequestedDocumentQuery(text) {
  const normalized = normalizeText(text);
  const knownTypes = [
    "lista de asistencia",
    "acta constitutiva",
    "reporte de servicio",
    "dc3",
    "bitacora",
    "inventario",
    "cedula",
    "fotografia",
  ];
  return knownTypes.find((type) => normalized.includes(type)) || "";
}

function isDriveLinkRequest(text) {
  const normalized = normalizeText(text);
  return /\b(link|enlace|liga|url)\b/.test(normalized) && /\bdrive\b/.test(normalized);
}

function extractSucursalDocumentQuery(text) {
  return String(text || "")
    .replace(/\b(dame|envia(?:me)?|manda(?:me)?|comparte(?:me)?|necesito|quiero|busca(?:me)?|muestra(?:me)?)\b/gi, " ")
    .replace(/\b(lista\s+de\s+asistencia|acta\s+constitutiva|reporte\s+de\s+servicio)\b/gi, " ")
    .replace(/\b(los|las|la|el|un|una|del|de|en|para|por|favor)\b/gi, " ")
    .replace(/\b(dc3|bitacoras?|inventarios?|cedulas?|fotografias?)\b/gi, " ")
    .replace(/\b(documentos?|archivos?|drive|carpeta|sucursal|tienda)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function driveFolderLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    const structured = String(parsed?.Url || parsed?.url || "").trim();
    if (structured) return structured;
  } catch {
    // Plain Drive URLs and folder IDs are expected here too.
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  const folderId = extractDriveId(raw);
  return folderId ? `https://drive.google.com/drive/folders/${folderId}` : "";
}

async function sendSucursalDriveLink(client, jid, candidate) {
  const link = driveFolderLink(candidate?.drive);
  if (!link) {
    await client.sendMessage(jid, `La sucursal ${buildSucursalDisplay(candidate)} no tiene una carpeta de Drive configurada.`);
    return;
  }
  await client.sendMessage(jid, `Documentos de ${buildSucursalDisplay(candidate)}:\n${link}`);
}

async function listSucursalDriveDocuments(folderId, limit = 500) {
  const drive = await getDriveClient();
  const queue = [{ id: folderId, path: "" }];
  const files = [];
  const visited = new Set();
  while (queue.length && files.length < limit) {
    const folder = queue.shift();
    if (!folder?.id || visited.has(folder.id)) continue;
    visited.add(folder.id);
    let pageToken = undefined;
    do {
      const response = await drive.files.list({
        q: `'${folder.id.replace(/'/g, "\\'")}' in parents and trashed=false`,
        fields: "nextPageToken,files(id,name,mimeType,size,webViewLink)",
        pageSize: 100,
        pageToken,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      });
      for (const item of response.data.files || []) {
        const itemPath = [folder.path, item.name].filter(Boolean).join(" / ");
        if (item.mimeType === "application/vnd.google-apps.folder") {
          if (queue.length + visited.size < 200) queue.push({ id: item.id, path: itemPath });
        } else {
          files.push({ ...item, path: itemPath });
          if (files.length >= limit) break;
        }
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && files.length < limit);
  }
  return files;
}

function findSimilarDriveFiles(files, query, limit = 10) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length >= 3);
  return files
    .map((file) => {
      const haystack = normalizeText(file.path || file.name);
      const tokenHits = queryTokens.filter((token) => haystack.includes(token)).length;
      const tokenScore = queryTokens.length ? tokenHits / queryTokens.length : 0;
      return { file, score: Math.max(tokenScore, stringSimilarity(normalizedQuery, haystack)) };
    })
    .filter((item) => item.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.file);
}

async function presentDriveFileChoices(client, jid, candidate, files, documentQuery = "") {
  driveLookupContext.set(jid, { step: "file", candidate, files, documentQuery });
  const choices = files.slice(0, 20).map((file, index) => `${index + 1}. ${file.path || file.name}`).join("\n");
  await client.sendMessage(jid, `Documentos de ${buildSucursalDisplay(candidate)}:\n${choices}\n\nResponde con el numero del archivo o TODOS para recibir hasta 5 documentos.`);
}

async function presentSucursalDriveDocuments(client, jid, candidate, documentQuery = "") {
  const folderId = extractDriveId(candidate?.drive);
  if (!folderId) {
    await sendSucursalDriveLink(client, jid, candidate);
    return;
  }
  try {
    const allFiles = await listSucursalDriveDocuments(folderId);
    const queryTokens = normalizeText(documentQuery).split(" ").filter((token) => token.length >= 3);
    const files = queryTokens.length
      ? allFiles.filter((file) => {
          const haystack = normalizeText(file.path || file.name);
          return queryTokens.every((token) => haystack.includes(token));
        })
      : allFiles;
    if (!files.length) {
      if (documentQuery && allFiles.length) {
        driveLookupContext.set(jid, { step: "search", candidate, files: allFiles, documentQuery });
      }
      const similarHint = documentQuery && allFiles.length ? " Puedes responder BUSCA COINCIDENCIAS SIMILARES." : "";
      const detail = documentQuery ? ` que coincidan exactamente con "${documentQuery}"` : "";
      await client.sendMessage(jid, `No encontre archivos${detail} dentro de ${buildSucursalDisplay(candidate)}.${similarHint}\n${driveFolderLink(candidate.drive)}`);
      return;
    }
    if (files.length === 1 && documentQuery) {
      await sendSelectedDriveDocuments(client, jid, files);
      return;
    }
    await presentDriveFileChoices(client, jid, candidate, files, documentQuery);
  } catch (error) {
    getLogger().error({ error: error?.message || String(error), jid }, "drive document listing failed");
    await sendSucursalDriveLink(client, jid, candidate);
  }
}

async function downloadDriveDocument(file) {
  const drive = await getDriveClient();
  let mimeType = String(file.mimeType || "application/octet-stream");
  let fileName = String(file.name || "documento");
  let response;
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    mimeType = "application/pdf";
    if (!fileName.toLowerCase().endsWith(".pdf")) fileName += ".pdf";
    response = await drive.files.export({ fileId: file.id, mimeType }, { responseType: "arraybuffer" });
  } else {
    response = await drive.files.get({ fileId: file.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  }
  const buffer = Buffer.from(response.data);
  if (buffer.length > 15 * 1024 * 1024) throw new Error("El archivo supera el limite de 15 MB para WhatsApp.");
  return new MessageMedia(mimeType, buffer.toString("base64"), fileName);
}

async function sendSelectedDriveDocuments(client, jid, files) {
  for (const file of files) {
    try {
      const media = await downloadDriveDocument(file);
      await client.sendMessage(jid, media, { caption: file.path || file.name, sendMediaAsDocument: true });
    } catch (error) {
      console.error(`[whatsapp] No pude enviar ${file.name}:`, error);
      await client.sendMessage(jid, `No pude enviar ${file.name}. Intenta de nuevo en unos minutos.`);
    }
  }
}

async function handleBulkPendingAttendanceRequest(client, jid, text, identity) {
  if (!isBulkPendingAttendanceRequest(text)) return false;
  const constanciasPermission = identity?.accessProfile?.views?.["constancias-faltantes"];
  if (!constanciasPermission?.actions?.includes("view") || !hasSucursalDocumentAccess(identity)) {
    await client.sendMessage(jid, "No tienes permiso para consultar constancias y documentos de sucursales.");
    return true;
  }

  const config = ensureRuntimeConfig();
  const [rows, employees, sucursales] = await Promise.all([
    loadCapacitacionesRows(),
    loadEmployeesCache(),
    loadSucursalesCache(),
  ]);
  const mentionedIds = findMentionedEmployeeIds(text, employees.nameByKey);
  if (!mentionedIds.length) {
    await client.sendMessage(jid, "No encontre al capacitador mencionado.");
    return true;
  }

  const employeeId = String(identity?.id || "");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pendingRows = rows.filter((row) => {
    const assignedIds = new Set(splitEnumList(row[config.capacitacionesCapacitadoresCol]).map(String));
    const isAuthorized = identity?.role === "admin" || assignedIds.has(employeeId);
    const isTarget = mentionedIds.some((id) => assignedIds.has(id));
    const date = parseBusinessDate(row[config.capacitacionesDateCol]);
    return isAuthorized && isTarget && !Number.isNaN(date.getTime()) && date < today && !readBooleanValue(row.DIPLOMAS);
  });

  const sucursalIds = [...new Set(pendingRows.flatMap((row) => (
    splitEnumList(row[config.capacitacionesSucursalesCol]).map(String)
  )))];
  const sucursalesById = new Map(sucursales.rows.map((row) => [String(row.key), row]));
  const targetNames = mentionedIds.map((id) => employees.nameByKey.get(id)).filter(Boolean).join(", ");
  await client.sendMessage(jid, `Buscando listas de asistencia de ${sucursalIds.length} sucursales con constancias pendientes de ${targetNames || "el capacitador"}.`);

  const foundFiles = [];
  const missing = [];
  const seenFileIds = new Set();
  for (const sucursalId of sucursalIds) {
    const sucursal = sucursalesById.get(sucursalId);
    const folderId = extractDriveId(sucursal?.drive);
    if (!sucursal || !folderId) {
      missing.push(sucursal ? buildSucursalDisplay(sucursal) : `Sucursal sin etiqueta (${sucursalId})`);
      continue;
    }
    try {
      const files = await listSucursalDriveDocuments(folderId);
      const matches = files.filter((file) => {
        const name = normalizeText(file.path || file.name);
        return name.includes("lista") && name.includes("asistencia");
      });
      if (!matches.length) {
        missing.push(buildSucursalDisplay(sucursal));
        continue;
      }
      for (const file of matches) {
        if (seenFileIds.has(file.id)) continue;
        seenFileIds.add(file.id);
        foundFiles.push({ ...file, path: `${buildSucursalDisplay(sucursal)} / ${file.path || file.name}` });
      }
    } catch (error) {
      getLogger().error({ error: error?.message || String(error), sucursalId }, "bulk attendance Drive search failed");
      missing.push(buildSucursalDisplay(sucursal));
    }
  }

  aiConversationContext.delete(jid);
  if (!foundFiles.length) {
    await client.sendMessage(jid, `No encontre listas de asistencia en las ${sucursalIds.length} sucursales pendientes de ${targetNames}.`);
    return true;
  }
  await client.sendMessage(jid, `Encontre ${foundFiles.length} lista(s) de asistencia. Las enviare a continuacion.`);
  await sendSelectedDriveDocuments(client, jid, foundFiles);
  if (missing.length) {
    await client.sendMessage(jid, `Sin lista de asistencia localizada (${missing.length}):\n${missing.map((name) => `- ${name}`).join("\n")}`.slice(0, 12000));
  }
  return true;
}

async function handleNaturalDriveRequest(client, jid, text, identity) {
  if (!isNaturalDriveRequest(text)) return false;
  if (!hasSucursalDocumentAccess(identity)) {
    await client.sendMessage(jid, "No tienes permiso para consultar documentos de sucursales.");
    return true;
  }
  const query = extractSucursalDocumentQuery(text);
  const documentQuery = extractRequestedDocumentQuery(text);
  if (!query) {
    await client.sendMessage(jid, "Indica el nombre o numero de la sucursal cuyos documentos necesitas.");
    return true;
  }
  const candidates = await findSucursalCandidates(query);
  if (!candidates.length) {
    await client.sendMessage(jid, "No encontre una sucursal con esa referencia. Escribe el nombre comercial o numero de tienda.");
    return true;
  }
  if (candidates.length === 1 || isStrongSucursalMatch(candidates[0], candidates[1])) {
    if (isDriveLinkRequest(text)) {
      await sendSucursalDriveLink(client, jid, candidates[0]);
      return true;
    }
    await presentSucursalDriveDocuments(client, jid, candidates[0], documentQuery);
    return true;
  }
  driveLookupContext.set(jid, { step: "branch", candidates: candidates.slice(0, 3), documentQuery });
  await client.sendMessage(jid, `Encontre varias sucursales. Responde 1, 2 o 3:\n${formatSucursalChoices(candidates)}`);
  return true;
}

async function handleDriveLookupChoice(client, jid, text) {
  const context = driveLookupContext.get(jid);
  if (!context) return false;
  const normalized = normalizeText(text);
  if (context.step === "search") {
    const requested = extractRequestedDocumentQuery(text) || context.documentQuery;
    const wantsSimilar = /\b(similar|similares|parecido|parecidos|coincidencia|coincidencias)\b/.test(normalized)
      || /\barchivos? con (el )?texto\b/.test(normalized);
    if (!wantsSimilar) return false;
    const similar = findSimilarDriveFiles(context.files, requested);
    if (!similar.length) {
      await client.sendMessage(jid, `No encontre nombres similares a "${requested}" en esa sucursal.`);
      return true;
    }
    await presentDriveFileChoices(client, jid, context.candidate, similar, requested);
    return true;
  }
  if (context.step === "file" && normalized === "TODOS") {
    driveLookupContext.delete(jid);
    await sendSelectedDriveDocuments(client, jid, context.files.slice(0, 5));
    return true;
  }
  const selection = Number(String(text || "").trim());
  const options = context.step === "file" ? context.files : context.candidates;
  if (!Number.isInteger(selection) || selection < 1 || selection > options.length) return false;
  driveLookupContext.delete(jid);
  if (context.step === "file") {
    await sendSelectedDriveDocuments(client, jid, [context.files[selection - 1]]);
  } else {
    await presentSucursalDriveDocuments(client, jid, context.candidates[selection - 1], context.documentQuery || "");
  }
  return true;
}

function getArchivoContext(jid) {
  return archivoContext.get(jid) || null;
}

function isArchivoFlowActive(jid) {
  const context = getArchivoContext(jid);
  if (!context) return false;
  return ["query", "choose", "confirm", "collect", "retry"].includes(context.step);
}

async function cancelArchivoFlow(jid, client, message = "Proceso cancelado.") {
  const context = getArchivoContext(jid);
  if (!context) return false;
  await clearFlowFiles(context);
  archivoContext.delete(jid);
  await client.sendMessage(jid, message);
  return true;
}

async function failArchivoFlow(jid, client, message) {
  await cancelArchivoFlow(jid, client, message);
  return true;
}

async function handleArchivoSearch(jid, client, text) {
  const context = getArchivoContext(jid);
  if (!context || context.step !== "query") return false;

  const query = String(text || "").trim();
  if (!query) {
    await client.sendMessage(jid, "Escribe la tienda, nombre comercial o razon social.");
    return true;
  }

  context.query = query;
  const candidates = await findSucursalCandidates(query);

  if (!candidates.length) {
    await client.sendMessage(
      jid,
      "No encontré coincidencias claras. Escribe otra referencia de la sucursal o una parte más específica."
    );
    return true;
  }

  const best = candidates[0];
  const second = candidates[1] || null;
  const strongMatch = isStrongSucursalMatch(best, second);

  if (candidates.length === 1 || strongMatch) {
    context.selectedCandidate = best;
    context.storeKey = best.key || null;
    context.storeLabel = best.name || best.label || best.tienda || best.key || "";
    context.storeDrive = best.drive || "";
    if (!context.storeDrive) {
      return failArchivoFlow(
        jid,
        client,
        `La sucursal ${buildSucursalDisplay(best)} no tiene Drive configurado. Termino el proceso.`
      );
    }
    context.step = "confirm";
    context.matches = [];
    await client.sendMessage(jid, `Encontré: ${buildSucursalDisplay(best)}. ¿Confirmas? (SI/NO)`);
    return true;
  }

  context.matches = candidates.slice(0, 3);
  context.step = "choose";
  await client.sendMessage(
    jid,
    `Encontré varias coincidencias. Responde 1, 2 o 3:\n${formatSucursalChoices(context.matches)}`
  );
  await client.sendMessage(jid, "4. Buscar otra tienda");
  return true;
}

async function handleArchivoChoice(jid, client, text) {
  const context = getArchivoContext(jid);
  if (!context || context.step !== "choose") return false;

  const normalized = normalizeText(text);
  if (normalized === "cancelar") return false;

  const index = Number(normalized);
  if (!Number.isInteger(index)) {
    context.step = "query";
    return handleArchivoSearch(jid, client, text);
  }

  if (index === 4) {
    context.step = "query";
    context.matches = [];
    context.selectedCandidate = null;
    context.storeKey = null;
    context.storeLabel = null;
    context.storeDrive = null;
    await client.sendMessage(jid, "Escribe la tienda, nombre comercial o razon social para buscar otra sucursal.");
    return true;
  }

  if (index < 1 || index > (context.matches || []).length) {
    await client.sendMessage(jid, "Responde con 1, 2 o 3, o 4 para buscar otra tienda.");
    return true;
  }

  const selected = context.matches[index - 1];
  if (!selected) {
    context.step = "query";
    await client.sendMessage(jid, "No pude entender la selección. Intenta de nuevo.");
    return true;
  }

  context.selectedCandidate = selected;
  context.storeKey = selected.key || null;
  context.storeLabel = selected.name || selected.label || selected.tienda || selected.key || "";
  context.storeDrive = selected.drive || "";
  if (!context.storeDrive) {
    return failArchivoFlow(
      jid,
      client,
      `La sucursal ${buildSucursalDisplay(selected)} no tiene Drive configurado. Termino el proceso.`
    );
  }
  context.step = "confirm";
  context.matches = [];
  await client.sendMessage(jid, `Seleccionaste: ${buildSucursalDisplay(selected)}. ¿Confirmas? (SI/NO)`);
  return true;
}

async function handleArchivoConfirm(jid, client, text) {
  const context = getArchivoContext(jid);
  if (!context || context.step !== "confirm") return false;

  const normalized = normalizeText(text);
  if (normalized === "si" || normalized === "sí") {
    context.step = "collect";
    await client.sendMessage(
      jid,
      `OK. Envia el archivo y escribe "LISTO" al terminar.\nSi quieres cancelar, escribe "CANCELAR".`
    );
    return true;
  }

  if (normalized === "no") {
    context.step = "query";
    context.selectedCandidate = null;
    context.storeKey = null;
    context.storeLabel = null;
    context.storeDrive = null;
    context.matches = [];
    await client.sendMessage(
      jid,
      "Escribe otra referencia de la sucursal. Puedes usar tienda, nombre comercial o razon social."
    );
    return true;
  }

  await client.sendMessage(jid, "Responde SI o NO.");
  return true;
}

async function resolveStore(map, jid, client, text) {
  const context = map.get(jid);
  if (!context || context.step !== "store") return false;

  const tienda = String(text || "").trim();
  if (!tienda) {
    await client.sendMessage(jid, "Numero de tienda invalido.");
    return true;
  }

  const sucursales = await loadSucursalesCache();
  const key = sucursales.keyByTienda.get(tienda);
  if (!key) {
    await client.sendMessage(jid, "Tienda no encontrada. Intenta de nuevo.");
    return true;
  }

  context.storeKey = key;
  context.storeLabel = sucursales.nameByKey.get(key) || key;
  context.storeDrive = sucursales.driveByKey.get(key) || "";
  context.step = "confirm";
  await client.sendMessage(jid, `Confirmas la sucursal: ${context.storeLabel}? (SI/NO)`);
  return true;
}

async function resolveFlowConfirmation(map, jid, client, text, collectMessage) {
  const context = map.get(jid);
  if (!context || context.step !== "confirm") return false;

  const normalized = normalizeText(text);
  if (normalized === "si" || normalized === "sí") {
    context.step = "collect";
    await client.sendMessage(jid, collectMessage);
    return true;
  }

  if (normalized === "no") {
    context.step = "store";
    context.storeKey = null;
    context.storeLabel = null;
    context.storeDrive = null;
    await client.sendMessage(jid, "Escribe el numero de tienda.");
    return true;
  }

  await client.sendMessage(jid, "Responde SI o NO.");
  return true;
}

function serializeError(error) {
  if (!error) return "";
  if (error instanceof Error) return error.message || error.name || String(error);
  return String(error);
}

function getSerializedWid(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value._serialized) return value._serialized;
  if (value.user && value.server) return `${value.user}@${value.server}`;
  return "";
}

function ensureMessageSerializedId(msg) {
  const id = msg?.id || msg?._data?.id;
  if (!id) return "";
  if (typeof id === "string") return id;
  if (id._serialized) return id._serialized;

  const remote = getSerializedWid(id.remote) || msg.from || getSerializedWid(msg?._data?.from);
  const messageId = id.id || msg?._data?.id?.id || "";
  if (!remote || !messageId) return "";

  const serialized = `${Boolean(id.fromMe)}_${remote}_${messageId}`;
  id._serialized = serialized;
  if (msg.id && typeof msg.id === "object") msg.id._serialized = serialized;
  if (msg._data?.id && typeof msg._data.id === "object") msg._data.id._serialized = serialized;
  return serialized;
}

async function getMediaDebugInfo(msg) {
  const page = runtime.client?.pupPage;
  const msgId = ensureMessageSerializedId(msg);
  if (!page || !msgId) return { hasPage: Boolean(page), hasMessageId: Boolean(msgId) };

  try {
    return await page.evaluate(async (messageId) => {
      const messages = typeof window.require === "function"
        ? window.require("WAWebCollections")?.Msg
        : window.Store?.Msg;
      if (!messages) return { found: false, error: "message_collection_unavailable" };
      const target = messages.get(messageId) || (await messages.getMessagesById([messageId]))?.messages?.[0];
      if (!target) return { found: false };

      return {
        found: true,
        type: target.type || "",
        mimetype: target.mimetype || target.mediaData?.mimetype || "",
        filename: target.filename || "",
        size: target.size || target.mediaData?.size || 0,
        mediaStage: target.mediaData?.mediaStage || "",
        hasDirectPath: Boolean(target.directPath),
        hasMediaKey: Boolean(target.mediaKey),
        hasEncFilehash: Boolean(target.encFilehash),
        hasFilehash: Boolean(target.filehash),
        isViewOnce: Boolean(target.isViewOnce),
        isGif: Boolean(target.isGif),
      };
    }, msgId);
  } catch (error) {
    return { diagnosticError: serializeError(error) };
  }
}

async function downloadMediaFallback(msg) {
  const page = runtime.client?.pupPage;
  const msgId = ensureMessageSerializedId(msg);
  if (!page || !msgId) return null;

  const result = await page.evaluate(async (messageId) => {
    const messages = typeof window.require === "function"
      ? window.require("WAWebCollections")?.Msg
      : window.Store?.Msg;
    if (!messages) {
      return { ok: false, error: "message_collection_unavailable" };
    }
    const target = messages.get(messageId) || (await messages.getMessagesById([messageId]))?.messages?.[0];
    if (!target || !target.mediaData) {
      return { ok: false, error: "message_or_media_not_found" };
    }

    const errors = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        if (target.mediaData.mediaStage !== "RESOLVED") {
          await target.downloadMedia({
            downloadEvenIfExpensive: true,
            rmrReason: 1,
          });
        }

        if (target.mediaData.mediaStage === "REUPLOADING" || target.mediaData.mediaStage === "FETCHING") {
          await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
          continue;
        }

        if (target.mediaData.mediaStage?.includes?.("ERROR")) {
          errors.push(`media_stage_${target.mediaData.mediaStage}`);
          continue;
        }

        const mockQpl = {
          addAnnotations() {
            return this;
          },
          addPoint() {
            return this;
          },
        };
        const downloadManager = typeof window.require === "function"
          ? window.require("WAWebDownloadManager")?.downloadManager
          : window.Store?.DownloadManager;
        if (!downloadManager?.downloadAndMaybeDecrypt) {
          throw new Error("download_manager_unavailable");
        }
        const decryptedMedia = await downloadManager.downloadAndMaybeDecrypt({
          directPath: target.directPath,
          encFilehash: target.encFilehash,
          filehash: target.filehash,
          mediaKey: target.mediaKey,
          mediaKeyTimestamp: target.mediaKeyTimestamp,
          type: target.type,
          signal: new AbortController().signal,
          downloadQpl: mockQpl,
        });
        const data = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);
        return {
          ok: true,
          data,
          mimetype: target.mimetype || target.mediaData?.mimetype || "",
          filename: target.filename || "",
          filesize: target.size || target.mediaData?.size || 0,
          mediaStage: target.mediaData?.mediaStage || "",
        };
      } catch (error) {
        errors.push(error?.message || error?.name || String(error));
        await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
      }
    }

    return {
      ok: false,
      error: errors.filter(Boolean).join(" | ") || "fallback_download_failed",
      mediaStage: target.mediaData?.mediaStage || "",
      hasDirectPath: Boolean(target.directPath),
      hasMediaKey: Boolean(target.mediaKey),
      mimetype: target.mimetype || target.mediaData?.mimetype || "",
    };
  }, msgId);

  if (result?.ok && result.data) return result;
  if (result) {
    throw new Error(JSON.stringify(result).slice(0, 500));
  }
  return null;
}

const MEDIA_KEY_INFO = Object.freeze({
  image: "WhatsApp Image Keys",
  sticker: "WhatsApp Image Keys",
  video: "WhatsApp Video Keys",
  audio: "WhatsApp Audio Keys",
  ptt: "WhatsApp Audio Keys",
  document: "WhatsApp Document Keys",
});

async function getEncryptedMediaMetadata(msg) {
  const page = runtime.client?.pupPage;
  const msgId = ensureMessageSerializedId(msg);
  if (!page || !msgId) return null;

  return page.evaluate(async (messageId) => {
    const messages = typeof window.require === "function"
      ? window.require("WAWebCollections")?.Msg
      : window.Store?.Msg;
    const target = messages?.get(messageId) || (await messages?.getMessagesById?.([messageId]))?.messages?.[0];
    if (!target?.directPath || !target?.mediaKey) return null;
    const encode = async (value) => {
      if (!value) return "";
      if (typeof value === "string") return value;
      return window.WWebJS.arrayBufferToBase64Async(value.buffer || value);
    };
    return {
      directPath: target.directPath,
      mediaKey: await encode(target.mediaKey),
      filehash: await encode(target.filehash),
      encFilehash: await encode(target.encFilehash),
      type: target.type || "",
      mimetype: target.mimetype || target.mediaData?.mimetype || "",
      filename: target.filename || "",
      filesize: target.size || target.mediaData?.size || 0,
    };
  }, msgId);
}

async function downloadMediaDirect(msg) {
  const metadata = await getEncryptedMediaMetadata(msg);
  if (!metadata?.directPath || !metadata?.mediaKey) return null;
  const keyInfo = MEDIA_KEY_INFO[metadata.type];
  if (!keyInfo) throw new Error(`unsupported_media_type_${metadata.type || "unknown"}`);

  const url = metadata.directPath.startsWith("http")
    ? metadata.directPath
    : `https://mmg.whatsapp.net${metadata.directPath}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`media_http_${response.status}`);
  const encrypted = Buffer.from(await response.arrayBuffer());
  if (encrypted.length <= 10) throw new Error("encrypted_media_empty");

  const expanded = Buffer.from(hkdfSync("sha256", Buffer.from(metadata.mediaKey, "base64"), Buffer.alloc(0), keyInfo, 112));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);
  const ciphertext = encrypted.subarray(0, -10);
  const receivedMac = encrypted.subarray(-10);
  const expectedMac = createHmac("sha256", macKey).update(Buffer.concat([iv, ciphertext])).digest().subarray(0, 10);
  if (!timingSafeEqual(receivedMac, expectedMac)) throw new Error("encrypted_media_mac_mismatch");

  const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (metadata.filehash) {
    const expectedHash = Buffer.from(metadata.filehash, "base64");
    const actualHash = createHash("sha256").update(decrypted).digest();
    if (expectedHash.length === actualHash.length && !timingSafeEqual(expectedHash, actualHash)) {
      throw new Error("decrypted_media_hash_mismatch");
    }
  }
  return {
    data: decrypted.toString("base64"),
    mimetype: metadata.mimetype || "application/octet-stream",
    filename: metadata.filename || "",
    filesize: metadata.filesize || decrypted.length,
  };
}

async function downloadMessageMediaNow(msg, logger) {
  let media = null;
  let lastError = null;
  const messageId = ensureMessageSerializedId(msg);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      media = await msg.downloadMedia();
      if (media?.data) return { media, lastError: null };
    } catch (error) {
      lastError = error;
      logger.warn(
        {
          attempt,
          messageId,
          type: msg.type,
          hasMedia: msg.hasMedia,
          mimetype: msg._data?.mimetype || msg.mimetype || "",
          mediaStage: msg._data?.mediaData?.mediaStage || "",
          error: serializeError(error),
        },
        "media download attempt failed"
      );
    }

    try {
      media = await downloadMediaDirect(msg);
      if (media?.data) {
        logger.info({ attempt, messageId }, "media downloaded and decrypted directly");
        return { media, lastError: null };
      }
    } catch (error) {
      lastError = error;
      logger.warn({ attempt, messageId, error: serializeError(error) }, "direct media download failed");
    }

    try {
      media = await downloadMediaFallback(msg);
      if (media?.data) {
        logger.info({ attempt, messageId }, "media downloaded through fallback");
        return { media, lastError: null };
      }
    } catch (error) {
      lastError = error;
      logger.warn({ attempt, messageId, error: serializeError(error) }, "media fallback download failed");
    }

    await wait(900 * attempt);
  }

  const diagnostic = await getMediaDebugInfo(msg);
  logger.warn({ diagnostic, lastError: serializeError(lastError) }, "media download diagnostic");
  return { media: null, lastError };
}

let mediaDownloadQueue = Promise.resolve();

function downloadMessageMedia(msg, logger) {
  const queued = mediaDownloadQueue.then(
    () => downloadMessageMediaNow(msg, logger),
    () => downloadMessageMediaNow(msg, logger)
  );
  mediaDownloadQueue = queued.catch(() => undefined);
  return queued;
}

async function saveIncomingMedia(msg, context, options = {}) {
  if (!msg.hasMedia) return false;
  const logger = getLogger();
  context.pendingDownloads = (context.pendingDownloads || 0) + 1;
  let media = null;
  let lastError = null;
  try {
    const result = await downloadMessageMedia(msg, logger);
    media = result.media;
    lastError = result.lastError;
  } finally {
    context.pendingDownloads = Math.max(0, (context.pendingDownloads || 1) - 1);
  }

  if (!media?.data) {
    context.failedDownloads = (context.failedDownloads || 0) + 1;
    try {
      await msg.reply(
        "Recibi el adjunto, pero WhatsApp no me dejo descargarlo. Reenvialo y espera mi confirmacion antes de escribir LISTO."
      );
    } catch (replyError) {
      logger.warn({ replyError }, "failed to notify media download failure");
    }
    if (lastError) {
      logger.warn({ lastError: serializeError(lastError) }, "media download failed after retries");
    }
    return false;
  }

  const tmpDir = await ensureTmpDir();
  const extension = mime.extension(media.mimetype || "") || "jpg";
  const prefix = options.prefix || "img_";
  const filename = `${prefix}${Date.now()}.${extension}`;
  const localPath = path.join(tmpDir, filename);
  await fs.promises.writeFile(localPath, Buffer.from(media.data, "base64"));
  context.files.push(localPath);
  context.failedDownloads = 0;
  try {
    await msg.reply(`Archivo recibido: ${path.basename(localPath)}`);
  } catch (replyError) {
    logger.warn({ replyError }, "failed to confirm media download");
  }
  return true;
}

function clearFlowFiles(context) {
  return Promise.all(
    (context.files || []).map(async (filePath) => {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // ignore
      }
    })
  );
}

async function finalizeFlow(map, jid, client, options) {
  const config = ensureRuntimeConfig();
  const logger = getLogger();
  const context = map.get(jid);
  if (!context || context.step !== "collect") return false;
  const shouldNotify = options.notify !== false;

  if (context.uploading) {
    await client.sendMessage(jid, options.waitMessage);
    return true;
  }

  if (Number(context.pendingDownloads || 0) > 0) {
    await client.sendMessage(
      jid,
      `Estoy descargando ${context.pendingDownloads} adjunto(s). Espera mi confirmacion de "Archivo recibido" antes de escribir LISTO.`
    );
    return true;
  }

  if (!context.files.length) {
    const failedDownloads = Number(context.failedDownloads || 0);
    await client.sendMessage(
      jid,
      failedDownloads > 0
        ? `No tengo archivos guardados. Detecte ${failedDownloads} adjunto(s), pero WhatsApp no me dejo descargarlos. Reenvialos y espera mi confirmacion antes de escribir LISTO.`
        : options.emptyMessage
    );
    return true;
  }

  let drive = null;
  try {
    drive = await getDriveClient();
  } catch (error) {
    logger.error(error, "Drive client error");
  }

  if (!drive) {
    await client.sendMessage(jid, "No hay credenciales de Drive configuradas.");
    return true;
  }

  const dateSafe = new Date().toISOString().slice(0, 10);
  const storeSafe = String(context.storeLabel || "").replace(/[^\w.\-]/g, "_");
  const parentFolderId = extractDriveId(context.storeDrive || "");
  const folderName = options.buildFolderName(context.storeLabel || "");

  let folder = null;
  try {
    folder = await ensureFolder(drive, folderName, parentFolderId);
  } catch (error) {
    logger.error(error, "ensure folder error");
    await client.sendMessage(jid, "No pude crear la carpeta en Drive. Revisa permisos.");
    return true;
  }

  context.uploading = true;
  const total = context.files.length;
  let uploaded = 0;
  const failed = [];

  for (const filePath of context.files) {
    if (!fs.existsSync(filePath)) {
      failed.push(filePath);
      continue;
    }

    const baseName = path.basename(filePath);
    const filename = options.buildFilename({ dateSafe, storeSafe, baseName });

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await uploadToDrive(drive, filePath, filename, folder.id);
        uploaded += 1;
        success = true;
        break;
      } catch (error) {
        logger.error({ attempt, filePath }, "Upload error");
      }
    }

    if (success) {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // ignore
      }
      continue;
    }

    failed.push(filePath);
  }

  context.files = [];
  context.uploading = false;
  context.targetFolderId = folder.id;
  context.targetFolderName = folderName;
  context.targetFolderLink = folder.webViewLink || "";

  if (failed.length) {
    context.failedFiles = failed;
    context.step = "retry";
    const names = failed.map((filePath) => path.basename(filePath)).slice(0, 10).join(", ");
    const extra = failed.length > 10 ? `, y ${failed.length - 10} mas` : "";
    await client.sendMessage(
      jid,
      `Listo. Subidas: ${uploaded}/${total}. Fallidas: ${failed.length}. ${names}${extra}\n` +
        `Puedes escribir "${config.keywordReintentar}" para reintentar las fallidas.`
    );
  } else {
    map.delete(jid);
    await client.sendMessage(jid, `Listo. Subidas: ${uploaded}/${total}`);
  }

  if (shouldNotify && config.notifyNumber) {
    const message = config.notifyMessage
      .replace("{SUCURSAL}", String(context.storeLabel || ""))
      .replace("{CARPETA}", folderName)
      .replace("{LINK}", folder.webViewLink || "")
      .replace("{TOTAL}", String(uploaded));
    try {
      await client.sendMessage(`${config.notifyNumber}@c.us`, message);
    } catch (error) {
      logger.error(error, "notify error");
    }
  }

  return true;
}

async function retryFailedUploads(jid, client) {
  const logger = getLogger();
  const contexts = [uploadContext, storePhotosContext, archivoContext];
  const contextMap = contexts.find((map) => {
    const flow = map.get(jid);
    return flow && flow.step === "retry" && flow.failedFiles?.length;
  });
  if (!contextMap) return false;

  const context = contextMap.get(jid);
  if (context.retrying) return true;

  context.retrying = true;
  let drive = null;
  try {
    drive = await getDriveClient();
  } catch (error) {
    logger.error(error, "Drive client error");
  }

  if (!drive) {
    context.retrying = false;
    await client.sendMessage(jid, "No hay credenciales de Drive configuradas.");
    return true;
  }

  const total = context.failedFiles.length;
  let uploaded = 0;
  const failed = [];

  for (const filePath of context.failedFiles) {
    if (!fs.existsSync(filePath)) {
      failed.push(filePath);
      continue;
    }

    const filename = `${new Date().toISOString().slice(0, 10)}_${path.basename(filePath)}`.replace(/[^\w.\-]/g, "_");
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await uploadToDrive(drive, filePath, filename, context.targetFolderId || "");
        uploaded += 1;
        success = true;
        break;
      } catch (error) {
        logger.error({ attempt, filePath }, "Retry upload error");
      }
    }

    if (success) {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // ignore
      }
      continue;
    }

    failed.push(filePath);
  }

  context.retrying = false;
  context.failedFiles = failed;
  if (failed.length) {
    const names = failed.map((filePath) => path.basename(filePath)).slice(0, 10).join(", ");
    const extra = failed.length > 10 ? `, y ${failed.length - 10} mas` : "";
    await client.sendMessage(
      jid,
      `Reintento finalizado. Subidas: ${uploaded}/${total}. Fallidas: ${failed.length}. ${names}${extra}`
    );
  } else {
    contextMap.delete(jid);
    await client.sendMessage(jid, `Reintento finalizado. Subidas: ${uploaded}/${total}`);
  }

  return true;
}

async function handleImage(msg) {
  const config = ensureRuntimeConfig();
  const logger = getLogger();

  if (!config.saveMedia) {
    await msg.reply("Imagen recibida, pero guardar esta desactivado.");
    return;
  }

  if (!msg.hasMedia) {
    await msg.reply("No se pudo leer la imagen.");
    return;
  }

  const { media } = await downloadMessageMedia(msg, logger);
  if (!media?.data) {
    await msg.reply("No se pudo descargar la imagen.");
    return;
  }

  const tmpDir = await ensureTmpDir();
  const extension = mime.extension(media.mimetype || "") || "jpg";
  const filename = `img_${Date.now()}.${extension}`;
  const localPath = path.join(tmpDir, filename);
  await fs.promises.writeFile(localPath, Buffer.from(media.data, "base64"));

  let drive = null;
  try {
    drive = await getDriveClient();
  } catch (error) {
    logger.error(error, "Drive client error");
  }

  if (!drive) {
    await msg.reply("No hay credenciales de Drive configuradas.");
    return;
  }

  try {
    const result = await uploadToDrive(drive, localPath, filename);
    await msg.reply(`Imagen guardada en Drive. ID: ${result.id}`);
  } catch (error) {
    logger.error(error, "Upload error");
    await msg.reply("Error subiendo la imagen a Drive.");
  } finally {
    try {
      await fs.promises.unlink(localPath);
    } catch {
      // ignore
    }
  }
}

async function cancelFlow(jid, client) {
  for (const map of [uploadContext, storePhotosContext, archivoContext]) {
    const context = map.get(jid);
    if (!context) continue;
    await clearFlowFiles(context);
    map.delete(jid);
    await client.sendMessage(jid, "Proceso cancelado.");
    return true;
  }
  return false;
}

export function extractBotPrompt(text) {
  const raw = String(text || "");
  const match = raw.match(/^\s*bot(?:\s*[:,-]\s*|\s+|$)(.*)$/i);
  if (!match) return null;
  return String(match[1] || "").trim();
}

async function handleText(client, jid, text, identity = null) {
  const config = ensureRuntimeConfig();
  const normalized = normalizeText(text);
  const botPrompt = extractBotPrompt(text);

  if (!normalized || normalized === "hola" || normalized === "hi" || normalized === "buenas") {
    await client.sendMessage(jid, `Hola. Soy ${config.botName}. Escribe "ayuda" para ver opciones.`);
    return;
  }

  if (normalized === "ayuda") {
    await client.sendMessage(
      jid,
      `Comandos:\n` +
        `- ayuda\n` +
        `- ${config.keywordCapacitaciones}\n` +
        `- ${config.keywordSubirImagenes}\n` +
        `- ${config.keywordArchivo}\n` +
        `- ${config.keywordArchivos}\n` +
        `- ${config.keywordReintentar}\n` +
        `- bot <pregunta para el asistente>`
    );
    return;
  }

  if (await handleDriveLookupChoice(client, jid, text)) return;
  if (botPrompt !== null) {
    if (!botPrompt) {
      await client.sendMessage(jid, "Escribe tu consulta despues de bot. Ejemplo: bot dame los estatus de proteccion civil.");
      return;
    }
    if (await handleVerifiedTrainingStatusRequest(client, jid, botPrompt, identity)) return;
    if (await handleVerifiedOperationalRequest(client, jid, botPrompt, identity)) return;
    if (await handleCreatedSistemaPcRequest(client, jid, botPrompt, identity)) return;
    if (await handlePendingSistemaPcRequest(client, jid, botPrompt, identity)) return;
    if (await handleBulkPendingAttendanceRequest(client, jid, botPrompt, identity)) return;
    if (await handleSucursalInformationRequest(client, jid, botPrompt, identity)) return;
    if (await handleNaturalDriveRequest(client, jid, botPrompt, identity)) return;
    if (await handlePendingConstanciasRequest(client, jid, botPrompt, identity)) return;
  }

  if (normalized === config.keywordCapacitaciones) {
    setMenuContext(jid);
    await client.sendMessage(
      jid,
      "Menu:\n" +
        "1.- Mis capacitaciones\n" +
        "2.- Proximas capacitaciones\n" +
        "3.- Subir imagenes de capacitacion\n" +
        "4.- Subir fotos de la tienda\n" +
        "5.- Subir archivo"
    );
    return;
  }

  if (
    (normalized === "1" ||
      normalized === "2" ||
      normalized === "3" ||
      normalized === "4" ||
      normalized === "5") &&
    !hasMenuContext(jid) &&
    !isArchivoFlowActive(jid)
  ) {
    await client.sendMessage(jid, `Escribe "${config.keywordCapacitaciones}" para ver el menu.`);
    return;
  }

  if (normalized === "cancelar") {
    const handled = await cancelFlow(jid, client);
    if (handled) return;
  }

  const handledArchivoSearch = await handleArchivoSearch(jid, client, text);
  if (handledArchivoSearch) return;

  const handledArchivoChoice = await handleArchivoChoice(jid, client, text);
  if (handledArchivoChoice) return;

  const handledArchivoConfirm = await handleArchivoConfirm(jid, client, text);
  if (handledArchivoConfirm) return;

  if (normalized === "listo") {
    const finalizedUpload = await finalizeFlow(uploadContext, jid, client, {
      waitMessage: "Estoy subiendo las imagenes, espera un momento.",
      emptyMessage: "No recibi imagenes. Envia imagenes o escribe \"CANCELAR\".",
      buildFolderName: (label) => `FOTOS CAPACITACION ${label}`.trim(),
      buildFilename: ({ dateSafe, storeSafe, baseName }) =>
        `${dateSafe}_${storeSafe}_capacitacion_${baseName}`.replace(/[^\w.\-]/g, "_"),
    });
    if (finalizedUpload) return;

    const finalizedStorePhotos = await finalizeFlow(storePhotosContext, jid, client, {
      waitMessage: "Estoy subiendo las fotos, espera un momento.",
      emptyMessage: "No recibi fotos. Envia fotos o escribe \"CANCELAR\".",
      buildFolderName: (label) => `FOTOS DE TIENDA ${label}`.trim(),
      buildFilename: ({ dateSafe, storeSafe, baseName }) =>
        `${dateSafe}_${storeSafe}_${baseName}`.replace(/[^\w.\-]/g, "_"),
    });
    if (finalizedStorePhotos) return;

    const finalizedArchivo = await finalizeFlow(archivoContext, jid, client, {
      waitMessage: "Estoy subiendo el archivo, espera un momento.",
      emptyMessage: "No recibi archivos. Envia un archivo o escribe \"CANCELAR\".",
      buildFolderName: (label) => `ARCHIVOS ${label}`.trim(),
      buildFilename: ({ dateSafe, storeSafe, baseName }) =>
        `${dateSafe}_${storeSafe}_archivo_${baseName}`.replace(/[^\w.\-]/g, "_"),
      notify: false,
    });
    if (finalizedArchivo) return;
  }

  if (normalized === config.keywordReintentar) {
    const retried = await retryFailedUploads(jid, client);
    if (retried) return;
  }

  const handledStore = await resolveStore(uploadContext, jid, client, normalized);
  if (handledStore) return;
  const handledStorePhotosStore = await resolveStore(storePhotosContext, jid, client, normalized);
  if (handledStorePhotosStore) return;
  const handledArchivoStore = await resolveStore(archivoContext, jid, client, normalized);
  if (handledArchivoStore) return;

  const handledConfirm = await resolveFlowConfirmation(
    uploadContext,
    jid,
    client,
    normalized,
    "OK. Envia las imagenes de la capacitacion y escribe \"LISTO\" al terminar.\nSi quieres cancelar, escribe \"CANCELAR\"."
  );
  if (handledConfirm) return;

  const handledStorePhotosConfirm = await resolveFlowConfirmation(
    storePhotosContext,
    jid,
    client,
    normalized,
    "OK. Envia las fotos de la tienda y escribe \"LISTO\" al terminar.\nSi quieres cancelar, escribe \"CANCELAR\"."
  );
  if (handledStorePhotosConfirm) return;

  if (normalized === "1") {
    const number = normalizePhone(jid.split("@")[0]);
    const employees = await loadEmployeesCache();
    const keys = employees.phoneToEmployeeKeys.get(number) || [];
    if (!keys.length) {
      await client.sendMessage(jid, "No encontramos empleado para tu numero.");
      return;
    }

    const keySet = new Set(keys.map((key) => String(key)));
    const rows = await loadCapacitacionesRows();
    const filteredRows = rows.filter((row) => {
      const values = splitEnumList(row[config.capacitacionesCapacitadoresCol]).map((item) => String(item));
      return values.some((item) => keySet.has(item));
    });
    if (!filteredRows?.length) {
      await client.sendMessage(jid, "Sin capacitaciones asignadas.");
      return;
    }

    const ordered = sortByDate(await resolveNames(filteredRows));
    const today = new Date();
    const finalizadas = ordered.filter((row) => parseBusinessDate(row[config.capacitacionesDateCol]) < today);
    const programadas = ordered.filter((row) => parseBusinessDate(row[config.capacitacionesDateCol]) >= today);

    const blocks = [];
    if (finalizadas.length) {
      blocks.push("FINALIZADAS");
      blocks.push(formatCapacitaciones(finalizadas));
    }
    if (programadas.length) {
      if (blocks.length) blocks.push("");
      blocks.push("PROGRAMADAS");
      blocks.push(formatCapacitaciones(programadas));
    }

    await client.sendMessage(jid, blocks.join("\n"));
    return;
  }

  if (normalized === "2") {
    const rows = await loadCapacitacionesRows();
    const today = new Date();
    const filteredRows = rows.filter((row) => parseBusinessDate(row[config.capacitacionesDateCol]) >= today);
    if (!filteredRows?.length) {
      await client.sendMessage(jid, "Sin capacitaciones para mostrar.");
      return;
    }

    const ordered = sortByDate(await resolveNames(filteredRows));
    const grouped = new Map();
    for (const row of ordered) {
      const names = splitEnumList(row[config.capacitacionesCapacitadoresCol]);
      if (!names.length) {
        grouped.set("SIN CAPACITADOR", [...(grouped.get("SIN CAPACITADOR") || []), row]);
        continue;
      }
      for (const name of names) {
        grouped.set(name, [...(grouped.get(name) || []), row]);
      }
    }

    const blocks = [];
    const minimalFields = [
      config.capacitacionesDateCol,
      config.capacitacionesCedeCol,
      config.capacitacionesSucursalesCol,
    ];
    for (const [name, items] of grouped.entries()) {
      if (blocks.length) blocks.push("");
      blocks.push(name.toUpperCase());
      blocks.push(formatCapacitaciones(items, minimalFields));
    }

    await client.sendMessage(jid, blocks.join("\n"));
    return;
  }

  if (normalized === "3" || normalized === config.keywordSubirImagenes) {
    await beginUploadFlow(jid, client);
    return;
  }

  if (normalized === "4") {
    await beginStorePhotosFlow(jid, client);
    return;
  }

  if (normalized === "5" || normalized === config.keywordArchivo || normalized === config.keywordArchivos) {
    await beginArchivoFlow(jid, client);
    return;
  }

  if (hasMenuContext(jid)) {
    await client.sendMessage(jid, `Comando no reconocido. Escribe "${config.keywordCapacitaciones}" o "ayuda".`);
    return;
  }

  if (botPrompt !== null) {
    await handleAiText(client, jid, botPrompt, identity);
  }
}

async function refreshAuthorizedNumbers() {
  const logger = getLogger();
  const employees = await loadEmployeesCache();
  logger.info({ count: employees.phoneSet.size }, "authorized numbers refreshed");
}

function scheduleAuthorizedNumbersRefresh() {
  const config = ensureRuntimeConfig();
  clearInterval(runtime.refreshTimer);
  runtime.refreshTimer = setInterval(() => {
    refreshAuthorizedNumbers().catch((error) => {
      getLogger().error(error, "authorized numbers refresh error");
    });
  }, config.authRefreshMinutes * 60 * 1000);
}

function markServiceError(error) {
  serviceState.status = "error";
  serviceState.connected = false;
  serviceState.lastError = error instanceof Error ? error.message : String(error);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeChromiumSingletonLocks(rootDir) {
  const targetNames = new Set(["SingletonCookie", "SingletonLock", "SingletonSocket"]);
  let removed = 0;

  function walk(currentDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!targetNames.has(entry.name)) continue;

      try {
        fs.rmSync(fullPath, { force: true });
        removed += 1;
      } catch {
        // Ignore stale lock cleanup errors and let Chromium report any real issue.
      }
    }
  }

  walk(rootDir);
  return removed;
}

function isRetryableInitializeError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("execution context was destroyed") ||
    normalized.includes("timeout after") ||
    normalized.includes("watchdog after") ||
    normalized.includes("auth timeout") ||
    normalized.includes("target closed") ||
    normalized.includes("session closed") ||
    normalized.includes("most likely because of a navigation") ||
    normalized.includes("profile appears to be in use") ||
    normalized.includes("process_singleton_posix") ||
    normalized.includes("chromium has locked the profile")
  );
}

function clearReconnectTimer() {
  clearTimeout(runtime.reconnectTimer);
  runtime.reconnectTimer = null;
}

export function isWhatsAppAuthenticationStalled(status, authenticatedAt, now = Date.now()) {
  return status === "authenticated"
    && Number.isFinite(authenticatedAt)
    && now - authenticatedAt >= WHATSAPP_AUTH_WATCHDOG_MS;
}

function clearAuthenticationWatchdog() {
  clearInterval(runtime.authWatchdogTimer);
  runtime.authWatchdogTimer = null;
  runtime.authenticatedAt = null;
}

function startAuthenticationWatchdog() {
  clearAuthenticationWatchdog();
  runtime.authWatchdogTimer = setInterval(() => {
    if (runtime.intentionalStop || runtime.recovering || !runtime.client) return;
    if (!isWhatsAppAuthenticationStalled(serviceState.status, runtime.authenticatedAt)) return;
    const client = runtime.client;
    runtime.logger?.error({ stalledMs: Date.now() - runtime.authenticatedAt }, "whatsapp authenticated without ready; recovering session");
    void Promise.race([
      recoverWhatsAppClient(client, "authenticated_without_ready"),
      wait(30000).then(() => { throw new Error("whatsapp recovery timed out"); }),
    ]).catch((error) => {
      runtime.logger?.fatal({ error: serializeError(error) }, "whatsapp watchdog recovery failed; restarting container");
      process.exit(1);
    });
  }, WHATSAPP_AUTH_WATCHDOG_INTERVAL_MS);
  runtime.authWatchdogTimer.unref();
}

function scheduleWhatsAppReconnect(reason) {
  const config = runtime.config;
  if (!config?.enabled || runtime.reconnectTimer) return;

  serviceState.status = "restarting";
  serviceState.connected = false;
  runtime.logger?.warn({ reason }, "scheduling whatsapp reconnect");

  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    serviceState.startPromise = bootWhatsAppService(config).catch((error) => {
      markServiceError(error);
      serviceState.startPromise = null;
      throw error;
    });
  }, 2500);
}

function isLogoutReason(reason) {
  return String(reason || "").trim().toUpperCase() === "LOGOUT";
}

async function clearWhatsAppLocalSession(config, reason) {
  if (!isLogoutReason(reason)) return;

  const sessionPath = path.join(config.sessionDir, "session");
  try {
    await fs.promises.rm(sessionPath, { recursive: true, force: true, maxRetries: 5 });
    runtime.logger?.warn({ sessionPath, reason }, "removed whatsapp local session after logout");
  } catch (error) {
    runtime.logger?.warn({ sessionPath, reason, error: serializeError(error) }, "failed to remove whatsapp local session");
  }
}

async function recoverWhatsAppClient(client, reason) {
  if (runtime.recovering || runtime.client !== client) return;
  runtime.recovering = true;
  const config = runtime.config;
  serviceState.startPromise = null;
  if (runtime.client === client) runtime.client = null;

  runtime.authenticatedAt = null;
  try {
    await destroyWhatsAppClient(client);
    if (runtime.intentionalStop) return;
    if (config) await clearWhatsAppLocalSession(config, reason);
    scheduleWhatsAppReconnect(reason || "disconnected");
  } finally {
    runtime.recovering = false;
  }
}

function createWhatsAppClient(config) {
  const clientOptions = {
    authStrategy: new LocalAuth({ dataPath: config.sessionDir }),
    puppeteer: {
      executablePath: config.chromePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  };

  if (config.webVersion && config.webVersionRemotePath) {
    clientOptions.webVersion = config.webVersion;
    clientOptions.webVersionCache = {
      type: "remote",
      remotePath: config.webVersionRemotePath,
      strict: true,
    };
  }

  const client = new Client(clientOptions);

  client.on("qr", (qr) => {
    serviceState.status = "awaiting_qr";
    serviceState.qrGeneratedAt = new Date().toISOString();
    serviceState.qrPayload = qr;
    qrcode.generate(qr, { small: true });
    runtime.logger.info("QR generado, escanear en WhatsApp");
  });

  client.on("loading_screen", (percent, message) => {
    runtime.logger.info({ percent, message }, "whatsapp loading screen");
  });

  client.on("authenticated", () => {
    runtime.authenticatedAt = Date.now();
    serviceState.status = "authenticated";
    serviceState.connected = true;
    serviceState.qrPayload = null;
    serviceState.lastError = null;
    runtime.logger.info("whatsapp authenticated");
  });

  client.on("change_state", (state) => {
    if (String(state || "").toUpperCase() === "CONNECTED") {
      runtime.authenticatedAt = null;
      serviceState.connected = true;
      if (serviceState.status === "authenticated") {
        serviceState.status = "ready";
        serviceState.readyAt = new Date().toISOString();
      }
    }

    runtime.logger.info({ state }, "whatsapp state changed");
  });

  client.on("ready", async () => {
    runtime.authenticatedAt = null;
    clearReconnectTimer();
    serviceState.status = "ready";
    serviceState.connected = true;
    serviceState.readyAt = new Date().toISOString();
    serviceState.qrPayload = null;
    serviceState.lastError = null;
    runtime.logger.info("whatsapp connected");

    if (config.botName) {
      try {
        const updated = await client.setDisplayName(config.botName);
        runtime.logger.info({ botName: config.botName, updated }, "whatsapp display name configured");
      } catch (error) {
        runtime.logger.warn({ error, botName: config.botName }, "whatsapp display name update failed");
      }
    }
  });

  client.on("auth_failure", (message) => {
    serviceState.status = "auth_failure";
    serviceState.connected = false;
    serviceState.qrPayload = null;
    serviceState.lastError = String(message || "auth failure");
    runtime.logger.error({ message }, "auth failure");
    void recoverWhatsAppClient(client, message || "auth_failure");
  });

  client.on("disconnected", (reason) => {
    serviceState.status = "disconnected";
    serviceState.connected = false;
    serviceState.qrPayload = null;
    serviceState.lastError = String(reason || "disconnected");
    runtime.logger.warn({ reason }, "connection closed");
    void recoverWhatsAppClient(client, reason || "disconnected");
  });

  client.on("message", async (msg) => {
    try {
      await handleIncomingMessage(msg);
    } catch (error) {
      runtime.logger.error(error, "incoming message error");
      markServiceError(error);
    }
  });

  return client;
}

async function destroyWhatsAppClient(client) {
  if (!client) return;

  try {
    await client.destroy();
  } catch (error) {
    getLogger().warn({ error }, "client destroy failed");
  }

  try {
    if (client.pupBrowser?.connected) {
      await client.pupBrowser.close();
    }
  } catch (error) {
    getLogger().warn({ error }, "browser close failed");
  }
}

async function handleIncomingMessage(msg) {
  const config = ensureRuntimeConfig();
  const logger = getLogger();

  if (!msg) return;
  const jid = msg.from;
  logger.info(
    {
      from: jid,
      fromMe: Boolean(msg.fromMe),
      type: msg.type,
      hasMedia: Boolean(msg.hasMedia),
      body: String(getTextMessage(msg) || "").slice(0, 80),
    },
    "incoming whatsapp message"
  );
  if (msg.fromMe) return;
  if (!jid || jid.includes("@g.us")) return;

  let resolvedNumber = jid.split("@")[0];
  let lidFallback = false;
  if (jid.endsWith("@lid")) {
    try {
      const mappings = await runtime.client?.getContactLidAndPhone?.([jid]);
      const phoneJid = mappings?.[0]?.pn;
      if (phoneJid) {
        resolvedNumber = phoneJid.split("@")[0];
      } else {
        const contact = await msg.getContact();
        if (contact?.number) resolvedNumber = contact.number;
        else if (contact?.id?._serialized) resolvedNumber = contact.id._serialized.split("@")[0];
      }
    } catch (error) {
      logger.warn({ error, from: jid }, "failed to resolve @lid contact");
    }
    lidFallback = normalizePhone(resolvedNumber) === normalizePhone(jid.split("@")[0]);
  }

  const normalizedNumber = normalizePhone(resolvedNumber);
  const employees = await loadEmployeesCache().catch((error) => {
    logger.error(error, "employees cache error");
    return null;
  });

  const allowedByConfig = config.allowedNumbers.length === 0 || config.allowedNumbers.includes(normalizedNumber);
  const allowedByEmployees = employees ? employees.phoneSet.has(normalizedNumber) : false;
  const allowedByLidFallback = Boolean(jid.endsWith("@lid") && lidFallback && config.allowLidFallback);
  if (!allowedByConfig || (!allowedByEmployees && config.allowedNumbers.length === 0 && !allowedByLidFallback)) {
    logger.warn({ from: jid, normalizedNumber, allowedByLidFallback }, "number not allowed");
    return;
  }

  if (msg.type === "image" || msg.hasMedia) {
    const uploadFlow = uploadContext.get(jid);
    if (uploadFlow?.step === "collect") {
      await saveIncomingMedia(msg, uploadFlow, { prefix: "img_" });
      return;
    }

    const storeFlow = storePhotosContext.get(jid);
    if (storeFlow?.step === "collect") {
      await saveIncomingMedia(msg, storeFlow, { prefix: "img_" });
      return;
    }

    const archivoFlow = archivoContext.get(jid);
    if (archivoFlow?.step === "collect") {
      await saveIncomingMedia(msg, archivoFlow, { prefix: "file_" });
      return;
    }

    await handleImage(msg);
    return;
  }

  const text = getTextMessage(msg);
  const identity = employees?.profileByPhone?.get(normalizedNumber)
    || employees?.profileByPhone?.get(phoneIdentityKey(normalizedNumber))
    || null;
  if (text) await handleText(runtime.client, jid, text, identity);
}

async function bootWhatsAppService(config) {
  runtime.config = config;
  runtime.logger = P({ level: config.logLevel });

  fs.mkdirSync(config.sessionDir, { recursive: true });
  fs.mkdirSync(config.tmpDir, { recursive: true });

  serviceState.enabled = true;
  serviceState.status = "starting";
  serviceState.startedAt = new Date().toISOString();
  serviceState.readyAt = null;
  serviceState.qrGeneratedAt = null;
  serviceState.qrPayload = null;
  serviceState.connected = false;
  serviceState.sessionDir = config.sessionDir;
  serviceState.lastError = null;
  startAuthenticationWatchdog();

  // Drive OAuth can require interactive consent. It must never block creation of
  // the WhatsApp client or the QR needed to establish the primary session.
  void getDriveClient()
    .then(() => runtime.logger.info("drive auth ready"))
    .catch((error) => runtime.logger.error(error, "drive auth error"));

  void refreshAuthorizedNumbers().catch((error) => {
    runtime.logger.error(error, "initial authorized numbers refresh error");
  });
  scheduleAuthorizedNumbersRefresh();

  const maxInitializeAttempts = 3;

  for (let attempt = 1; attempt <= maxInitializeAttempts; attempt += 1) {
    const removedLocks = removeChromiumSingletonLocks(config.sessionDir);
    if (removedLocks > 0) {
      runtime.logger.warn({ attempt, removedLocks }, "removed stale chromium singleton locks");
    }

    const client = createWhatsAppClient(config);
    runtime.client = client;

    try {
      const initializePromise = client.initialize();
      const watchdog = new Promise((_, reject) => {
        setTimeout(() => {
          if (serviceState.status === "ready" || serviceState.status === "awaiting_qr") return;
          reject(new Error(`whatsapp initialize watchdog after ${WHATSAPP_BOOT_WATCHDOG_MS}ms`));
        }, WHATSAPP_BOOT_WATCHDOG_MS).unref();
      });

      await Promise.race([initializePromise, watchdog]);
      return serviceState;
    } catch (error) {
      const retryable = attempt < maxInitializeAttempts && isRetryableInitializeError(error);
      runtime.logger.error(
        {
          attempt,
          retryable,
          error: error instanceof Error ? error.message : String(error),
        },
        "whatsapp initialize failed"
      );
      await destroyWhatsAppClient(client);
      runtime.client = null;

      if (!retryable) {
        throw error;
      }

      serviceState.status = "restarting";
      serviceState.connected = false;
      serviceState.lastError = error instanceof Error ? error.message : String(error);
      await wait(1500 * attempt);
    }
  }

  return serviceState;
}

export function getWhatsAppCapacitadoresStatus() {
  const config = runtime.config || getConfig();
  const enabled = config.enabled;
  const sessionDir = serviceState.sessionDir || config.sessionDir;
  const status =
    enabled && !serviceState.startedAt && !serviceState.startPromise && serviceState.status === "disabled"
      ? "idle"
      : serviceState.status;

  return {
    enabled,
    status,
    startedAt: serviceState.startedAt,
    readyAt: serviceState.readyAt,
    qrGeneratedAt: serviceState.qrGeneratedAt,
    qrAvailable: Boolean(serviceState.qrPayload),
    lastError: serviceState.lastError,
    sessionDir,
    connected: serviceState.connected,
  };
}

export async function getWhatsAppCapacitadoresQrScreenshot() {
  if (!serviceState.qrPayload && serviceState.status !== "awaiting_qr") return null;

  if (serviceState.qrPayload) {
    try {
      return await QRCode.toBuffer(serviceState.qrPayload, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 8,
      });
    } catch (error) {
      getLogger().warn({ error }, "qr png generation failed");
    }
  }

  const page = runtime.client?.pupPage;
  if (!page) return null;

  try {
    return await page.screenshot({ type: "png", fullPage: true });
  } catch (error) {
    getLogger().warn({ error }, "qr screenshot failed");
    return null;
  }
}

export async function startWhatsAppCapacitadoresService() {
  const config = getConfig();
  serviceState.enabled = config.enabled;
  serviceState.sessionDir = config.sessionDir;
  runtime.intentionalStop = false;

  if (!config.enabled) {
    serviceState.status = "disabled";
    return getWhatsAppCapacitadoresStatus();
  }

  if (serviceState.startPromise) return serviceState.startPromise;

  serviceState.startPromise = bootWhatsAppService(config).catch((error) => {
    markServiceError(error);
    serviceState.startPromise = null;
    throw error;
  });

  return serviceState.startPromise;
}

export async function stopWhatsAppCapacitadoresService() {
  clearReconnectTimer();
  clearAuthenticationWatchdog();
  clearInterval(runtime.refreshTimer);
  runtime.refreshTimer = null;

  const client = runtime.client;
  runtime.client = null;
  serviceState.startPromise = null;
  runtime.intentionalStop = true;

  if (client) {
    await destroyWhatsAppClient(client);
  }

  serviceState.connected = false;
  serviceState.status = serviceState.enabled ? "stopped" : "disabled";
  serviceState.qrPayload = null;
  return getWhatsAppCapacitadoresStatus();
}

export async function restartWhatsAppCapacitadoresForQr() {
  await stopWhatsAppCapacitadoresService();
  return startWhatsAppCapacitadoresService();
}

