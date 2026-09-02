import crypto from "crypto";
import { google } from "googleapis";
import { fetchPedidosLeyAdminDashboardData } from "../pedidos-ley/services/pedidosLey.js";
import { getActivePortalBasePath, getPortalCookieSuffix, portalPath } from "./portalPath.js";
import {
  createPortalNoteEntry as createLocalPortalNoteEntry,
  deleteCalendarNoteAuthor,
  deletePortalNoteEntry as deleteLocalPortalNoteEntry,
  listPortalNoteEntries,
  readLocalRow,
  readLocalRows,
  updatePortalNoteEntry as updateLocalPortalNoteEntry,
  upsertCalendarNoteAuthor,
} from "../../services/desarrolloegLocalDb.js";
import {
  getCapacitacionCapacitadoresLocalRows,
  getCapacitacionSucursalesLocalRows,
  getCapacitacionesLocalRows,
  getEmpleadosLocalRows,
  getEstatalesLocalRows,
  getMunicipalesLocalRows,
  getPedidosLeyLocalRows,
  getSucursalesLocalRows,
} from "../jobs/services/localAppsheetDb.js";
import {
  getPersistentCacheEntry,
  getPersistentCacheSummary,
  setPersistentCacheEntry,
} from "../../services/platformCache.js";
import { resolvePortalAccessProfile } from "./portalAccessPolicy.js";
import { readPcEstatalStatusBySucursal } from "./pcEstatal.service.js";

const APPSHEET_TIMEOUT_MS = Number(process.env.APPSHEET_TIMEOUT_MS || 20000);
const APPSHEET_MAX_RETRIES = Number(process.env.APPSHEET_MAX_RETRIES || 3);
const APPSHEET_RETRY_BASE_MS = Number(process.env.APPSHEET_RETRY_BASE_MS || 500);
const APPSHEET_RETRY_MAX_MS = Number(process.env.APPSHEET_RETRY_MAX_MS || 5000);
const EMPLOYEE_CACHE_TTL_MS = Number(process.env.PORTAL_EMPLOYEES_CACHE_TTL_MS || 120000);
const SESSION_TTL_HOURS = Number(process.env.PORTAL_SESSION_TTL_HOURS || 12);
const COOKIE_NAME = process.env.PORTAL_SESSION_COOKIE_NAME || "desarrolloeg_portal_session";
const GOOGLE_STATE_COOKIE_NAME = process.env.PORTAL_GOOGLE_STATE_COOKIE_NAME || "desarrolloeg_portal_oauth_state";
const QA_ACCESS_ENABLED = parseBoolean(process.env.PORTAL_QA_ACCESS_ENABLED);
const QA_ACCESS_TOKEN = String(process.env.PORTAL_QA_ACCESS_TOKEN || "").trim();
const QA_ACCESS_EMAIL = normalizeEmail(process.env.PORTAL_QA_ACCESS_EMAIL || "");
const QA_ACCESS_NAME = String(process.env.PORTAL_QA_ACCESS_NAME || "QA Admin").trim();
const QA_ACCESS_PUESTO = String(process.env.PORTAL_QA_ACCESS_PUESTO || "MEJORA CONTINUA").trim();
const QA_ACCESS_ROW_ID = String(process.env.PORTAL_QA_ACCESS_ROW_ID || "qa-access").trim();
const DEV_AUTH_BYPASS_ENABLED = parseBoolean(process.env.PORTAL_DEV_AUTH_BYPASS);
const SESSION_SECRET =
  process.env.PORTAL_AUTH_SECRET ||
  process.env.PORTAL_SESSION_SECRET ||
  (String(process.env.NODE_ENV || "development").toLowerCase() !== "production"
    ? "desarrolloeg-portal-dev-secret"
    : "");

if (!SESSION_SECRET) {
  throw new Error("Falta configurar PORTAL_AUTH_SECRET o PORTAL_SESSION_SECRET");
}
const GOOGLE_OAUTH_SCOPES = ["openid", "email", "profile"];

const DEFAULT_CONFIG = {
  appId: "",
  accessKey: "",
  table: "EMPLEADOS",
  keyColumn: "Row ID",
  nameColumn: "NOMBRE",
  initialsColumn: "INICIALES",
  colorColumn: "COLOR",
  puestoColumn: "PUESTO",
  emailColumn: "CORREO",
  capacitaColumn: "CAPACITA",
  permisoColumn: "PERMISO",
  firmaColumn: "FIRMA",
  birthdayColumn: "CUMPLEAÑOS",
  phoneColumn1: "TELEFONO",
  phoneColumn2: "TELEFONO 2",
  capacitacionesTable: "CAPACITACIONES",
  capacitacionesIdColumn: "ID",
  capacitacionesKeyColumn: "Row ID",
  capacitacionesDateColumn: "FECHA CAPACITACION",
  capacitacionesHourStartColumn: "HORA INICIO",
  capacitacionesHourEndColumn: "HORA FIN",
  capacitacionesCapacitadoresColumn: "CAPACITADORES",
  capacitacionesSucursalesColumn: "SUCURSALES",
  capacitacionesCedeColumn: "CEDE",
  capacitacionesStatusColumn: "STATUS",
  capacitacionesDiplomasColumn: "DIPLOMAS",
  capacitacionesNotesColumn: "NOTAS",
  calendarNotesTable: "CALENDARIO",
  calendarNotesKeyColumn: "ID",
  calendarNotesDateColumn: "FECHA",
  calendarNotesIconColumn: "ICONO",
  calendarNotesTitleColumn: "TITULO",
  calendarNotesNotesColumn: "NOTAS",
  calendarNotesEmployeesColumn: "EMPLEADOS",
  calendarNotesColorColumn: "COLOR",
  sucursalesTable: "SUCURSALES",
  sucursalesKeyColumn: "ID",
  sucursalesLabelColumn: "LABEL",
  sucursalesLabel2Column: "LABEL2",
  sucursalesNameColumn: "NOMBRE",
  sucursalesTiendaColumn: "TIENDA",
};

const EMPLOYEE_CACHE = {
  entries: new Map(),
  pending: null,
};
const EMPLOYEE_SHARED_CACHE_KEY = "__shared__";

const CAPACITACION_CACHE = {
  entries: new Map(),
};

const CALENDAR_NOTE_CACHE = {
  entries: new Map(),
};

const SUCURSAL_CACHE = {
  entries: new Map(),
};

const DASHBOARD_CACHE = {
  entries: new Map(),
};

const PORTAL_CACHE_NAMESPACES = {
  employees: "portal.employees",
  sucursales: "portal.sucursales",
  capacitaciones: "portal.capacitaciones",
  calendarNotes: "portal.calendar-notes",
};

const LOCAL_DB_SOURCE = "desarrolloeg-sync-db";
const TERRITORY_SHIELD_CACHE = new Map();

function clearDashboardCache() {
  DASHBOARD_CACHE.entries.clear();
}

function mapLocalEmployeeRow(row = {}) {
  return {
    id: String(row.id || row.row_id || "").trim(),
    row_id: String(row.row_id || row.id || "").trim(),
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

function mapLocalSucursalRow(row = {}) {
  const drive = String(row.drive || "").trim();
  return {
    id: String(row.id || "").trim(),
    ID: String(row.id || "").trim(),
    "Row ID": String(row.id || "").trim(),
    LABEL: String(row.label || "").trim(),
    LABEL2: String(row.label2 || "").trim(),
    NOMBRE: String(row.nombre || "").trim(),
    TIENDA: String(row.tienda || "").trim(),
    empresa_id: String(row.empresa_id || "").trim(),
    municipio_id: String(row.municipio_id || "").trim(),
    estado_id: String(row.estado_id || "").trim(),
    DIRECCION: String(row.direccion || "").trim(),
    LAT: row.lat,
    LNG: row.lng,
    DRIVE: drive,
    drive,
    mes_planeacion: row.mes_planeacion,
    capacitadores: String(row.capacitadores || "").trim(),
  };
}

function mapLocalCapacitacionRow(row = {}) {
  return {
    id: String(row.id || "").trim(),
    ID: String(row.id || "").trim(),
    "Row ID": String(row.id || "").trim(),
    "FECHA CAPACITACION": String(row.fecha_capacitacion || "").trim(),
    "CEDE": String(row.cede_nombre || row.cede_sucursal_id || "").trim(),
    STATUS: String(row.status || "").trim(),
    "HORA INICIO": String(row.hora_inicio || "").trim(),
    "HORA FIN": String(row.hora_fin || "").trim(),
    DIPLOMAS: String(row.diplomas || "").trim(),
    NOTAS: String(row.notas || "").trim(),
    CAPACITADORES: String(row.capacitadores_text || "").trim(),
    SUCURSALES: String(row.sucursales_text || "").trim(),
  };
}

function mapLocalCalendarNoteRow(row = {}) {
  return {
    id: String(row.id || "").trim(),
    ID: String(row.id || "").trim(),
    "Row ID": String(row.id || "").trim(),
    FECHA: String(row.fecha || "").trim(),
    ICONO: String(row.icono || "").trim(),
    TITULO: String(row.titulo || "").trim(),
    NOTAS: String(row.notas || "").trim(),
    COLOR: String(row.color || "").trim(),
    EMPLEADOS: String(row.empleados || "").trim(),
    AUTOR_ID: String(row.creado_por_id || "").trim(),
    AUTOR_NOMBRE: String(row.creado_por_nombre || "").trim(),
    AUTOR_CORREO: String(row.creado_por_correo || "").trim(),
  };
}

function readLocalPortalRows(sql, params = [], mapper = (row) => row) {
  return readLocalRows(sql, params).map((row) => mapper(row)).filter((row) => Boolean(row));
}

function readLocalPortalRow(sql, params = [], mapper = (row) => row) {
  const row = readLocalRow(sql, params);
  return row ? mapper(row) : null;
}

function getSharedCacheEntry(cache) {
  return cache.entries.get(EMPLOYEE_SHARED_CACHE_KEY) || null;
}

function setSharedCacheEntry(cache, entry = {}) {
  cache.entries.set(EMPLOYEE_SHARED_CACHE_KEY, entry);
}

function createRowsSnapshot(rows = [], keySelector = (row) => row?.rowId || row?.id || "") {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const lastRow = normalizedRows.length > 0 ? normalizedRows[normalizedRows.length - 1] : null;
  const lastRowKey = String(keySelector(lastRow) || "").trim();
  const lastRowHash = lastRow ? crypto.createHash("sha1").update(JSON.stringify(lastRow)).digest("hex") : "";
  return {
    rowCount: normalizedRows.length,
    lastRowKey,
    lastRowHash,
  };
}

function hydrateEmployeeCacheEntry(rows = [], loadedAt = Date.now()) {
  const nameByKey = new Map();
  const initialsByKey = new Map();
  const colorByKey = new Map();
  for (const employee of rows) {
    if (!employee?.rowId) continue;
    nameByKey.set(employee.rowId, employee.nombre);
    initialsByKey.set(employee.rowId, employee.initials || buildInitialsFromName(employee.nombre));
    colorByKey.set(employee.rowId, employee.calendarColor || employee.color || "");
  }
  return {
    loadedAt,
    rows,
    nameByKey,
    initialsByKey,
    colorByKey,
  };
}

function hydrateSucursalCacheEntry(rows = [], loadedAt = Date.now()) {
  const labelByKey = new Map();
  const keyByLabel = new Map();
  for (const sucursal of rows) {
    if (!sucursal?.key) continue;
    labelByKey.set(sucursal.key, sucursal.displayLabel || sucursal.key);
    const visibleLabels = [sucursal.label, sucursal.label2, sucursal.name, sucursal.tienda, sucursal.displayLabel]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    for (const label of visibleLabels) {
      keyByLabel.set(normalizeLabelToken(label), sucursal.key);
    }
  }
  return {
    loadedAt,
    rows,
    labelByKey,
    keyByLabel,
  };
}

function readCachedRowsFromPersistent(namespace, runAsUserEmail = "") {
  const persistent = getPersistentCacheEntry(namespace, "shared", { allowStale: true });
  const rows = Array.isArray(persistent?.payload?.rows) ? persistent.payload.rows : [];
  if (!rows.length) {
    return null;
  }

  if (namespace === PORTAL_CACHE_NAMESPACES.employees) {
    const entry = hydrateEmployeeCacheEntry(rows, persistent.loadedAt || Date.now());
    setSharedCacheEntry(EMPLOYEE_CACHE, entry);
    if (runAsUserEmail) setCachedEntry(EMPLOYEE_CACHE, runAsUserEmail, entry);
    return entry;
  }

  if (namespace === PORTAL_CACHE_NAMESPACES.sucursales) {
    const entry = hydrateSucursalCacheEntry(rows, persistent.loadedAt || Date.now());
    setSharedCacheEntry(SUCURSAL_CACHE, entry);
    if (runAsUserEmail) setCachedEntry(SUCURSAL_CACHE, runAsUserEmail, entry);
    return entry;
  }

  if (namespace === PORTAL_CACHE_NAMESPACES.capacitaciones) {
    const entry = {
      loadedAt: persistent.loadedAt || Date.now(),
      rows,
    };
    setSharedCacheEntry(CAPACITACION_CACHE, entry);
    if (runAsUserEmail) setCachedEntry(CAPACITACION_CACHE, runAsUserEmail, entry);
    return entry;
  }

  if (namespace === PORTAL_CACHE_NAMESPACES.calendarNotes) {
    const entry = {
      loadedAt: persistent.loadedAt || Date.now(),
      rows,
    };
    setSharedCacheEntry(CALENDAR_NOTE_CACHE, entry);
    if (runAsUserEmail) setCachedEntry(CALENDAR_NOTE_CACHE, runAsUserEmail, entry);
    return entry;
  }

  return null;
}

function getDashboardCacheKey(viewerRole, selectedRowId) {
  return `${String(viewerRole || "").trim()}:${String(selectedRowId || "").trim() || "__default__"}`;
}

const ADMIN_PUESTOS = new Set(["GERENTE GENERAL", "DIRECTOR GENERAL", "MEJORA CONTINUA"]);
const CAPACITADOR_PUESTOS = new Set(["CAPACITADOR"]);

const GENERAL_ROUTE_CARDS = [
  {
    tone: "status",
    label: "Monolito",
    title: "Estado general",
    description: "Resumen operativo, salud del sistema y accesos rapidos a la administracion.",
    href: "/status",
  },
  {
    tone: "blue",
    label: "Automatizacion",
    title: "Jobs",
    description: "Ejecuciones manuales, estado de jobs y sincronizaciones.",
    href: "/jobs/view",
  },
  {
    tone: "amber",
    label: "Mensajeria",
    title: "WhatsApp Capacitadores",
    description: "Sesion, QR y estado del bot de capacitadores.",
    href: "/whatsapp-capacitadores",
  },
  {
    tone: "green",
    label: "Planeacion",
    title: "Planeación Ley",
    description: "Vista operativa para planeacion y seguimiento interno.",
    href: "/Planeacion-ley/",
  },
  {
    tone: "violet",
    label: "Documentos",
    title: "Sucursales Docs",
    description: "Generación de documentos y cartas desde AppSheet.",
    href: "/SUCURSALES-DOCS/",
  },
  {
    tone: "rose",
    label: "Control",
    title: "Faltantes Ley",
    description: "Consulta rapida de pendientes y faltantes.",
    href: "/FALTANTES-LEY/",
  },
  {
    tone: "blue",
    label: "Pedidos",
    title: "Pedidos sin liberacion",
    description: "Envio de pedidos, archivos de Drive y control de enviados.",
    href: "/pedidos-sin-liberacion",
  },
  {
    tone: "cyan",
    label: "Pedidos",
    title: "Pedidos admin",
    description: "Panel con pedidos, estados, pagos y clasificacion estatal o municipal.",
    href: "/dashboard/pedidos",
  },
  {
    tone: "teal",
    label: "Reporte",
    title: "Solventaciones",
    description: "Visitas, incidencias y reporte detallado por sucursal.",
    href: "/SOLVENTACIONES/html",
  },
  {
    tone: "red",
    label: "Póliza",
    title: "Póliza Ley",
    description: "Consulta por ubicacion o domicilio y descarga la pagina en JPEG.",
    href: "/POLIZA_LEY/",
  },
  {
    tone: "orange",
    label: "Constancias",
    title: "Constancias",
    description: "Herramienta libre para capacitadores y admins.",
    href: "/CONSTANCIAS/",
  },
  {
    tone: "indigo",
    label: "PDF",
    title: "Separar PIPC",
    description: "Utilidad para dividir y procesar archivos PIPC.",
    href: "/SEPARAR-PIPC/",
  },
  {
    tone: "slate",
    label: "Cotizaciones",
    title: "Cotizaciones",
    description: "Cotizaciones y utilidades del modulo.",
    href: "/cotizaciones/cotizacion/html",
  },
  {
    tone: "emerald",
    label: "Interno",
    title: "Contabilidad",
    description: "Herramientas internas de contabilidad.",
    href: "/contabilidad",
  },
];

const CAPACITADOR_ROUTE_CARDS = [];

function firstEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function splitCsv(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getScopedCookieName(baseName, basePath = undefined) {
  const suffix = getPortalCookieSuffix(basePath);
  return suffix ? `${baseName}${suffix}` : baseName;
}

function getScopedCookiePath(basePath = undefined) {
  return getActivePortalBasePath(basePath) || "/";
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "si";
}

function hasTruthyValue(value) {
  if (value == null) return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasTruthyValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value).some((item) => hasTruthyValue(item));
  }

  const normalized = String(value).trim();
  if (!normalized) return false;
  if (/^(0|false|no|n|none|null|n\/a|na|sin diplomas?|sin diploma|vac[ií]o)$/i.test(normalized)) return false;
  if (/^(y|yes|si|s[ií]|true|1)$/i.test(normalized)) return true;

  if ((normalized.startsWith("[") && normalized.endsWith("]")) || (normalized.startsWith("{") && normalized.endsWith("}"))) {
    try {
      return hasTruthyValue(JSON.parse(normalized));
    } catch {
      return true;
    }
  }

  return true;
}

function parseDateValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const isoLike = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) {
    const parsed = new Date(Number(isoLike[1]), Number(isoLike[2]) - 1, Number(isoLike[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const slashMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) year += 2000;
    let month = first;
    let day = second;
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    }
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function deriveCapacitacionStatusFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return toLocalDateKey(new Date()) > toLocalDateKey(date) ? "FINALIZADA" : "PROGRAMADA";
}

function getReadableTextColor(backgroundColor) {
  const text = String(backgroundColor || "").trim();
  const hex = text.startsWith("#") ? text.slice(1) : "";
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return "#ffffff";
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 160 ? "#1a2a3a" : "#ffffff";
}

function hashStringToInt(value) {
  const text = String(value ?? "").trim();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function hslToHex(hue, saturation, lightness) {
  const h = ((Number(hue) % 360) + 360) % 360 / 360;
  const s = Math.max(0, Math.min(100, Number(saturation))) / 100;
  const l = Math.max(0, Math.min(100, Number(lightness))) / 100;
  const hue2rgb = (p, q, t) => {
    let nextT = t;
    if (nextT < 0) nextT += 1;
    if (nextT > 1) nextT -= 1;
    if (nextT < 1 / 6) return p + (q - p) * 6 * nextT;
    if (nextT < 1 / 2) return q;
    if (nextT < 2 / 3) return p + (q - p) * (2 / 3 - nextT) * 6;
    return p;
  };

  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (value) => Math.round(value * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getCalendarColorSeed(row = {}) {
  return String(row.rowId || row.correo || row.nombre || row.puesto || "").trim();
}

function normalizeCalendarHexColor(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text.slice(1).split("").map((char) => `${char}${char}`).join("")}`;
  }
  return text;
}

function pickCalendarColor(seed, fallback = "#1e3a8a") {
  const normalizedSeed = String(seed || "").trim();
  if (normalizedSeed) {
    const hash = hashStringToInt(normalizedSeed);
    const hue = hash % 360;
    const saturation = 72;
    const lightness = 42 + (hash % 2) * 4;
    return hslToHex(hue, saturation, lightness);
  }
  const normalizedFallback = String(fallback || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalizedFallback) && normalizedFallback !== "#6b7280") {
    return normalizedFallback;
  }
  const hash = hashStringToInt(normalizedFallback || "calendar");
  return hslToHex(hash % 360, 72, 42 + (hash % 2) * 4);
}

function normalizeBirthdayValue(rawValue, targetYear = new Date().getFullYear()) {
  const parsed = parseDateValue(rawValue);
  if (!parsed) return { value: "", parsed: null };
  const birthday = new Date(targetYear, parsed.getMonth(), parsed.getDate());
  return {
    value: toLocalDateKey(birthday),
    parsed,
  };
}

function buildInitialsFromName(value) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function extractListTokens(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractListTokens(item));
  }

  if (typeof value === "object") {
    const candidates = [
      value["Row ID"],
      value.RowID,
      value.RowId,
      value.ID,
      value.id,
      value.Key,
      value.key,
      value._ComputedKey,
      value.CORREO,
      value.correo,
      value.NOMBRE,
      value.nombre,
      value.INICIALES,
      value.initials,
      value.value,
      value.ref,
    ];
    const extracted = candidates.flatMap((candidate) => extractListTokens(candidate));
    if (extracted.length > 0) return extracted;
    return Object.values(value).flatMap((item) => extractListTokens(item));
  }

  const text = String(value).trim();
  if (!text) return [];
  return text
    .split(/[,;|\n·•∙●]+/)
    .map((item) => item.trim().replace(/^["'[\]()]+|["'[\])]+$/g, "").replace(/\s+/g, " "))
    .filter(Boolean);
}

function normalizeSearchToken(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function employeeMatchesToken(token, employee, employeeLookups) {
  const normalizedToken = normalizeSearchToken(token);
  if (!normalizedToken) return false;

  const candidates = [
    employee?.rowId,
    employee?.rowId?.trim(),
    employee?.nombre,
    employee?.correo,
    employee?.initials,
    employeeLookups?.nameByKey?.get(employee?.rowId),
    employeeLookups?.initialsByKey?.get(employee?.rowId),
  ];

  return candidates.some((candidate) => normalizeSearchToken(candidate) === normalizedToken);
}

function capacitacionMatchesEmployee(row, employee, employeeLookups) {
  if (!row || !employee) return false;

  const config = getConfig();
  const rawValue = extractListTokens(row[config.capacitacionesCapacitadoresColumn]);

  if (!rawValue.length) return false;

  return rawValue.some((token) => employeeMatchesToken(token, employee, employeeLookups));
}

function getConfig() {
  return {
    appId: firstEnv([
      "WHATSAPP_CAP_APPSHEET_APP_ID",
      "APPSHEET_APP_ID",
    ]),
    accessKey: firstEnv([
      "WHATSAPP_CAP_APPSHEET_ACCESS_KEY",
      "WHATSAPP_CAP_APPSHEET_API_KEY",
      "APPSHEET_API_KEY",
      "APPSHEET_ACCESS_KEY",
    ]),
    table: firstEnv([
      "PORTAL_APPSHEET_TABLE_EMPLEADOS",
      "WHATSAPP_CAP_TABLE_EMPLEADOS",
      "APPSHEET_TABLE_EMPLEADOS",
    ], DEFAULT_CONFIG.table),
    keyColumn: firstEnv(["PORTAL_EMPLEADOS_KEY_COL", "WHATSAPP_CAP_EMPLEADOS_KEY_COL"], DEFAULT_CONFIG.keyColumn),
    nameColumn: firstEnv(["PORTAL_EMPLEADOS_NAME_COL", "WHATSAPP_CAP_EMPLEADOS_NAME_COL"], DEFAULT_CONFIG.nameColumn),
    initialsColumn: firstEnv(["PORTAL_EMPLEADOS_INITIALS_COL", "WHATSAPP_CAP_EMPLEADOS_INITIALS_COL"], DEFAULT_CONFIG.initialsColumn),
    colorColumn: firstEnv(["PORTAL_EMPLEADOS_COLOR_COL"], DEFAULT_CONFIG.colorColumn),
    puestoColumn: firstEnv(["PORTAL_EMPLEADOS_PUESTO_COL"], DEFAULT_CONFIG.puestoColumn),
    emailColumn: firstEnv(["PORTAL_EMPLEADOS_EMAIL_COL"], DEFAULT_CONFIG.emailColumn),
    capacitaColumn: firstEnv(["PORTAL_EMPLEADOS_CAPACITA_COL"], DEFAULT_CONFIG.capacitaColumn),
    permisoColumn: firstEnv(["PORTAL_EMPLEADOS_PERMISO_COL"], DEFAULT_CONFIG.permisoColumn),
    firmaColumn: firstEnv(["PORTAL_EMPLEADOS_FIRMA_COL"], DEFAULT_CONFIG.firmaColumn),
    birthdayColumn: firstEnv(["PORTAL_EMPLEADOS_BIRTHDAY_COL"], DEFAULT_CONFIG.birthdayColumn),
    phoneColumn1: firstEnv(["PORTAL_EMPLEADOS_PHONE_COL1", "WHATSAPP_CAP_EMPLEADOS_PHONE_COL1"], DEFAULT_CONFIG.phoneColumn1),
    phoneColumn2: firstEnv(["PORTAL_EMPLEADOS_PHONE_COL2", "WHATSAPP_CAP_EMPLEADOS_PHONE_COL2"], DEFAULT_CONFIG.phoneColumn2),
    capacitacionesTable: firstEnv(["PORTAL_APPSHEET_TABLE_CAPACITACIONES", "WHATSAPP_CAP_TABLE_CAPACITACIONES", "APPSHEET_TABLE_CAPACITACIONES"], DEFAULT_CONFIG.capacitacionesTable),
    capacitacionesKeyColumn: firstEnv(["PORTAL_CAPACITACIONES_KEY_COL", "WHATSAPP_CAP_CAPACITACIONES_KEY_COL"], DEFAULT_CONFIG.capacitacionesKeyColumn),
    capacitacionesDateColumn: firstEnv(["PORTAL_CAPACITACIONES_DATE_COL", "WHATSAPP_CAP_CAPACITACIONES_DATE_COL"], DEFAULT_CONFIG.capacitacionesDateColumn),
    capacitacionesCapacitadoresColumn: firstEnv(["PORTAL_CAPACITACIONES_CAPACITADORES_COL", "WHATSAPP_CAP_CAPACITACIONES_CAPACITADORES_COL"], DEFAULT_CONFIG.capacitacionesCapacitadoresColumn),
    capacitacionesSucursalesColumn: firstEnv(["PORTAL_CAPACITACIONES_SUCURSALES_COL", "WHATSAPP_CAP_CAPACITACIONES_SUCURSALES_COL"], DEFAULT_CONFIG.capacitacionesSucursalesColumn),
    capacitacionesCedeColumn: firstEnv(["PORTAL_CAPACITACIONES_CEDE_COL", "WHATSAPP_CAP_CAPACITACIONES_CEDE_COL"], DEFAULT_CONFIG.capacitacionesCedeColumn),
    capacitacionesStatusColumn: firstEnv(["PORTAL_CAPACITACIONES_STATUS_COL", "WHATSAPP_CAP_CAPACITACIONES_STATUS_COL"], DEFAULT_CONFIG.capacitacionesStatusColumn),
    capacitacionesDiplomasColumn: firstEnv(["PORTAL_CAPACITACIONES_DIPLOMAS_COL", "WHATSAPP_CAP_CAPACITACIONES_DIPLOMAS_COL"], DEFAULT_CONFIG.capacitacionesDiplomasColumn),
    calendarNotesTable: firstEnv(["PORTAL_APPSHEET_TABLE_CALENDARIO", "WHATSAPP_CAP_TABLE_CALENDARIO", "APPSHEET_TABLE_CALENDARIO"], DEFAULT_CONFIG.calendarNotesTable),
    calendarNotesKeyColumn: firstEnv(["PORTAL_CALENDAR_NOTES_KEY_COL", "WHATSAPP_CAP_CALENDAR_NOTES_KEY_COL"], DEFAULT_CONFIG.calendarNotesKeyColumn),
    calendarNotesDateColumn: firstEnv(["PORTAL_CALENDAR_NOTES_DATE_COL", "WHATSAPP_CAP_CALENDAR_NOTES_DATE_COL"], DEFAULT_CONFIG.calendarNotesDateColumn),
    calendarNotesIconColumn: firstEnv(["PORTAL_CALENDAR_NOTES_ICON_COL", "WHATSAPP_CAP_CALENDAR_NOTES_ICON_COL"], DEFAULT_CONFIG.calendarNotesIconColumn),
    calendarNotesTitleColumn: firstEnv(["PORTAL_CALENDAR_NOTES_TITLE_COL", "WHATSAPP_CAP_CALENDAR_NOTES_TITLE_COL"], DEFAULT_CONFIG.calendarNotesTitleColumn),
    calendarNotesNotesColumn: firstEnv(["PORTAL_CALENDAR_NOTES_NOTES_COL", "WHATSAPP_CAP_CALENDAR_NOTES_NOTES_COL"], DEFAULT_CONFIG.calendarNotesNotesColumn),
    calendarNotesEmployeesColumn: firstEnv(["PORTAL_CALENDAR_NOTES_EMPLOYEES_COL", "WHATSAPP_CAP_CALENDAR_NOTES_EMPLOYEES_COL"], DEFAULT_CONFIG.calendarNotesEmployeesColumn),
    calendarNotesColorColumn: firstEnv(["PORTAL_CALENDAR_NOTES_COLOR_COL", "WHATSAPP_CAP_CALENDAR_NOTES_COLOR_COL"], DEFAULT_CONFIG.calendarNotesColorColumn),
    sucursalesTable: firstEnv(["PORTAL_SUCURSALES_TABLE", "WHATSAPP_CAP_TABLE_SUCURSALES", "APPSHEET_TABLE_SUCURSALES"], DEFAULT_CONFIG.sucursalesTable),
    sucursalesKeyColumn: firstEnv(["PORTAL_SUCURSALES_KEY_COL", "WHATSAPP_CAP_SUCURSALES_KEY_COL", "SUCURSALES_KEY_COL"], DEFAULT_CONFIG.sucursalesKeyColumn),
    sucursalesLabelColumn: firstEnv(["PORTAL_SUCURSALES_LABEL_COL", "WHATSAPP_CAP_SUCURSALES_LABEL_COL", "WHATSAPP_CAP_SUCURSALES_NAME_COL", "SUCURSALES_LABEL_COL", "SUCURSALES_NAME_COL"], DEFAULT_CONFIG.sucursalesLabelColumn),
    sucursalesLabel2Column: firstEnv(["PORTAL_SUCURSALES_LABEL2_COL", "WHATSAPP_CAP_SUCURSALES_LABEL2_COL", "SUCURSALES_LABEL2_COL"], DEFAULT_CONFIG.sucursalesLabel2Column),
    sucursalesNameColumn: firstEnv(["PORTAL_SUCURSALES_NAME_COL", "WHATSAPP_CAP_SUCURSALES_NAME_COL", "SUCURSALES_NAME_COL"], DEFAULT_CONFIG.sucursalesNameColumn),
    sucursalesTiendaColumn: firstEnv(["PORTAL_SUCURSALES_TIENDA_COL", "WHATSAPP_CAP_SUCURSALES_TIENDA_COL", "SUCURSALES_TIENDA_COL"], DEFAULT_CONFIG.sucursalesTiendaColumn),
  };
}

function getGoogleConfig() {
  return {
    clientId: firstEnv(["PORTAL_GOOGLE_CLIENT_ID"], ""),
    clientSecret: firstEnv(["PORTAL_GOOGLE_CLIENT_SECRET"], ""),
    redirectUri: firstEnv(
      ["PORTAL_GOOGLE_REDIRECT_URI"],
      "https://apps.desarrolloeg.com/auth/google/callback"
    ),
    allowedDomains: splitCsv(firstEnv(["PORTAL_GOOGLE_ALLOWED_DOMAINS"], "")),
  };
}

export function isGoogleOAuthConfigured() {
  const config = getGoogleConfig();
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

function createGoogleOAuthClient(redirectUriOverride = "") {
  const config = getGoogleConfig();
  const redirectUri = String(redirectUriOverride || config.redirectUri || "").trim();
  if (!config.clientId || !config.clientSecret || !redirectUri) {
    throw new Error("Falta configurar Google OAuth para el portal");
  }

  return new google.auth.OAuth2(config.clientId, config.clientSecret, redirectUri);
}

function buildStateCookieHeader(token, { secure = false } = {}) {
  const maxAge = 600;
  const parts = [
    `${getScopedCookieName(GOOGLE_STATE_COOKIE_NAME)}=${encodeURIComponent(token)}`,
    `Path=${getScopedCookiePath()}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function buildClearStateCookieHeader({ secure = false } = {}) {
  const parts = [
    `${getScopedCookieName(GOOGLE_STATE_COOKIE_NAME)}=`,
    `Path=${getScopedCookiePath()}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function buildGoogleAuthUrl(state, redirectUriOverride = "") {
  const oauthClient = createGoogleOAuthClient(redirectUriOverride);
  return oauthClient.generateAuthUrl({
    scope: GOOGLE_OAUTH_SCOPES,
    state,
  });
}

export async function exchangeGoogleAuthCode(code, redirectUriOverride = "") {
  const oauthClient = createGoogleOAuthClient(redirectUriOverride);
  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);

  const idTokenPayload = decodeJwtPayload(tokens.id_token);
  let profile = null;
  if (idTokenPayload) {
    const audience = String(idTokenPayload.aud || "");
    const clientId = getGoogleConfig().clientId;
    const email = normalizeEmail(idTokenPayload.email);
    if (clientId && audience && audience !== clientId) {
      throw new Error("El token de Google no coincide con la app configurada.");
    }
    if (email) {
      profile = {
        email,
        name: String(idTokenPayload.name || "").trim(),
        picture: String(idTokenPayload.picture || "").trim(),
        email_verified: true,
      };
    }
  }

  if (!profile) {
    const accessToken = tokens.access_token;
    if (!accessToken) {
      throw new Error("Google no devolvio access_token.");
    }

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!profileResponse.ok) {
      throw new Error(`No se pudo leer el perfil de Google (${profileResponse.status})`);
    }

    const remoteProfile = await profileResponse.json();
    profile = {
      email: normalizeEmail(remoteProfile.email),
      name: String(remoteProfile.name || "").trim(),
      picture: String(remoteProfile.picture || "").trim(),
      email_verified: remoteProfile.email_verified,
    };
  }

  const email = normalizeEmail(profile.email);
  if (!email) {
    throw new Error("Google no entrego un correo valido.");
  }

  const allowedDomains = getGoogleConfig().allowedDomains;
  if (allowedDomains.length > 0) {
    const domain = email.split("@")[1] || "";
    if (!allowedDomains.some((allowedDomain) => domain === normalizeEmail(allowedDomain) || domain.endsWith(`.${normalizeEmail(allowedDomain)}`))) {
      throw new Error("Tu cuenta de Google no pertenece a un dominio autorizado.");
    }
  }

  return {
    email,
    name: String(profile.name || "").trim(),
    picture: String(profile.picture || "").trim(),
  };
}

function getAppSheetUrl(config, table = config.table) {
  return `https://www.appsheet.com/api/v2/apps/${config.appId}/tables/${encodeURIComponent(table)}/Action`;
}

function getCacheKey(runAsUserEmail = "") {
  return normalizeEmail(runAsUserEmail) || "__default__";
}

function getCachedEntry(cache, runAsUserEmail = "") {
  return cache.entries.get(getCacheKey(runAsUserEmail)) || null;
}

function setCachedEntry(cache, runAsUserEmail = "", entry = {}) {
  cache.entries.set(getCacheKey(runAsUserEmail), entry);
}

function findCachedEmployeeByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  for (const entry of EMPLOYEE_CACHE.entries.values()) {
    if (!entry?.rows?.length) continue;
    const found = entry.rows.find((item) => item.correo === normalizedEmail);
    if (found) return found;
  }
  return null;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APPSHEET_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetryAppSheetError(error) {
  const code = error?.code || error?.cause?.code || error?.errno;
  return error?.name === "AbortError" || ["ENOBUFS", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH"].includes(code);
}

function getRetryDelayMs(attempt) {
  const exp = Math.min(APPSHEET_RETRY_BASE_MS * Math.pow(2, attempt - 1), APPSHEET_RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * 200);
  return exp + jitter;
}

async function fetchWithRetry(url, options = {}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await fetchWithTimeout(url, options);
    } catch (error) {
      if (!shouldRetryAppSheetError(error) || attempt >= APPSHEET_MAX_RETRIES) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(attempt)));
    }
  }
}

function extractAppSheetDataRows(data) {
  return Array.isArray(data) ? data : Array.isArray(data?.Rows) ? data.Rows : [];
}

function getFlexibleValue(row, candidates = []) {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const value = row?.[candidate];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
    if (row && typeof row === "object") {
      const matchKey = Object.keys(row).find((key) => normalizeLabelToken(key) === normalizeLabelToken(candidate));
      const matchValue = matchKey ? row[matchKey] : undefined;
      if (matchValue !== undefined && matchValue !== null && String(matchValue).trim() !== "") {
        return matchValue;
      }
    }
  }
  return "";
}

function normalizeSucursal(row = {}) {
  const config = getConfig();
  const key = String(getFlexibleValue(row, [config.sucursalesKeyColumn, "Row ID", "ROW ID", "ID", "Id", "id"])).trim();
  const label = String(getFlexibleValue(row, [config.sucursalesLabelColumn, "LABEL", "Label"])).trim();
  const label2 = String(getFlexibleValue(row, [config.sucursalesLabel2Column, "LABEL2", "Label2", "LABEL 2", "Label 2", "label2"])).trim();
  const name = String(getFlexibleValue(row, [config.sucursalesNameColumn, "NOMBRE", "Nombre"])).trim();
  const tienda = String(getFlexibleValue(row, [config.sucursalesTiendaColumn, "TIENDA", "Tienda"])).trim();
  const labelLooksLikeKey = Boolean(label) && (label === key || /^[0-9]+\b/.test(label) || /^[0-9]+$/.test(label));
  const visibleFallback = [label2, name, tienda, label, key].find((value) => String(value || "").trim()) || key;

  return {
    key,
    label,
    label2,
    name,
    tienda,
    displayLabel: (labelLooksLikeKey ? visibleFallback : label) || visibleFallback,
    raw: row,
  };
}

async function appsheetAction({ table, action, rows = [], selector, runAsUserEmail = "" }) {
  const config = getConfig();
  if (!config.appId || !config.accessKey) {
    throw new Error("Faltan credenciales de AppSheet para el portal");
  }

  const body = {
    Action: action,
    Properties: {
      Locale: "es-MX",
      Timezone: "America/Mexico_City",
    },
  };

  if (selector) {
    body.Properties.Selector = selector;
  }
  if (runAsUserEmail) {
    body.Properties.RunAsUserEmail = normalizeEmail(runAsUserEmail);
  }
  if (rows.length > 0) {
    body.Rows = rows;
  }

  const response = await fetchWithRetry(getAppSheetUrl(config, table), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ApplicationAccessKey: config.accessKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`AppSheet respondio ${response.status}: ${await response.text()}`);
  }

  const raw = String(await response.text() || "").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function fetchEmployeesFromAppSheet(force = false, runAsUserEmail = "") {
  const now = Date.now();
  const sharedCached = getSharedCacheEntry(EMPLOYEE_CACHE);
  if (!force && sharedCached?.rows?.length > 0 && now - sharedCached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    EMPLOYEE_CACHE.nameByKey = sharedCached.nameByKey;
    EMPLOYEE_CACHE.initialsByKey = sharedCached.initialsByKey;
    EMPLOYEE_CACHE.colorByKey = sharedCached.colorByKey;
    if (runAsUserEmail) {
      setCachedEntry(EMPLOYEE_CACHE, runAsUserEmail, sharedCached);
    }
    return sharedCached.rows;
  }

  const cached = getCachedEntry(EMPLOYEE_CACHE, runAsUserEmail);
  if (!force && cached?.rows?.length > 0 && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    EMPLOYEE_CACHE.nameByKey = cached.nameByKey;
    EMPLOYEE_CACHE.initialsByKey = cached.initialsByKey;
    return cached.rows;
  }

  if (!force) {
    const persistent = readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.employees, runAsUserEmail);
    if (persistent?.rows?.length > 0 && now - persistent.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
      EMPLOYEE_CACHE.nameByKey = persistent.nameByKey;
      EMPLOYEE_CACHE.initialsByKey = persistent.initialsByKey;
      EMPLOYEE_CACHE.colorByKey = persistent.colorByKey;
      return persistent.rows;
    }
  }

  if (!force && EMPLOYEE_CACHE.pending) {
    return EMPLOYEE_CACHE.pending;
  }

  EMPLOYEE_CACHE.pending = (async () => {
    try {
      const rows = readLocalPortalRows(
        `SELECT id, row_id, nombre, puesto, correo, firma, telefono, telefono_2, capacita, permiso, color, cumpleanos, iniciales
           FROM empleados
          ORDER BY nombre ASC, id ASC`,
        [],
        mapLocalEmployeeRow,
      );
      const currentYear = new Date().getFullYear();
      const normalized = rows.map((row) => {
        const employee = normalizeEmployee(row);
        if (!employee.rowId) return null;

        const rawBirthday = String(getFlexibleValue(row, ["CUMPLEAÑOS", "Cumpleaños", "Cumpleanos", "BIRTHDAY", "Birthday", "FECHA NACIMIENTO", "Fecha Nacimiento"]) ?? "").trim();
        const normalizedBirthday = normalizeBirthdayValue(rawBirthday, currentYear);
        employee.cumpleanos = normalizedBirthday.value;
        employee.cumpleanosRaw = rawBirthday;
        employee.cumpleanosDate = normalizedBirthday.parsed;

        return employee;
      }).filter(Boolean);

      const nameByKey = new Map();
      const initialsByKey = new Map();
      const colorByKey = new Map();
      for (const employee of normalized) {
        nameByKey.set(employee.rowId, employee.nombre);
        initialsByKey.set(employee.rowId, employee.initials || buildInitialsFromName(employee.nombre));
        colorByKey.set(employee.rowId, employee.calendarColor || employee.color || "");
      }
      const cacheEntry = {
        loadedAt: Date.now(),
        rows: normalized,
        nameByKey,
        initialsByKey,
        colorByKey,
      };
      setCachedEntry(EMPLOYEE_CACHE, runAsUserEmail, cacheEntry);
      setSharedCacheEntry(EMPLOYEE_CACHE, cacheEntry);
      setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.employees, "shared", {
        loadedAt: cacheEntry.loadedAt,
        rows: cacheEntry.rows,
      }, {
        ttlMs: EMPLOYEE_CACHE_TTL_MS,
        source: LOCAL_DB_SOURCE,
        meta: createRowsSnapshot(cacheEntry.rows, (row) => row?.rowId || row?.correo || ""),
      });
      EMPLOYEE_CACHE.nameByKey = nameByKey;
      EMPLOYEE_CACHE.initialsByKey = initialsByKey;
      EMPLOYEE_CACHE.colorByKey = colorByKey;
      return normalized;
    } finally {
      EMPLOYEE_CACHE.pending = null;
    }
  })();

  return EMPLOYEE_CACHE.pending;
}

async function fetchEmployeeByEmailFromAppSheet(email, runAsUserEmail = "") {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const cachedEmployee = findCachedEmployeeByEmail(normalizedEmail);
  if (cachedEmployee) {
    return cachedEmployee;
  }

  const persistent = readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.employees, runAsUserEmail);
  if (persistent?.rows?.length) {
    const persistentEmployee = persistent.rows.find((item) => normalizeEmail(item.correo) === normalizedEmail);
    if (persistentEmployee) {
      return persistentEmployee;
    }
  }

  const sharedCached = getSharedCacheEntry(EMPLOYEE_CACHE);
  if (sharedCached?.rows?.length) {
    const sharedEmployee = sharedCached.rows.find((item) => normalizeEmail(item.correo) === normalizedEmail);
    if (sharedEmployee) {
      return sharedEmployee;
    }
  }

  const cached = getCachedEntry(EMPLOYEE_CACHE, runAsUserEmail);
  if (cached?.rows?.length) {
    const cachedEmployee = cached.rows.find((item) => normalizeEmail(item.correo) === normalizedEmail);
    if (cachedEmployee) {
      return cachedEmployee;
    }
  }

  const row = readLocalPortalRow(
    `SELECT id, row_id, nombre, puesto, correo, firma, telefono, telefono_2, capacita, permiso, color, cumpleanos, iniciales
       FROM empleados
      WHERE lower(correo) = lower(?)
      LIMIT 1`,
    [normalizedEmail],
    mapLocalEmployeeRow,
  );
  if (!row) {
    return null;
  }

  const employee = normalizeEmployee(row);
  if (!employee.rowId) {
    return null;
  }

  setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.employees, "shared", {
    loadedAt: Date.now(),
    rows: [employee, ...(getPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.employees, "shared", { allowStale: true })?.payload?.rows || []).filter((item) => item?.correo !== normalizedEmail)],
  }, {
    ttlMs: EMPLOYEE_CACHE_TTL_MS,
    source: LOCAL_DB_SOURCE,
    meta: createRowsSnapshot([employee], (row) => row?.rowId || row?.correo || ""),
  });

  return employee;
}

function buildPersonCalendarInitials(value) {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const firstName = parts[0];
  const firstSurname = parts.length >= 3 ? parts[parts.length - 2] : parts[1] || "";
  return `${firstName[0] || ""}${firstSurname[0] || ""}`.toUpperCase();
}

function normalizeEmpresa(row = {}) {
  const key = String(row.id || row.row_id || row.ID || row["Row ID"] || "").trim();
  const razonSocial = String(row.razon_social || row["RAZON SOCIAL"] || "").trim();
  const nombreComercial = String(row.nombre_comercial || row["NOMBRE COMERCIAL"] || razonSocial || key).trim();
  return {
    key,
    razonSocial,
    nombreComercial,
    logo: String(row.logo_url || row.logo || row.LOGOURL || row.LOGO || "").trim(),
    raw: row,
  };
}

function parseOperationalDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const slash = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return new Date(year, month - 1, day).getTime();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function deriveOperationalCapacitacionStatus(value) {
  const timestamp = parseOperationalDate(value);
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const today = new Date();
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return today.getTime() > date.getTime() ? "FINALIZADA" : "PROGRAMADA";
}

function setLatestBySucursal(target, row, dateValue) {
  const key = String(row?.sucursal_id || "").trim();
  if (!key) return;
  const score = parseOperationalDate(dateValue) || Number(row?.anio || 0);
  const current = target.get(key);
  if (!current || score >= current.score) target.set(key, { row, score });
}

function normalizeOperationalText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isCompletedTrabajoStatus(value) {
  return ["EN DRIVE", "IMPRESO", "ENTREGADO"].includes(normalizeOperationalText(value).trim());
}

function classifyPedidoType(row = {}) {
  const description = normalizeOperationalText(`${row.descripcion || ""} ${row.descripcion_complementaria || ""}`);
  if (/MUN(?:I|U)CIPAL/.test(description)) return "MUNICIPAL";
  if (/\bEST(?:ATAL)?\b/.test(description)) return "ESTATAL";
  if (description.includes("PIPC") && /CAPACITACION/.test(description)) return "ESTATAL";
  return "";
}

function buildOperationalSucursalContext() {
  const sucursales = getSucursalesLocalRows();
  const sucursalById = new Map(sucursales.map((row) => [String(row.id || "").trim(), row]));
  const latestEstatal = new Map();
  const latestMunicipal = new Map();
  for (const row of getEstatalesLocalRows()) {
    if (isCompletedTrabajoStatus(row.pipc)) setLatestBySucursal(latestEstatal, row, row.fecha);
  }
  for (const row of getMunicipalesLocalRows()) {
    if (isCompletedTrabajoStatus(row.plan_de_contingencia)) setLatestBySucursal(latestMunicipal, row, row.fecha);
  }

  const latestPedidoEstatal = new Map();
  const latestPedidoMunicipal = new Map();
  const currentYear = new Date().getFullYear();
  for (const row of getPedidosLeyLocalRows()) {
    const key = String(row?.tienda || "").trim();
    if (!key) continue;
    const score = parseOperationalDate(row.fecha);
    if (!score || new Date(score).getFullYear() !== currentYear) continue;
    const type = classifyPedidoType(row);
    const target = type === "ESTATAL" ? latestPedidoEstatal : type === "MUNICIPAL" ? latestPedidoMunicipal : null;
    if (!target) continue;
    const current = target.get(key);
    if (!current || score >= current.score) target.set(key, { row, score });
  }

  const empleados = new Map();
  for (const row of getEmpleadosLocalRows()) {
    const name = String(row.nombre || "").trim();
    for (const key of [row.row_id, row.id]) {
      if (key) empleados.set(String(key).trim(), name || String(key).trim());
    }
  }
  const capacitadoresByCapacitacion = new Map();
  for (const bridge of getCapacitacionCapacitadoresLocalRows()) {
    const capId = String(bridge.capacitacion_id || "").trim();
    const empleadoId = String(bridge.empleado_id || "").trim();
    if (!capId || !empleadoId) continue;
    if (!capacitadoresByCapacitacion.has(capId)) capacitadoresByCapacitacion.set(capId, new Set());
    capacitadoresByCapacitacion.get(capId).add(empleados.get(empleadoId) || empleadoId);
  }
  const capacitaciones = new Map(getCapacitacionesLocalRows().map((row) => [String(row.id || "").trim(), row]));
  const latestCapacitacion = new Map();
  for (const bridge of getCapacitacionSucursalesLocalRows()) {
    const sucursalId = String(bridge.sucursal_id || "").trim();
    const capId = String(bridge.capacitacion_id || "").trim();
    const cap = capacitaciones.get(capId);
    if (!sucursalId || !cap) continue;
    const score = parseOperationalDate(cap.fecha_capacitacion);
    const current = latestCapacitacion.get(sucursalId);
    if (!current || score >= current.score) {
      latestCapacitacion.set(sucursalId, {
        row: cap,
        score,
        capacitadores: [...(capacitadoresByCapacitacion.get(capId) || [])],
      });
    }
  }
  const latestPcEstatal = readPcEstatalStatusBySucursal(new Date().getFullYear());
  return { sucursalById, latestEstatal, latestMunicipal, latestPedidoEstatal, latestPedidoMunicipal, latestCapacitacion, latestPcEstatal };
}

function enrichSucursalesWithLocalCatalogs(rows = []) {
  const municipios = new Map(readLocalRows("SELECT id, nombre, escudo FROM municipios").map((row) => [String(row.id), row]));
  const estados = new Map(readLocalRows("SELECT id, nombre, escudo FROM estados").map((row) => [String(row.id), row]));
  const empresas = new Map(readLocalRows("SELECT id, razon_social, nombre_comercial FROM empresas").map((row) => [String(row.id), row]));
  const operational = buildOperationalSucursalContext();
  return rows.map((sucursal) => {
    const sucursalId = String(sucursal?.key || sucursal?.raw?.id || sucursal?.raw?.ID || "").trim();
    const operationalRow = operational.sucursalById.get(sucursalId) || {};
    const populatedOperationalRow = Object.fromEntries(Object.entries(operationalRow).filter(([, value]) => (
      value !== null && value !== undefined && String(value).trim() !== ""
    )));
    const raw = { ...(sucursal?.raw || {}), ...populatedOperationalRow };
    const empresaId = String(raw.empresa_id || raw.EMPRESA || raw["ID EMPRESA"] || "").trim();
    const municipioId = String(raw.municipio_id || raw.MUNICIPIO || "").trim();
    const estadoId = String(raw.estado_id || raw.ESTADO || "").trim();
    const empresa = empresas.get(empresaId);
    raw.empresa_nombre = String(empresa?.razon_social || raw.empresa_nombre || "").trim();
    raw.empresa_nombre_comercial = String(empresa?.nombre_comercial || raw.empresa_nombre_comercial || "").trim();
    const municipio = municipios.get(municipioId);
    const estado = estados.get(estadoId);
    raw.municipio_nombre = String(municipio?.nombre || raw.municipio_nombre || "").trim();
    raw.municipio_escudo = String(municipio?.escudo || raw.municipio_escudo || "").trim();
    raw.estado_nombre = String(estado?.nombre || raw.estado_nombre || "").trim();
    raw.estado_escudo = String(estado?.escudo || raw.estado_escudo || "").trim();
    const estatal = operational.latestEstatal.get(sucursalId)?.row;
    const municipal = operational.latestMunicipal.get(sucursalId)?.row;
    const pedidoEstatal = operational.latestPedidoEstatal.get(sucursalId)?.row;
    const pedidoMunicipal = operational.latestPedidoMunicipal.get(sucursalId)?.row;
    const capacitacion = operational.latestCapacitacion.get(sucursalId);
    const pcEstatal = operational.latestPcEstatal.get(sucursalId);
    raw.ultimo_pipc_estatal = String(estatal?.anio || estatal?.fecha || "").trim();
    raw.estatus_pipc_estatal = String(estatal?.pipc || "").trim();
    raw.ultimo_municipal = String(municipal?.anio || municipal?.fecha || "").trim();
    raw.estatus_municipal = String(municipal?.plan_de_contingencia || "").trim();
    raw.pedido_estatal = String(pedidoEstatal?.pedido || "").trim();
    raw.fecha_pedido_estatal = String(pedidoEstatal?.fecha || "").trim();
    raw.pedido_municipal = String(pedidoMunicipal?.pedido || "").trim();
    raw.fecha_pedido_municipal = String(pedidoMunicipal?.fecha || "").trim();
    if (pcEstatal) {
      raw.pc_estatal_status = pcEstatal.status;
      raw.pc_estatal_fecha = pcEstatal.registroFecha;
      raw.pc_estatal_solicitud_id = pcEstatal.solicitudId;
      raw.pc_estatal_motivo = pcEstatal.motivo;
      raw.pc_estatal_vigencia = pcEstatal.vigenciaFecha;
    }
    if (capacitacion?.row) {
      const capDate = String(capacitacion.row.fecha_capacitacion || "").trim();
      raw.fecha_ultima_capacitacion = capDate;
      raw.status_capacitacion = deriveOperationalCapacitacionStatus(capDate) || String(capacitacion.row.status || "").trim();
      raw.capacitadores = capacitacion.capacitadores.join(", ") || String(raw.capacitadores || "").trim();
    }
    const displayLabel = String(raw.label || raw.label2 || raw.nombre || sucursal.displayLabel || sucursalId).trim();
    return {
      ...sucursal,
      label: String(raw.label || sucursal.label || "").trim(),
      label2: String(raw.label2 || sucursal.label2 || "").trim(),
      name: String(raw.nombre || sucursal.name || "").trim(),
      tienda: String(raw.tienda || sucursal.tienda || "").trim(),
      displayLabel,
      raw,
    };
  });
}

async function fetchSucursalesFromAppSheet(force = false, runAsUserEmail = "") {
  const now = Date.now();
  const sharedCached = getSharedCacheEntry(SUCURSAL_CACHE);
  if (!force && sharedCached?.rows?.length > 0 && now - sharedCached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    SUCURSAL_CACHE.labelByKey = sharedCached.labelByKey;
    SUCURSAL_CACHE.keyByLabel = sharedCached.keyByLabel;
    if (runAsUserEmail) {
      setCachedEntry(SUCURSAL_CACHE, runAsUserEmail, sharedCached);
    }
    return sharedCached.rows;
  }

  const cached = getCachedEntry(SUCURSAL_CACHE, runAsUserEmail);
  if (!force && cached?.rows?.length > 0 && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    SUCURSAL_CACHE.labelByKey = cached.labelByKey;
    return cached.rows;
  }

  if (!force) {
    const persistent = readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.sucursales, runAsUserEmail);
    if (persistent?.rows?.length > 0 && now - persistent.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
      SUCURSAL_CACHE.labelByKey = persistent.labelByKey;
      SUCURSAL_CACHE.keyByLabel = persistent.keyByLabel;
      return persistent.rows;
    }
  }

  const rows = readLocalPortalRows(
    `SELECT id,
            '' AS label,
            '' AS label2,
            nombre,
            tienda,
            empresa_id,
            municipio_id,
            estado_id,
            COALESCE(direccion, '') AS direccion,
            lat,
            lng,
            drive,
            mes_planeacion,
            capacitadores
       FROM sucursales
      ORDER BY tienda ASC, nombre ASC, id ASC`,
    [],
    mapLocalSucursalRow,
  );
  const normalized = rows.map(normalizeSucursal).filter((sucursal) => sucursal.key);
  const labelByKey = new Map();
  const keyByLabel = new Map();
  for (const sucursal of normalized) {
    labelByKey.set(sucursal.key, sucursal.displayLabel || sucursal.key);
    const visibleLabels = [sucursal.label, sucursal.label2, sucursal.name, sucursal.tienda, sucursal.displayLabel]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    for (const label of visibleLabels) {
      keyByLabel.set(normalizeLabelToken(label), sucursal.key);
    }
  }

  const cacheEntry = {
    loadedAt: now,
    rows: normalized,
    labelByKey,
    keyByLabel,
  };
  setCachedEntry(SUCURSAL_CACHE, runAsUserEmail, cacheEntry);
  setSharedCacheEntry(SUCURSAL_CACHE, cacheEntry);
  setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.sucursales, "shared", {
    loadedAt: cacheEntry.loadedAt,
    rows: cacheEntry.rows,
  }, {
    ttlMs: EMPLOYEE_CACHE_TTL_MS,
    source: LOCAL_DB_SOURCE,
    meta: createRowsSnapshot(cacheEntry.rows, (row) => row?.key || row?.id || ""),
  });
  SUCURSAL_CACHE.labelByKey = labelByKey;
  SUCURSAL_CACHE.keyByLabel = keyByLabel;
  return normalized;
}

function normalizeEmployee(row = {}) {
  const config = getConfig();
  const rowId = String(row[config.keyColumn] ?? row["Row ID"] ?? row.ID ?? row.id ?? "").trim();
  const nombre = String(row[config.nameColumn] ?? row.NOMBRE ?? "").trim();
  const initials = String(row[config.initialsColumn] ?? row.INICIALES ?? "").trim() || buildInitialsFromName(nombre);
  const puesto = String(row[config.puestoColumn] ?? row.PUESTO ?? "").trim();
  const correo = normalizeEmail(row[config.emailColumn] ?? row.CORREO ?? "");
  const rawColor = String(getFlexibleValue(row, [config.colorColumn, "COLOR", "Color", "color"])).trim();
  const color = rawColor;
  const calendarColor = rawColor || pickCalendarColor(getCalendarColorSeed({ rowId, correo, nombre, puesto }));
  const permiso = String(row[config.permisoColumn] ?? row.PERMISO ?? "").trim();
  const firma = String(row[config.firmaColumn] ?? row.FIRMA ?? "").trim();
  const telefono = String(row[config.phoneColumn1] ?? row.TELEFONO ?? "").trim();
  const telefono2 = String(row[config.phoneColumn2] ?? row["TELEFONO 2"] ?? "").trim();
  const capacita = parseBoolean(row[config.capacitaColumn] ?? row.CAPACITA ?? false);
  const accessProfile = resolvePortalAccessProfile({ puesto, capacita });
  const role = accessProfile.role;

  return {
    rowId,
    nombre,
    initials,
    puesto,
    correo,
    color,
    calendarColor,
    permiso,
    firma,
    telefono,
    telefono2,
    capacita,
    cumpleanos: "",
    role,
    accessProfile,
    raw: row,
  };
}

function resolveRole(employee) {
  return resolvePortalAccessProfile(employee).role;
}

function isAllowedRole(role) {
  return role === "admin" || role === "capacitador";
}

function buildSessionPayload(employee) {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_HOURS * 60 * 60 * 1000;
  return {
    rowId: employee.rowId,
    correo: employee.correo,
    nombre: employee.nombre,
    puesto: employee.puesto,
    role: employee.role,
    accessProfileKey: employee.accessProfile?.key || resolvePortalAccessProfile(employee).key,
    iat: now,
    exp: expiresAt,
  };
}

function signSessionPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  if (!token) return null;
  const [body, signature] = String(token).split(".");
  if (!body || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  const safeA = Buffer.from(signature);
  const safeB = Buffer.from(expectedSignature);
  if (safeA.length !== safeB.length || !crypto.timingSafeEqual(safeA, safeB)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
    if (!payload?.rowId || !payload?.correo) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const cookies = {};
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.split("=");
    if (!key) continue;
    cookies[key.trim()] = decodeURIComponent(rest.join("=").trim() || "");
  }
  return cookies;
}

export function getSessionCookieName({ portalBasePath = undefined } = {}) {
  return getScopedCookieName(COOKIE_NAME, portalBasePath);
}

export function getOAuthStateCookieName({ portalBasePath = undefined } = {}) {
  return getScopedCookieName(GOOGLE_STATE_COOKIE_NAME, portalBasePath);
}

export function buildCookieHeader(token, { secure = false } = {}) {
  const maxAge = Math.max(1, Math.floor(SESSION_TTL_HOURS * 60 * 60));
  const parts = [
    `${getSessionCookieName()}=${encodeURIComponent(token)}`,
    `Path=${getScopedCookiePath()}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookieHeader({ secure = false } = {}) {
  const parts = [
    `${getSessionCookieName()}=`,
    `Path=${getScopedCookiePath()}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildOAuthStateCookieHeader(token, { secure = false } = {}) {
  return buildStateCookieHeader(token, { secure });
}

export function buildClearOAuthStateCookieHeader({ secure = false } = {}) {
  return buildClearStateCookieHeader({ secure });
}

export function isQaAccessEnabled() {
  return QA_ACCESS_ENABLED && Boolean(QA_ACCESS_TOKEN);
}

export function verifyQaAccessToken(token) {
  return isQaAccessEnabled() && String(token || "").trim() === QA_ACCESS_TOKEN;
}

export function buildQaAccessEmployee() {
  if (!isQaAccessEnabled()) {
    throw new Error("El acceso QA no esta habilitado.");
  }

  const correo = QA_ACCESS_EMAIL || "qa-access@desarrolloeg.com";
  const puesto = QA_ACCESS_PUESTO || "MEJORA CONTINUA";
  const accessProfile = resolvePortalAccessProfile({ puesto, capacita: false });
  return {
    rowId: QA_ACCESS_ROW_ID || "qa-access",
    correo,
    nombre: QA_ACCESS_NAME || "QA Admin",
    puesto,
    role: accessProfile.role,
    initials: buildInitialsFromName(QA_ACCESS_NAME || correo),
    color: "",
    calendarColor: "",
    permiso: "",
    firma: "",
    telefono: "",
    telefono2: "",
    capacita: false,
    cumpleanos: "",
    accessProfile,
    raw: null,
  };
}

function getRequestHostname(req) {
  const rawHost = String(req?.headers?.host || "").trim().toLowerCase();
  if (rawHost.startsWith("[")) {
    return rawHost.slice(1, rawHost.indexOf("]"));
  }
  return rawHost.split(":")[0];
}

export function isDevelopmentAuthBypassRequest(req) {
  if (!DEV_AUTH_BYPASS_ENABLED) return false;
  if (String(process.env.APP_ENVIRONMENT || "").trim().toLowerCase() !== "dev") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(getRequestHostname(req));
}

function buildDevelopmentAccessEmployee() {
  const correo = normalizeEmail(process.env.PORTAL_DEV_AUTH_EMAIL || QA_ACCESS_EMAIL || "dev@localhost");
  const nombre = String(process.env.PORTAL_DEV_AUTH_NAME || "Desarrollo Local").trim();
  const puesto = String(process.env.PORTAL_DEV_AUTH_PUESTO || "MEJORA CONTINUA").trim();
  const accessProfile = resolvePortalAccessProfile({ puesto, capacita: false });
  return {
    rowId: String(process.env.PORTAL_DEV_AUTH_ROW_ID || "local-development").trim(),
    correo,
    nombre,
    puesto,
    role: accessProfile.role,
    initials: buildInitialsFromName(nombre),
    color: "",
    calendarColor: "",
    permiso: "",
    firma: "",
    telefono: "",
    telefono2: "",
    capacita: false,
    cumpleanos: "",
    accessProfile,
    raw: null,
  };
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return req.secure || forwardedProto === "https";
}

export async function authenticateEmployeeByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Escribe un correo valido.");
  }

  const employee = await fetchEmployeeByEmailFromAppSheet(normalizedEmail);
  if (!employee) {
    throw new Error("No encontramos ese correo en EMPLEADOS.");
  }

  if (!isAllowedRole(employee.role)) {
    throw new Error("Tu puesto no tiene acceso a este portal.");
  }

  return employee;
}

export async function loadAuthenticatedEmployee(req) {
  if (isDevelopmentAuthBypassRequest(req)) {
    return buildDevelopmentAccessEmployee();
  }

  const cookies = parseCookies(req);
  const token = cookies[getSessionCookieName({ portalBasePath: req?.portalBasePath })];
  const payload = verifySessionToken(token);
  if (!payload) return null;

  // Prefer the signed session payload so the critical login path does not wait on AppSheet.
  // We still merge cached data when available, but avoid a live roundtrip unless the session is invalid.
  const cachedEmployee = findCachedEmployeeByEmail(payload.correo);
  if (cachedEmployee && cachedEmployee.rowId === String(payload.rowId) && isAllowedRole(cachedEmployee.role)) {
    return cachedEmployee;
  }

  if (!isAllowedRole(payload.role)) return null;

  return {
    rowId: String(payload.rowId),
    correo: normalizeEmail(payload.correo),
    nombre: String(payload.nombre || "").trim(),
    puesto: String(payload.puesto || "").trim(),
    role: payload.role,
    initials: buildInitialsFromName(payload.nombre || payload.correo),
    color: "",
    calendarColor: "",
    permiso: "",
    firma: "",
    telefono: "",
    telefono2: "",
    capacita: payload.role === "capacitador",
    cumpleanos: "",
    accessProfile: resolvePortalAccessProfile({
      puesto: payload.puesto,
      capacita: payload.role === "capacitador",
    }),
    raw: null,
  };
}

export async function createSessionForEmployee(employee) {
  const payload = buildSessionPayload(employee);
  return signSessionPayload(payload);
}

export function isRequestSecure(req) {
  return isSecureRequest(req);
}

export async function refreshEmployeesCache() {
  return fetchEmployeesFromAppSheet(true);
}

export async function reconcilePortalCaches({ runAsUserEmail = "" } = {}) {
  const tasks = await Promise.allSettled([
    (async () => {
      const existing = getPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.employees, "shared", { allowStale: true });
      const rows = await fetchEmployeesFromAppSheet(true, runAsUserEmail);
      const snapshot = createRowsSnapshot(rows, (row) => row?.rowId || row?.correo || "");
      const matched = Boolean(
        existing?.meta &&
        Number(existing.meta.rowCount || 0) === snapshot.rowCount &&
        String(existing.meta.lastRowKey || "") === snapshot.lastRowKey &&
        String(existing.meta.lastRowHash || "") === snapshot.lastRowHash
      );
      if (!matched) {
        setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.employees, "shared", { loadedAt: Date.now(), rows }, {
          ttlMs: EMPLOYEE_CACHE_TTL_MS,
          source: "appsheet",
          meta: snapshot,
        });
      }
      return { table: "EMPLEADOS", changed: !matched, matched, rows: rows.length };
    })(),
    (async () => {
      const existing = getPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.sucursales, "shared", { allowStale: true });
      const rows = await fetchSucursalesFromAppSheet(true, runAsUserEmail);
      const snapshot = createRowsSnapshot(rows, (row) => row?.key || row?.id || "");
      const matched = Boolean(
        existing?.meta &&
        Number(existing.meta.rowCount || 0) === snapshot.rowCount &&
        String(existing.meta.lastRowKey || "") === snapshot.lastRowKey &&
        String(existing.meta.lastRowHash || "") === snapshot.lastRowHash
      );
      if (!matched) {
        setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.sucursales, "shared", { loadedAt: Date.now(), rows }, {
          ttlMs: EMPLOYEE_CACHE_TTL_MS,
          source: "appsheet",
          meta: snapshot,
        });
      }
      return { table: "SUCURSALES", changed: !matched, matched, rows: rows.length };
    })(),
    (async () => {
      const existing = getPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.capacitaciones, "shared", { allowStale: true });
      const rows = await fetchCapacitacionesFromAppSheet(true, runAsUserEmail);
      const snapshot = createRowsSnapshot(rows, (row) => row?.rowId || row?.id || "");
      const matched = Boolean(
        existing?.meta &&
        Number(existing.meta.rowCount || 0) === snapshot.rowCount &&
        String(existing.meta.lastRowKey || "") === snapshot.lastRowKey &&
        String(existing.meta.lastRowHash || "") === snapshot.lastRowHash
      );
      if (!matched) {
        setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.capacitaciones, "shared", { loadedAt: Date.now(), rows }, {
          ttlMs: EMPLOYEE_CACHE_TTL_MS,
          source: "appsheet",
          meta: snapshot,
        });
      }
      return { table: "CAPACITACIONES", changed: !matched, matched, rows: rows.length };
    })(),
    (async () => {
      const existing = getPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.calendarNotes, "shared", { allowStale: true });
      const rows = await fetchCalendarNotesFromAppSheet(true, runAsUserEmail);
      const snapshot = createRowsSnapshot(rows, (row) => row?.rowId || row?.id || "");
      const matched = Boolean(
        existing?.meta &&
        Number(existing.meta.rowCount || 0) === snapshot.rowCount &&
        String(existing.meta.lastRowKey || "") === snapshot.lastRowKey &&
        String(existing.meta.lastRowHash || "") === snapshot.lastRowHash
      );
      if (!matched) {
        setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.calendarNotes, "shared", { loadedAt: Date.now(), rows }, {
          ttlMs: EMPLOYEE_CACHE_TTL_MS,
          source: "appsheet",
          meta: snapshot,
        });
      }
      return { table: "CALENDARIO", changed: !matched, matched, rows: rows.length };
    })(),
    fetchPedidosLeyAdminDashboardData({ year: new Date().getFullYear(), forceRefresh: true }).catch(() => null),
  ]);

  return {
    cache: getPersistentCacheSummary(),
    results: tasks.map((result) => {
      if (result.status === "fulfilled") {
        return {
          ok: true,
          ...(result.value && typeof result.value === "object" ? result.value : {}),
        };
      }
      return {
        ok: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason || "Error"),
      };
    }),
  };
}

export async function warmPortalDashboardCaches() {
  await reconcilePortalCaches();
}

export async function listEmployeesForPortal({ runAsUserEmail = "" } = {}) {
  try {
    const employees = await fetchEmployeesFromAppSheet(false, runAsUserEmail);
    return employees.filter((employee) => isAllowedRole(employee.role));
  } catch (error) {
    const persistent = readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.employees, runAsUserEmail);
    const rows = persistent?.rows || getSharedCacheEntry(EMPLOYEE_CACHE)?.rows || [];
    if (rows.length) {
      return rows.filter((employee) => isAllowedRole(employee.role));
    }
    console.warn("No se pudieron cargar los empleados del portal:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function listSucursalesForPortal({ runAsUserEmail = "" } = {}) {
  try {
    return enrichSucursalesWithLocalCatalogs(await fetchSucursalesFromAppSheet(false, runAsUserEmail));
  } catch (error) {
    const persistent = readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.sucursales, runAsUserEmail);
    const rows = persistent?.rows || getSharedCacheEntry(SUCURSAL_CACHE)?.rows || [];
    if (rows.length) return enrichSucursalesWithLocalCatalogs(rows);
    console.warn("No se pudieron cargar las sucursales del portal:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function listEmpresasForPortal() {
  return readLocalRows(`
    SELECT id, razon_social, nombre_comercial, logo
    FROM empresas
    ORDER BY COALESCE(NULLIF(nombre_comercial, ''), razon_social, id)
  `).map(normalizeEmpresa).filter((empresa) => empresa.key);
}

export async function getEmpresaLogoForPortal(empresaId) {
  const id = String(empresaId || "").trim();
  if (!id) return null;
  const row = readLocalRow("SELECT logo FROM empresas WHERE id = ? LIMIT 1", [id]);
  const fileName = String(row?.logo_url || row?.logo || "").trim();
  if (!fileName) return null;

  const config = getConfig();
  const sourceUrl = /^https?:\/\//i.test(fileName)
    ? fileName
    : `https://www.appsheet.com/template/gettablefileurl?appName=${encodeURIComponent(config.appId)}&tableName=EMPRESAS&fileName=${encodeURIComponent(fileName)}&ApplicationAccessKey=${encodeURIComponent(config.accessKey)}`;
  const response = await fetchWithTimeout(sourceUrl, {
    headers: { Accept: "image/*" },
  });
  if (!response.ok) return null;
  return {
    contentType: response.headers.get("content-type") || "image/png",
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

export async function getTerritoryShieldForPortal(kind, territoryId) {
  const table = kind === "estado" ? "estados" : kind === "municipio" ? "municipios" : "";
  const id = String(territoryId || "").trim();
  if (!table || !id) return null;
  const cacheKey = `${table}:${id}`;
  if (TERRITORY_SHIELD_CACHE.has(cacheKey)) return TERRITORY_SHIELD_CACHE.get(cacheKey);
  const row = readLocalRow(`SELECT nombre, escudo FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  const fileName = String(row?.escudo || "").trim();
  if (!fileName) return null;
  const config = getConfig();
  const tableName = table === "estados" ? "ESTADOS" : "MUNICIPIOS";
  const sourceUrl = /^https?:\/\//i.test(fileName)
    ? fileName
    : `https://www.appsheet.com/template/gettablefileurl?appName=${encodeURIComponent(config.appId)}&tableName=${tableName}&fileName=${encodeURIComponent(fileName)}&ApplicationAccessKey=${encodeURIComponent(config.accessKey)}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchWithTimeout(sourceUrl, { headers: { Accept: "image/*" } });
    if (response.ok) {
      const shield = {
        contentType: response.headers.get("content-type") || "image/png",
        bytes: Buffer.from(await response.arrayBuffer()),
      };
      TERRITORY_SHIELD_CACHE.set(cacheKey, shield);
      return shield;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  const initials = String(row?.nombre || id).trim().slice(0, 2).toUpperCase().replace(/[<>&"']/g, "");
  const fallback = {
    contentType: "image/svg+xml",
    bytes: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="#eef3f8"/><path d="M48 14 78 25v22c0 19-12 30-30 36C30 77 18 66 18 47V25z" fill="#fff" stroke="#1a2a3a" stroke-width="3"/><text x="48" y="55" text-anchor="middle" font-family="Arial,sans-serif" font-size="21" font-weight="700" fill="#1a2a3a">${initials}</text></svg>`),
  };
  TERRITORY_SHIELD_CACHE.set(cacheKey, fallback);
  return fallback;
}

function splitStatusValue(value) {
  const text = String(value ?? "").trim();
  if (/^-?\s*PROGRAMADA$/i.test(text)) {
    return { prefix: "", suffix: "PROGRAMADA" };
  }
  if (/^-?\s*FINALIZADA$/i.test(text)) {
    return { prefix: "", suffix: "FINALIZADA" };
  }
  const match = text.match(/^(.*?)\s*-\s*(PROGRAMADA|FINALIZADA)$/i);
  if (!match) {
    return {
      prefix: text,
      suffix: "",
    };
  }

  return {
    prefix: match[1].trim(),
    suffix: match[2].toUpperCase(),
  };
}

function getCapacitacionPrefix(row, employeeLookups) {
  const config = getConfig();
  const assignedKeys = extractListTokens(row[config.capacitacionesCapacitadoresColumn]);

  if (!assignedKeys.length) {
    return "PENDIENTE";
  }

  const firstKey = assignedKeys[0];
  const employeeName = employeeLookups.nameByKey.get(firstKey) || "";
  const initials = buildPersonCalendarInitials(employeeName)
    || employeeLookups.initialsByKey.get(firstKey)
    || buildInitialsFromName(firstKey);

  return initials || "PENDIENTE";
}

function normalizeLabelToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function resolveSucursalDisplay(value, sucursalLookups, { exclude = [] } = {}) {
  const tokens = extractListTokens(value);
  if (!tokens.length) {
    return {
      tokens: [],
      labels: [],
      display: "",
    };
  }

  const excludeTokens = new Set(exclude.flatMap((item) => extractListTokens(item).map(normalizeLabelToken)));
  const labels = [];
  for (const token of tokens) {
    const normalizedToken = normalizeLabelToken(token);
    const resolvedKey = sucursalLookups?.keyByLabel?.get(normalizedToken);
    const label = String(
      (resolvedKey ? sucursalLookups?.labelByKey?.get(resolvedKey) : "") ||
      sucursalLookups?.labelByKey?.get(token) ||
      token
    ).trim();
    if (!label) continue;
    const normalizedLabel = normalizeLabelToken(label);
    if (excludeTokens.has(normalizedLabel) || excludeTokens.has(normalizedToken)) continue;
    labels.push(label);
  }
  return {
    tokens,
    labels,
    display: labels.join(" · "),
  };
}

function resolveCapacitacionNotesColumn(row = {}) {
  const config = getConfig();
  const candidates = [
    config.capacitacionesNotesColumn,
    "NOTAS",
    "Notas",
    "NOTA",
    "Nota",
    "OBSERVACIONES",
    "Observaciones",
    "OBSERVACION",
    "Observacion",
    "OBSERVACIÓN",
    "Observación",
    "COMMENTS",
    "COMMENTS ",
    "COMMENT",
    "Comment",
  ];
  for (const candidate of candidates) {
    const match = getFlexibleValue(row, [candidate]);
    if (match !== undefined && match !== null && String(match).trim() !== "") {
      return candidate;
    }
    if (row && typeof row === "object") {
      const matchKey = Object.keys(row).find((key) => normalizeLabelToken(key) === normalizeLabelToken(candidate));
      if (matchKey) return matchKey;
    }
  }
  return config.capacitacionesNotesColumn || "NOTAS";
}

function normalizeCapacitacion(row, employeeLookups, sucursalLookups) {
  const config = getConfig();
  const rowId = String(row[config.capacitacionesKeyColumn] ?? row["Row ID"] ?? row.ID ?? row.id ?? "").trim();
  const capacitacionId = String(row.ID ?? row.id ?? row["ID"] ?? row["id"] ?? rowId).trim();
  const status = String(row[config.capacitacionesStatusColumn] ?? "").trim();
  const parsedStatus = splitStatusValue(status);
  const dateValue = String(row[config.capacitacionesDateColumn] ?? "").trim();
  const horaInicio = String(row[config.capacitacionesHourStartColumn] ?? row["HORA INICIO"] ?? "").trim();
  const horaFin = String(row[config.capacitacionesHourEndColumn] ?? row["HORA FIN"] ?? "").trim();
  const notesColumn = resolveCapacitacionNotesColumn(row);
  const notas = String(getFlexibleValue(row, [notesColumn, config.capacitacionesNotesColumn, "NOTAS", "Notas", "OBSERVACIONES", "OBSERVACION", "NOTA", "COMMENT", "COMMENTS"])).trim();
  const dateObject = parseDateValue(dateValue);
  const diplomasValue = row[config.capacitacionesDiplomasColumn]
    ?? row.DIPLOMAS
    ?? row.DIPLOMA
    ?? row.CONSTANCIAS
    ?? row.CONSTANCIA
    ?? row.PDF
    ?? row.HTML
    ?? row.CERTIFICADOS
    ?? row.CERTIFICADO;
  const assignedKeys = extractListTokens(row[config.capacitacionesCapacitadoresColumn]);
  const cedeRaw = String(row[config.capacitacionesCedeColumn] ?? "").trim();
  const cedeResolved = resolveSucursalDisplay(cedeRaw, sucursalLookups);
  const sucursalesResolved = resolveSucursalDisplay(row[config.capacitacionesSucursalesColumn], sucursalLookups);
  const derivedStatusSuffix = deriveCapacitacionStatusFromDate(dateObject);
  const statusPrefix = getCapacitacionPrefix(row, employeeLookups);
  const statusSuffix = derivedStatusSuffix || parsedStatus.suffix || "";
  const statusLabel = statusSuffix
    ? (statusPrefix && statusPrefix !== "PENDIENTE" ? `${statusPrefix} - ${statusSuffix}` : statusSuffix)
    : (status ? status : "Sin estado");

  const uniqueAssignedKeys = [...new Set(assignedKeys)].sort((a, b) => a.localeCompare(b, "es"));
  const capacitadores = uniqueAssignedKeys.map((key) => {
    const nombre = employeeLookups.nameByKey.get(key) || key;
    const color = employeeLookups.colorByKey?.get(key) || "";
    return {
      key,
      nombre,
      initials: employeeLookups.initialsByKey.get(key) || buildInitialsFromName(nombre),
      color,
      textColor: getReadableTextColor(color),
    };
  });
  const primaryCapacitador = capacitadores.find((item) => String(item.color || "").trim()) || capacitadores[0] || null;

  return {
    rowId,
    id: capacitacionId || rowId,
    dateRaw: dateValue,
    dateLabel: dateObject ? dateObject.toLocaleDateString("es-MX") : dateValue,
    horaInicio,
    horaFin,
    notas,
    cede: cedeRaw,
    cedeLabel: cedeResolved.display || cedeRaw,
    cedeTokens: cedeResolved.tokens,
    sucursales: String(row[config.capacitacionesSucursalesColumn] ?? "").trim(),
    sucursalesLabel: sucursalesResolved.display,
    sucursalesLabels: sucursalesResolved.labels,
    sucursalesTokens: sucursalesResolved.tokens,
    status: statusLabel,
    statusPrefix,
    statusSuffix,
    statusLabel,
    hasDiplomas: hasTruthyValue(diplomasValue),
    capacitadores,
    primaryCapacitadorColor: String(primaryCapacitador?.color || "").trim(),
    raw: row,
  };
}

function buildBirthdayCalendarEvent(employee) {
  const date = parseDateValue(employee?.cumpleanos || employee?.cumpleanosRaw);
  if (!date) return null;

  const calendarColor = String(employee?.calendarColor || employee?.color || "").trim() || pickCalendarColor(employee?.rowId || employee?.nombre || employee?.correo || "");
  return {
    id: `birthday-${employee.rowId}`,
    capacitacionId: `birthday-${employee.rowId}`,
    title: `Cumpleaños de ${employee.nombre || "Empleado"}`,
    start: toLocalDateKey(date),
    allDay: true,
    backgroundColor: "#ffffff",
    borderColor: "#d9e2ec",
    textColor: "#1a2a3a",
    classNames: ["fc-event-birthday"],
    extendedProps: {
      eventType: "birthday",
      statusLabel: "Cumpleaños",
      dateLabel: date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
      notes: "",
      employeeName: employee.nombre || "",
      employeeRole: employee.puesto || "",
      employeeColor: calendarColor,
      employeeColorText: getReadableTextColor(calendarColor),
      employeeInitials: employee.initials || buildInitialsFromName(employee.nombre),
      accentColor: calendarColor,
    },
  };
}

function resolveEmployeesFromTokens(tokens = [], employees = []) {
  const normalizedTokens = Array.isArray(tokens) ? tokens : extractListTokens(tokens);
  if (!normalizedTokens.length || !Array.isArray(employees) || !employees.length) {
    return [];
  }

  const matches = [];
  const seen = new Set();
  for (const token of normalizedTokens) {
    for (const employee of employees) {
      if (!employee || !employee.rowId || seen.has(employee.rowId)) continue;
      if (!employeeMatchesToken(token, employee, {
        nameByKey: EMPLOYEE_CACHE.nameByKey,
        initialsByKey: EMPLOYEE_CACHE.initialsByKey,
      })) {
        continue;
      }
      seen.add(employee.rowId);
      matches.push(employee);
    }
  }
  return matches;
}

function normalizeCalendarNote(row, employeeLookups, employees = []) {
  const config = getConfig();
  const rowId = String(getFlexibleValue(row, [
    config.calendarNotesKeyColumn,
    "Row ID",
    "ROW ID",
    "ID",
    "Id",
    "id",
  ])).trim();
  const dateValue = String(getFlexibleValue(row, [
    config.calendarNotesDateColumn,
    "FECHA",
    "Fecha",
    "DATE",
    "Date",
  ])).trim();
  const title = String(getFlexibleValue(row, [
    config.calendarNotesTitleColumn,
    "TITULO",
    "Titulo",
    "TÍTULO",
    "Título",
    "ASUNTO",
    "Asunto",
    "TITLE",
    "Title",
    "NOMBRE",
    "Nombre",
  ])).trim();
  const notes = String(getFlexibleValue(row, [
    config.calendarNotesNotesColumn,
    "NOTAS",
    "Notas",
    "OBSERVACIONES",
    "Observaciones",
    "OBSERVACION",
    "Observacion",
    "COMMENT",
    "Comment",
    "COMMENTS",
    "Comments",
  ])).trim();
  const icon = String(getFlexibleValue(row, [
    config.calendarNotesIconColumn,
    "ICONO",
    "Icono",
    "ICON",
    "Icon",
    "EMOJI",
    "Emoji",
  ])).trim() || "📝";
  const rawEmployees = getFlexibleValue(row, [
    config.calendarNotesEmployeesColumn,
    "EMPLEADOS",
    "Empleados",
    "CAPACITADORES",
    "Capacitadores",
    "USUARIOS",
    "Usuarios",
  ]);
  const employeeTokens = extractListTokens(rawEmployees);
  const hasGlobalAudience = employeeTokens.some((token) => {
    const normalized = String(token || "").trim().toUpperCase();
    return ["TODOS", "ALL", "TODAS", "*"].includes(normalized);
  });
  const taggedEmployees = hasGlobalAudience ? [] : resolveEmployeesFromTokens(employeeTokens, employees);
  const resolvedAllEmployees = Array.isArray(employees) && employees.length > 0
    ? resolveEmployeesFromTokens(employeeTokens, employees).length === employees.length
    : false;
  const audienceAll = hasGlobalAudience || resolvedAllEmployees;
  const parsedDate = parseDateValue(dateValue);
  const colorSeed = rowId || title || notes || employeeTokens.join("|");
  const color = String(getFlexibleValue(row, [
    config.calendarNotesColorColumn,
    "COLOR",
    "Color",
  ])).trim() || pickCalendarColor(colorSeed, "#b45309");
  const authorId = String(getFlexibleValue(row, ["AUTOR_ID", "autor_id"])).trim();
  const authorName = String(getFlexibleValue(row, ["AUTOR_NOMBRE", "autor_nombre"])).trim();
  const authorEmail = normalizeEmail(getFlexibleValue(row, ["AUTOR_CORREO", "autor_correo"]));

  return {
    rowId,
    id: rowId,
    dateRaw: dateValue,
    dateLabel: parsedDate ? parsedDate.toLocaleDateString("es-MX") : dateValue,
    title: title || "Nota",
    notes,
    author: authorName || authorEmail || "Sin autor registrado",
    authorId,
    authorName,
    authorEmail,
    icon,
    employeeTokens,
    audienceAll,
    employeeKeys: audienceAll ? [] : taggedEmployees.map((employee) => employee.rowId),
    employeeNames: audienceAll
      ? ["TODOS"]
      : taggedEmployees.map((employee) => employee.nombre).filter(Boolean),
    employeeSummaries: audienceAll
      ? [{
          rowId: "TODOS",
          nombre: "TODOS",
          initials: "TODOS",
          color: "#b45309",
          textColor: "#ffffff",
        }]
      : taggedEmployees.map((employee) => ({
          rowId: employee.rowId,
          nombre: employee.nombre,
          initials: employee.initials || buildInitialsFromName(employee.nombre),
          color: employee.calendarColor || employee.color || "",
          textColor: getReadableTextColor(employee.calendarColor || employee.color || ""),
        })),
    color,
    raw: row,
  };
}

function calendarNoteMatchesEmployee(note, employee, employeeLookups) {
  if (!employee) return true;
  if (note?.audienceAll) return true;
  const tokens = Array.isArray(note?.employeeTokens) ? note.employeeTokens : extractListTokens(note?.employeeTokens || note?.employeeNames || note?.employeeKeys || []);
  const hasGlobalAudience = tokens.some((token) => {
    const normalized = String(token || "").trim().toUpperCase();
    return ["TODOS", "ALL", "TODAS", "*"].includes(normalized);
  });
  if (hasGlobalAudience) return true;
  if (!tokens.length) return true;
  return tokens.some((token) => employeeMatchesToken(token, employee, employeeLookups));
}

export function buildCalendarNoteEvent(note, selectedEmployeeId, returnPath) {
  const parsedDate = parseDateValue(note.dateRaw || note.dateLabel);
  if (!parsedDate) return null;
  const textColor = getReadableTextColor(note.color);
  return {
    id: note.rowId,
    capacitacionId: note.rowId,
    title: note.title || "Nota",
    start: toLocalDateKey(parsedDate),
    allDay: true,
    dateRaw: note.dateRaw || "",
    backgroundColor: "#ffffff",
    borderColor: "#d9e2ec",
    textColor: "#1a2a3a",
    classNames: ["fc-event-note"],
    extendedProps: {
      eventType: "calendar-note",
      statusLabel: "Nota",
      dateLabel: note.dateLabel || "",
      dateRaw: note.dateRaw || "",
      notes: note.notes || "",
      noteTitle: note.title || "Nota",
      noteIcon: note.icon || "📝",
      noteId: note.rowId,
      employeeTokens: Array.isArray(note.employeeTokens) ? note.employeeTokens : [],
      employeeKeys: Array.isArray(note.employeeKeys) ? note.employeeKeys : [],
      employeeNames: Array.isArray(note.employeeNames) ? note.employeeNames : [],
      employeeSummaries: Array.isArray(note.employeeSummaries) ? note.employeeSummaries : [],
      audienceAll: Boolean(note.audienceAll),
      author: note.author || "Sin autor registrado",
      authorId: note.authorId || "",
      authorName: note.authorName || "",
      authorEmail: note.authorEmail || "",
      primaryColor: note.color,
      accentColor: note.color,
    },
  };
}

async function fetchCapacitacionesFromAppSheet(force = false, runAsUserEmail = "") {
  const now = Date.now();
  const sharedCached = getSharedCacheEntry(CAPACITACION_CACHE);
  if (!force && sharedCached?.rows?.length > 0 && now - sharedCached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    return sharedCached.rows;
  }

  const cached = getCachedEntry(CAPACITACION_CACHE, runAsUserEmail);
  if (!force && cached?.rows?.length > 0 && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    return cached.rows;
  }

  if (!force) {
    const persistent = readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.capacitaciones, runAsUserEmail);
    if (persistent?.rows?.length > 0 && now - persistent.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
      return persistent.rows;
    }
  }

  try {
    const rows = readLocalPortalRows(
      `SELECT c.id,
              c.id AS row_id,
              c.fecha_capacitacion,
              c.cede_sucursal_id,
              c.cede_sucursal_id AS cede_nombre,
              c.status,
              c.hora_inicio,
              c.hora_fin,
              c.diplomas,
              c.notas,
              COALESCE((
                SELECT group_concat(cs.sucursal_id, ', ')
                  FROM capacitacion_sucursales cs
                 WHERE cs.capacitacion_id = c.id
              ), '') AS sucursales_text,
              COALESCE((
                SELECT group_concat(cc.empleado_id, ', ')
                  FROM capacitacion_capacitadores cc
                 WHERE cc.capacitacion_id = c.id
              ), '') AS capacitadores_text
         FROM capacitaciones c
        ORDER BY c.fecha_capacitacion ASC, c.id ASC`,
      [],
      mapLocalCapacitacionRow,
    );
    await Promise.allSettled([
      fetchEmployeesFromAppSheet(true, runAsUserEmail),
      fetchSucursalesFromAppSheet(true, runAsUserEmail),
    ]);
    const employeeLookups = {
      nameByKey: EMPLOYEE_CACHE.nameByKey,
      initialsByKey: EMPLOYEE_CACHE.initialsByKey,
      colorByKey: EMPLOYEE_CACHE.colorByKey,
    };
    const sucursalLookups = {
      labelByKey: SUCURSAL_CACHE.labelByKey,
    };
    const normalized = rows.map((row) => normalizeCapacitacion(row, employeeLookups, sucursalLookups)).filter((item) => item.rowId);

    setCachedEntry(CAPACITACION_CACHE, runAsUserEmail, {
      loadedAt: now,
      rows: normalized,
    });
    setSharedCacheEntry(CAPACITACION_CACHE, {
      loadedAt: now,
      rows: normalized,
    });
    setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.capacitaciones, "shared", {
      loadedAt: now,
      rows: normalized,
    }, {
      ttlMs: EMPLOYEE_CACHE_TTL_MS,
      source: LOCAL_DB_SOURCE,
      meta: createRowsSnapshot(normalized, (row) => row?.rowId || row?.id || ""),
    });
    clearDashboardCache();
    return normalized;
  } catch (error) {
    const sharedCached = getSharedCacheEntry(CAPACITACION_CACHE);
    if (sharedCached?.rows?.length) {
      console.warn("Usando cache de CAPACITACIONES por error de AppSheet:", error instanceof Error ? error.message : error);
      return sharedCached.rows;
    }
    const cached = getCachedEntry(CAPACITACION_CACHE, runAsUserEmail);
    if (cached?.rows?.length) {
      console.warn("Usando cache local de CAPACITACIONES por error de AppSheet:", error instanceof Error ? error.message : error);
      return cached.rows;
    }
    console.warn("No se pudieron leer las capacitaciones del portal:", error instanceof Error ? error.message : error);
    return [];
  }
}

async function fetchCalendarNotesFromAppSheet(force = false, runAsUserEmail = "") {
  const now = Date.now();
  const sharedCached = getSharedCacheEntry(CALENDAR_NOTE_CACHE);
  if (!force && sharedCached?.rows?.length > 0 && now - sharedCached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    return sharedCached.rows;
  }

  const cached = getCachedEntry(CALENDAR_NOTE_CACHE, runAsUserEmail);
  if (!force && cached?.rows?.length > 0 && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    return cached.rows;
  }

  if (!force) {
    const persistent = readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.calendarNotes, runAsUserEmail);
    if (persistent?.rows?.length > 0 && now - persistent.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
      return persistent.rows;
    }
  }

  const employees = await fetchEmployeesFromAppSheet(false, runAsUserEmail);
  const rows = readLocalPortalRows(
    `SELECT c.id, c.fecha, c.icono, c.titulo, c.notas, c.color,
            ca.creado_por_id, ca.creado_por_nombre, ca.creado_por_correo,
            group_concat(ce.empleado_id, ', ') AS empleados
       FROM calendario c
       LEFT JOIN calendario_empleados ce ON ce.calendario_id = c.id
       LEFT JOIN calendario_autores ca ON ca.calendario_id = c.id
      GROUP BY c.id, c.fecha, c.icono, c.titulo, c.notas, c.color,
               ca.creado_por_id, ca.creado_por_nombre, ca.creado_por_correo
      ORDER BY c.fecha ASC, c.id ASC`,
    [],
    mapLocalCalendarNoteRow,
  );
  const employeeLookups = {
    nameByKey: EMPLOYEE_CACHE.nameByKey,
    initialsByKey: EMPLOYEE_CACHE.initialsByKey,
  };
  const normalized = rows
    .map((row) => normalizeCalendarNote(row, employeeLookups, employees))
    .filter((item) => item.rowId);

  setCachedEntry(CALENDAR_NOTE_CACHE, runAsUserEmail, {
    loadedAt: now,
    rows: normalized,
  });
  setSharedCacheEntry(CALENDAR_NOTE_CACHE, {
    loadedAt: now,
    rows: normalized,
  });
  setPersistentCacheEntry(PORTAL_CACHE_NAMESPACES.calendarNotes, "shared", {
    loadedAt: now,
    rows: normalized,
  }, {
    ttlMs: EMPLOYEE_CACHE_TTL_MS,
    source: LOCAL_DB_SOURCE,
    meta: createRowsSnapshot(normalized, (row) => row?.rowId || row?.id || ""),
  });
  clearDashboardCache();
  return normalized;
}

async function saveCalendarNote(noteData, runAsUserEmail = "") {
  const config = getConfig();
  if (!config.calendarNotesTable) {
    throw new Error("No hay una tabla de calendario configurada.");
  }

  const dateValue = String(noteData?.dateRaw || noteData?.dateLabel || noteData?.fecha || noteData?.fechaRaw || "").trim();
  const parsedDate = parseDateValue(dateValue) || new Date();
  const normalizedDate = toLocalDateKey(parsedDate);
  const title = String(noteData?.title || noteData?.titulo || "Nota").trim() || "Nota";
  const notes = String(noteData?.notes || noteData?.notas || "").trim();
  const employeeValues = Array.isArray(noteData?.employees) ? noteData.employees : extractListTokens(noteData?.employees || noteData?.empleados || []);
  const employees = await fetchEmployeesFromAppSheet(false, runAsUserEmail);
  const normalizedEmployeeValues = employeeValues
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const hasGlobalAudience = normalizedEmployeeValues.some((value) => ["TODOS", "ALL", "TODAS", "*"].includes(value.toUpperCase()));
  const resolvedEmployees = hasGlobalAudience ? employees : resolveEmployeesFromTokens(normalizedEmployeeValues, employees);
  const employeeFieldValue = resolvedEmployees.length
    ? resolvedEmployees.map((employee) => employee.rowId).join(", ")
    : hasGlobalAudience
      ? "TODOS"
      : normalizedEmployeeValues.length
        ? normalizedEmployeeValues.join(", ")
        : "";
  const icon = String(noteData?.icon || noteData?.icono || noteData?.ICONO || "").trim() || "📝";
  const color = String(noteData?.color || noteData?.COLOR || "").trim() || pickCalendarColor(title || notes || normalizedDate, "#b45309");
  const currentRowId = String(noteData?.rowId || noteData?.id || "").trim();
  const payload = {
    [config.calendarNotesDateColumn || "FECHA"]: normalizedDate,
    [config.calendarNotesIconColumn || "ICONO"]: icon,
    [config.calendarNotesTitleColumn || "TITULO"]: title,
    [config.calendarNotesNotesColumn || "NOTAS"]: notes,
    [config.calendarNotesEmployeesColumn || "EMPLEADOS"]: employeeFieldValue,
    [config.calendarNotesColorColumn || "COLOR"]: color,
  };

  const savedRowId = currentRowId || String(payload[config.calendarNotesKeyColumn || "ID"] || crypto.randomUUID()).trim();
  payload[config.calendarNotesKeyColumn || "ID"] = savedRowId;

  if (currentRowId) {
    await appsheetAction({
      table: config.calendarNotesTable,
      action: "Edit",
      rows: [payload],
      runAsUserEmail,
    });
  } else {
    await appsheetAction({
      table: config.calendarNotesTable,
      action: "Add",
      rows: [payload],
      runAsUserEmail,
    });
  }

  upsertCalendarNoteAuthor(savedRowId, noteData?.author, { isNew: !currentRowId });

  await fetchCalendarNotesFromAppSheet(true, runAsUserEmail);
  return payload;
}

export async function getCapacitacionesDashboardData({ viewer = null, selectedEmployee = null } = {}) {
  const runAsUserEmail = normalizeEmail(viewer?.correo || selectedEmployee?.correo || "");
  const viewerRole = viewer?.role || "capacitador";
  const selectedRole = selectedEmployee?.role || viewerRole;
  const selectedRowId = String(selectedEmployee?.rowId || viewer?.rowId || "").trim();
  const dashboardCacheKey = getDashboardCacheKey(viewerRole, selectedRowId || selectedRole);
  const now = Date.now();
  const cached = DASHBOARD_CACHE.entries.get(dashboardCacheKey);
  if (cached?.data && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    return cached.data;
  }

  const [rowsResult, employeesResult, calendarNotesResult] = await Promise.allSettled([
    fetchCapacitacionesFromAppSheet(false, runAsUserEmail),
    fetchEmployeesFromAppSheet(false, runAsUserEmail),
    fetchCalendarNotesFromAppSheet(false, runAsUserEmail),
  ]);

  const rows = rowsResult.status === "fulfilled" ? rowsResult.value : [];
  const employees = employeesResult.status === "fulfilled" ? employeesResult.value : (readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.employees, runAsUserEmail)?.rows || []);
  const calendarNotesRows = calendarNotesResult.status === "fulfilled" ? calendarNotesResult.value : (readCachedRowsFromPersistent(PORTAL_CACHE_NAMESPACES.calendarNotes, runAsUserEmail)?.rows || []);

  const localThreadNotes = listPortalNoteEntries({
    entityType: "capacitacion",
    entityIds: rows.map((row) => row.rowId),
  });
  const notesByCapacitacion = new Map();
  localThreadNotes.forEach((note) => {
    if (!notesByCapacitacion.has(note.entityId)) notesByCapacitacion.set(note.entityId, []);
    notesByCapacitacion.get(note.entityId).push(note);
  });
  const enrichedRows = rows.map((row) => ({
    ...row,
    threadNotes: notesByCapacitacion.get(row.rowId) || [],
  }));

  const visible = enrichedRows.filter((row) => {
    if (viewerRole === "admin") {
      if (selectedRole === "capacitador" && selectedRowId) {
        return capacitacionMatchesEmployee(row.raw, selectedEmployee, {
          nameByKey: EMPLOYEE_CACHE.nameByKey,
          initialsByKey: EMPLOYEE_CACHE.initialsByKey,
        });
      }
      return true;
    }

    if (!selectedRowId) return false;
    return capacitacionMatchesEmployee(row.raw, selectedEmployee, {
      nameByKey: EMPLOYEE_CACHE.nameByKey,
      initialsByKey: EMPLOYEE_CACHE.initialsByKey,
    });
  });

  const programadas = visible
    .filter((row) => row.statusSuffix === "PROGRAMADA")
    .sort((a, b) => {
      const aDate = new Date(a.dateRaw || 0);
      const bDate = new Date(b.dateRaw || 0);
      return aDate - bDate;
    });

  const finalizadasSinDiplomas = visible
    .filter((row) => row.statusSuffix === "FINALIZADA" && !row.hasDiplomas)
    .sort((a, b) => {
      const aDate = new Date(a.dateRaw || 0);
      const bDate = new Date(b.dateRaw || 0);
      return aDate - bDate;
    });

  const calendarCapacitaciones = enrichedRows
    .filter((row) => row.dateRaw)
    .sort((a, b) => {
      const aDate = new Date(a.dateRaw || 0);
      const bDate = new Date(b.dateRaw || 0);
      return aDate - bDate;
    });

  const birthdayEvents = employees
    .map(buildBirthdayCalendarEvent)
    .filter(Boolean)
    .sort((a, b) => {
      const aDate = new Date(a.start || 0);
      const bDate = new Date(b.start || 0);
      const aName = String(a?.extendedProps?.employeeName || a?.title || "");
      const bName = String(b?.extendedProps?.employeeName || b?.title || "");
      const byDate = aDate - bDate;
      return byDate !== 0 ? byDate : aName.localeCompare(bName, "es");
    });

  const calendarNotes = calendarNotesRows
    .filter((note) => {
      if (!selectedRowId) return viewerRole === "admin";
      const employeeMatches = calendarNoteMatchesEmployee(note, selectedEmployee, {
        nameByKey: EMPLOYEE_CACHE.nameByKey,
        initialsByKey: EMPLOYEE_CACHE.initialsByKey,
      });
      if (viewerRole === "admin" && selectedRole !== "capacitador") {
        return true;
      }
      return employeeMatches;
    })
    .sort((a, b) => {
      const aDate = parseDateValue(a.dateRaw || a.dateLabel)?.getTime() || 0;
      const bDate = parseDateValue(b.dateRaw || b.dateLabel)?.getTime() || 0;
      return aDate - bDate;
    });

  const dashboardData = {
    visible,
    programadas,
    finalizadasSinDiplomas,
    birthdayEvents,
    calendarCapacitaciones,
    calendarNotes,
  };
  DASHBOARD_CACHE.entries.set(dashboardCacheKey, {
    loadedAt: now,
    data: dashboardData,
  });
  return dashboardData;
}

export async function listCapacitacionesForPortal({ viewer = null, selectedEmployee = null } = {}) {
  const { programadas } = await getCapacitacionesDashboardData({ viewer, selectedEmployee });
  return programadas;
}

export async function listCapacitacionesFinalizadasSinDiplomasForPortal({ viewer = null, selectedEmployee = null } = {}) {
  const { finalizadasSinDiplomas } = await getCapacitacionesDashboardData({ viewer, selectedEmployee });
  return finalizadasSinDiplomas;
}

export async function updateCapacitacionStatus(rowId, nextSuffix, runAsUserEmail = "") {
  const config = getConfig();
  const targetRowId = String(rowId || "").trim();
  const suffix = String(nextSuffix || "").trim().toUpperCase();
  if (!targetRowId) {
    throw new Error("No se pudo identificar la capacitación.");
  }
  if (!["PROGRAMADA", "FINALIZADA"].includes(suffix)) {
    throw new Error("Estado invalido.");
  }

  const rows = await fetchCapacitacionesFromAppSheet(false, runAsUserEmail);
  const current = rows.find((item) => item.rowId === targetRowId);
  if (!current) {
    throw new Error("No encontramos la capacitación solicitada.");
  }

  const prefix = current.statusPrefix || "PENDIENTE";
  const nextStatus = `${prefix} - ${suffix}`;
  const currentCapacitacionId = String(current.id || "").trim();
  if (!currentCapacitacionId) {
    throw new Error("La capacitación no tiene un ID editable para AppSheet.");
  }
  await appsheetAction({
    table: config.capacitacionesTable,
    action: "Edit",
    rows: [
      {
        [config.capacitacionesIdColumn || "ID"]: currentCapacitacionId,
        [config.capacitacionesStatusColumn]: nextStatus,
      },
    ],
  });

  await fetchCapacitacionesFromAppSheet(true, runAsUserEmail);
  return nextStatus;
}

export async function updateCapacitacionDiplomas(rowId, hasDiplomas, runAsUserEmail = "") {
  const config = getConfig();
  const targetRowId = String(rowId || "").trim();
  if (!targetRowId) {
    throw new Error("No se pudo identificar la capacitación.");
  }

  const nextValue = hasTruthyValue(hasDiplomas) ? "Y" : "N";
  const rows = await fetchCapacitacionesFromAppSheet(false, runAsUserEmail);
  const current = rows.find((item) => item.rowId === targetRowId);
  if (!current) {
    throw new Error("No encontramos la capacitación solicitada.");
  }
  const currentCapacitacionId = String(current.id || "").trim();
  if (!currentCapacitacionId) {
    throw new Error("La capacitación no tiene un ID editable para AppSheet.");
  }

  await appsheetAction({
    table: config.capacitacionesTable,
    action: "Edit",
    rows: [
      {
        [config.capacitacionesIdColumn || "ID"]: currentCapacitacionId,
        [config.capacitacionesDiplomasColumn]: nextValue,
      },
    ],
  });

  await fetchCapacitacionesFromAppSheet(true, runAsUserEmail);
  return nextValue;
}

export async function updateCapacitacionNotas(rowId, notas, runAsUserEmail = "") {
  const config = getConfig();
  const targetRowId = String(rowId || "").trim();
  if (!targetRowId) {
    throw new Error("No se pudo identificar la capacitación.");
  }

  const rows = await fetchCapacitacionesFromAppSheet(false, runAsUserEmail);
  const current = rows.find((item) => item.rowId === targetRowId);
  if (!current) {
    throw new Error("No encontramos la capacitación solicitada.");
  }

  const currentCapacitacionId = String(current.id || "").trim();
  if (!currentCapacitacionId) {
    throw new Error("La capacitación no tiene un ID editable para AppSheet.");
  }
  const notesColumn = resolveCapacitacionNotesColumn(current.raw || current);

  await appsheetAction({
    table: config.capacitacionesTable,
    action: "Edit",
    rows: [
      {
        [config.capacitacionesIdColumn || "ID"]: currentCapacitacionId,
        [notesColumn]: String(notas ?? "").trim(),
      },
    ],
  });

  await fetchCapacitacionesFromAppSheet(true, runAsUserEmail);
  return String(notas ?? "").trim();
}

export async function upsertCalendarNote(noteData, runAsUserEmail = "") {
  return saveCalendarNote(noteData, runAsUserEmail);
}

export async function deleteCalendarNote(noteData, runAsUserEmail = "") {
  const config = getConfig();
  if (!config.calendarNotesTable) {
    throw new Error("No hay una tabla de calendario configurada.");
  }

  const rowId = String(noteData?.rowId || noteData?.id || "").trim();
  if (!rowId) {
    throw new Error("No se pudo identificar la nota a eliminar.");
  }

  await appsheetAction({
    table: config.calendarNotesTable,
    action: "Delete",
    rows: [{
      [config.calendarNotesKeyColumn || "ID"]: rowId,
    }],
    runAsUserEmail,
  });

  deleteCalendarNoteAuthor(rowId);

  await fetchCalendarNotesFromAppSheet(true, runAsUserEmail);
  return { rowId };
}

export function getRouteCardsForRole(role, { portalBasePath = undefined } = {}) {
  const cards = role === "admin" ? GENERAL_ROUTE_CARDS : CAPACITADOR_ROUTE_CARDS;
  return cards.map((card) => ({
    ...card,
    href: portalPath(card.href, portalBasePath),
  }));
}

export function getEmployeeSummary(employee) {
  return {
    rowId: employee.rowId,
    nombre: employee.nombre || "(Sin nombre)",
    puesto: employee.puesto || "(Sin puesto)",
    correo: employee.correo || "(Sin correo)",
    color: employee.color || "",
    calendarColor: employee.calendarColor || employee.color || "",
    permiso: employee.permiso || "",
    firma: employee.firma || "",
    telefono: employee.telefono || "",
    telefono2: employee.telefono2 || "",
    cumpleanos: employee.cumpleanos || "",
    role: employee.role,
    accessProfile: employee.accessProfile || resolvePortalAccessProfile(employee),
    capacita: employee.capacita,
    initials: employee.initials || buildInitialsFromName(employee.nombre),
  };
}

export function createPortalNoteEntry({ entityType, entityId, body, author, mentions = [] } = {}) {
  const note = createLocalPortalNoteEntry({ entityType, entityId, body, author, mentions });
  clearDashboardCache();
  return note;
}

export function listPortalNotes(filters = {}) {
  return listPortalNoteEntries(filters);
}

export function updatePortalNoteEntry(noteId, body) {
  const note = updateLocalPortalNoteEntry(noteId, body);
  clearDashboardCache();
  return note;
}

export function deletePortalNoteEntry(noteId) {
  const result = deleteLocalPortalNoteEntry(noteId);
  clearDashboardCache();
  return result;
}

export function getPortalMeta() {
  return {
    sessionTtlHours: SESSION_TTL_HOURS,
    cacheTtlMs: EMPLOYEE_CACHE_TTL_MS,
    cookieName: COOKIE_NAME,
  };
}

