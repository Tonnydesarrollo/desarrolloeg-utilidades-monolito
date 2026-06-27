import crypto from "crypto";
import { google } from "googleapis";

const EMPLOYEE_CACHE_TTL_MS = Number(process.env.PORTAL_EMPLOYEES_CACHE_TTL_MS || 120000);
const SESSION_TTL_HOURS = Number(process.env.PORTAL_SESSION_TTL_HOURS || 12);
const COOKIE_NAME = process.env.PORTAL_SESSION_COOKIE_NAME || "desarrolloeg_portal_session";
const GOOGLE_STATE_COOKIE_NAME = process.env.PORTAL_GOOGLE_STATE_COOKIE_NAME || "desarrolloeg_portal_oauth_state";
const SESSION_SECRET =
  process.env.PORTAL_AUTH_SECRET ||
  process.env.PORTAL_SESSION_SECRET ||
  process.env.WHATSAPP_CAP_APPSHEET_ACCESS_KEY ||
  process.env.APPSHEET_API_KEY ||
  "desarrolloeg-portal-dev-secret";
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
};

const CAPACITACION_CACHE = {
  entries: new Map(),
};

const CALENDAR_NOTE_CACHE = {
  entries: new Map(),
};

const SUCURSAL_CACHE = {
  entries: new Map(),
};

const ADMIN_PUESTOS = new Set(["GERENTE GENERAL", "DIRECTOR GENERAL", "MEJORA CONTINUA"]);
const CAPACITADOR_PUESTOS = new Set(["CAPACITADOR"]);

const GENERAL_ROUTE_CARDS = [
  {
    tone: "status",
    label: "Monolito",
    title: "Estado general",
    description: "Monitoreo operativo, salud del sistema y accesos rÃ¡pidos a la administraciÃ³n.",
    href: "/status",
  },
  {
    tone: "blue",
    label: "Automatizacion",
    title: "Jobs",
    description: "Ejecuciones manuales y control de sincronizaciones.",
    href: "/jobs",
  },
  {
    tone: "amber",
    label: "Mensajeria",
    title: "WhatsApp Capacitadores",
    description: "SesiÃ³n, QR y estado del bot de capacitadores.",
    href: "/whatsapp-capacitadores",
  },
  {
    tone: "green",
    label: "Planeacion",
    title: "PlaneaciÃ³n Ley",
    description: "Vista operativa para planeaciÃ³n y seguimiento interno.",
    href: "/Planeacion-ley/",
  },
  {
    tone: "violet",
    label: "Documentos",
    title: "Sucursales Docs",
    description: "GeneraciÃ³n de documentos y cartas desde AppSheet.",
    href: "/SUCURSALES-DOCS/",
  },
  {
    tone: "rose",
    label: "Control",
    title: "Faltantes Ley",
    description: "Consulta rÃ¡pida de pendientes y faltantes.",
    href: "/FALTANTES-LEY/",
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
    description: "Consulta por ubicación o domicilio y descarga la página en JPEG.",
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
    label: "Finanzas",
    title: "FacturaciÃ³n",
    description: "Cotizaciones y utilidades de facturaciÃ³n.",
    href: "/facturacion/cotizacion/html",
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
  if (/^(0|false|no|n|none|null|n\/a|na|sin diplomas?|sin diploma|vac[iÃ­]o)$/i.test(normalized)) return false;
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

function createGoogleOAuthClient() {
  const config = getGoogleConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error("Falta configurar Google OAuth para el portal");
  }

  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

function buildStateCookieHeader(token, { secure = false } = {}) {
  const maxAge = 600;
  const parts = [
    `${GOOGLE_STATE_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function buildClearStateCookieHeader({ secure = false } = {}) {
  const parts = [
    `${GOOGLE_STATE_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildGoogleAuthUrl(state) {
  const oauthClient = createGoogleOAuthClient();
  return oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_OAUTH_SCOPES,
    prompt: "consent",
    include_granted_scopes: true,
    state,
  });
}

export async function exchangeGoogleAuthCode(code) {
  const oauthClient = createGoogleOAuthClient();
  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);

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

  const profile = await profileResponse.json();
  const email = normalizeEmail(profile.email);
  const verified = profile.email_verified === true || profile.email_verified === "true";
  if (!email) {
    throw new Error("Google no entrego un correo valido.");
  }
  if (!verified) {
    throw new Error("Tu correo de Google no esta verificado.");
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

  const response = await fetch(getAppSheetUrl(config, table), {
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
  const config = getConfig();
  if (!config.appId || !config.accessKey) {
    throw new Error("Faltan credenciales de AppSheet para el portal");
  }

  const now = Date.now();
  const cached = getCachedEntry(EMPLOYEE_CACHE, runAsUserEmail);
  if (!force && cached?.rows?.length > 0 && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    EMPLOYEE_CACHE.nameByKey = cached.nameByKey;
    EMPLOYEE_CACHE.initialsByKey = cached.initialsByKey;
    return cached.rows;
  }

  const data = await appsheetAction({
    table: config.table,
    action: "Find",
    selector: `Filter(${config.table}, true)`,
    runAsUserEmail,
  });
  const rows = Array.isArray(data) ? data : Array.isArray(data?.Rows) ? data.Rows : [];
  const currentYear = new Date().getFullYear();
  const birthdayColumn = config.birthdayColumn || "CUMPLEAÑOS";
  const birthdaySyncJobs = [];
  const normalized = rows.map((row) => {
    const employee = normalizeEmployee(row);
    if (!employee.rowId) return null;

    const rawBirthday = String(getFlexibleValue(row, [birthdayColumn, "CUMPLEAÑOS", "Cumpleaños", "Cumpleanos", "BIRTHDAY", "Birthday", "FECHA NACIMIENTO", "Fecha Nacimiento"]) ?? "").trim();
    const normalizedBirthday = normalizeBirthdayValue(rawBirthday, currentYear);
    employee.cumpleanos = normalizedBirthday.value;
    employee.cumpleanosRaw = rawBirthday;
    employee.cumpleanosDate = normalizedBirthday.parsed;
    if (normalizedBirthday.value && normalizedBirthday.parsed && normalizedBirthday.parsed.getFullYear() !== currentYear) {
      birthdaySyncJobs.push(
        appsheetAction({
          table: config.table,
          action: "Edit",
          rows: [
            {
              [config.keyColumn || "Row ID"]: employee.rowId,
              [birthdayColumn]: normalizedBirthday.value,
            },
          ],
        }).catch((error) => {
          console.warn("No se pudo actualizar CUMPLEAÑOS en EMPLEADOS:", error instanceof Error ? error.message : error);
        })
      );
    }

    return employee;
  }).filter(Boolean);

  if (birthdaySyncJobs.length > 0) {
    await Promise.allSettled(birthdaySyncJobs);
  }

  const nameByKey = new Map();
  const initialsByKey = new Map();
  const colorByKey = new Map();
  for (const employee of normalized) {
    nameByKey.set(employee.rowId, employee.nombre);
    initialsByKey.set(employee.rowId, employee.initials || buildInitialsFromName(employee.nombre));
    colorByKey.set(employee.rowId, employee.calendarColor || employee.color || "");
  }
  const cacheEntry = {
    loadedAt: now,
    rows: normalized,
    nameByKey,
    initialsByKey,
    colorByKey,
  };
  setCachedEntry(EMPLOYEE_CACHE, runAsUserEmail, cacheEntry);
  EMPLOYEE_CACHE.nameByKey = nameByKey;
  EMPLOYEE_CACHE.initialsByKey = initialsByKey;
  EMPLOYEE_CACHE.colorByKey = colorByKey;
  return normalized;
}

async function fetchSucursalesFromAppSheet(force = false, runAsUserEmail = "") {
  const config = getConfig();
  if (!config.appId || !config.accessKey) {
    throw new Error("Faltan credenciales de AppSheet para el portal");
  }

  const now = Date.now();
  const cached = getCachedEntry(SUCURSAL_CACHE, runAsUserEmail);
  if (!force && cached?.rows?.length > 0 && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    SUCURSAL_CACHE.labelByKey = cached.labelByKey;
    return cached.rows;
  }

  const data = await appsheetAction({
    table: config.sucursalesTable,
    action: "Find",
    selector: `Filter(${config.sucursalesTable}, true)`,
    runAsUserEmail,
  });

  const rows = extractAppSheetDataRows(data);
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
  const role = resolveRole({ puesto, capacita });

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
    raw: row,
  };
}

function resolveRole(employee) {
  const puesto = normalizeText(employee?.puesto);
  if (ADMIN_PUESTOS.has(puesto)) return "admin";
  if (CAPACITADOR_PUESTOS.has(puesto) || employee?.capacita) return "capacitador";
  return "sin-acceso";
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

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export function getOAuthStateCookieName() {
  return GOOGLE_STATE_COOKIE_NAME;
}

export function buildCookieHeader(token, { secure = false } = {}) {
  const maxAge = Math.max(1, Math.floor(SESSION_TTL_HOURS * 60 * 60));
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookieHeader({ secure = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
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

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return req.secure || forwardedProto === "https";
}

export async function authenticateEmployeeByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Escribe un correo valido.");
  }

  const employees = await fetchEmployeesFromAppSheet(false, normalizedEmail);
  const employee = employees.find((item) => item.correo === normalizedEmail);
  if (!employee) {
    throw new Error("No encontramos ese correo en EMPLEADOS.");
  }

  if (!isAllowedRole(employee.role)) {
    throw new Error("Tu puesto no tiene acceso a este portal.");
  }

  return employee;
}

export async function loadAuthenticatedEmployee(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  const payload = verifySessionToken(token);
  if (!payload) return null;

  const employees = await fetchEmployeesFromAppSheet(false, payload.correo);
  const employee = employees.find((item) => item.rowId === String(payload.rowId));
  if (!employee) return null;

  if (!isAllowedRole(employee.role)) return null;
  if (employee.correo !== normalizeEmail(payload.correo)) return null;
  if (employee.role !== payload.role) return null;

  return employee;
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

export async function listEmployeesForPortal({ runAsUserEmail = "" } = {}) {
  const employees = await fetchEmployeesFromAppSheet(false, runAsUserEmail);
  return employees.filter((employee) => isAllowedRole(employee.role));
}

function splitStatusValue(value) {
  const text = String(value ?? "").trim();
  if (/^PROGRAMADA$/i.test(text)) {
    return { prefix: "", suffix: "PROGRAMADA" };
  }
  if (/^FINALIZADA$/i.test(text)) {
    return { prefix: "", suffix: "FINALIZADA" };
  }
  const match = text.match(/^(.*)\s-\s(PROGRAMADA|FINALIZADA)$/i);
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
  const currentStatus = String(row[config.capacitacionesStatusColumn] ?? "").trim();
  const parsed = splitStatusValue(currentStatus);
  if (parsed.prefix) {
    return parsed.prefix;
  }

  const assignedKeys = extractListTokens(row[config.capacitacionesCapacitadoresColumn]);

  if (!assignedKeys.length) {
    return "PENDIENTE";
  }

  const initials = assignedKeys
    .map((key) => employeeLookups.initialsByKey.get(key) || employeeLookups.nameByKey.get(key) || "")
    .map((item) => buildInitialsFromName(item) || String(item).trim().toUpperCase())
    .join("")
    .trim();

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
    status,
    statusPrefix: parsedStatus.prefix || getCapacitacionPrefix(row, employeeLookups),
    statusSuffix: parsedStatus.suffix || "",
    statusLabel: parsedStatus.suffix || (status ? status : "Sin estado"),
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

  return {
    rowId,
    id: rowId,
    dateRaw: dateValue,
    dateLabel: parsedDate ? parsedDate.toLocaleDateString("es-MX") : dateValue,
    title: title || "Nota",
    notes,
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
      primaryColor: note.color,
      accentColor: note.color,
    },
  };
}

async function fetchCapacitacionesFromAppSheet(force = false, runAsUserEmail = "") {
  const config = getConfig();
  if (!config.appId || !config.accessKey) {
    throw new Error("Faltan credenciales de AppSheet para el portal");
  }

  const now = Date.now();
  const cached = getCachedEntry(CAPACITACION_CACHE, runAsUserEmail);
  if (!force && cached?.rows?.length > 0 && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    return cached.rows;
  }

  const data = await appsheetAction({
    table: config.capacitacionesTable,
    action: "Find",
    selector: `Filter(${config.capacitacionesTable}, true)`,
    runAsUserEmail,
  });

  const rows = extractAppSheetDataRows(data);
  await Promise.all([
    fetchEmployeesFromAppSheet(false, runAsUserEmail),
    fetchSucursalesFromAppSheet(false, runAsUserEmail),
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
  return normalized;
}

async function fetchCalendarNotesFromAppSheet(force = false, runAsUserEmail = "") {
  const config = getConfig();
  if (!config.appId || !config.accessKey) {
    throw new Error("Faltan credenciales de AppSheet para el portal");
  }

  const now = Date.now();
  const cached = getCachedEntry(CALENDAR_NOTE_CACHE, runAsUserEmail);
  if (!force && cached?.rows?.length > 0 && now - cached.loadedAt < EMPLOYEE_CACHE_TTL_MS) {
    return cached.rows;
  }

  if (!config.calendarNotesTable) {
    setCachedEntry(CALENDAR_NOTE_CACHE, runAsUserEmail, {
      loadedAt: now,
      rows: [],
    });
    return [];
  }

  const employees = await fetchEmployeesFromAppSheet(false, runAsUserEmail);
  let normalized = [];
  try {
    const data = await appsheetAction({
      table: config.calendarNotesTable,
      action: "Find",
      selector: `Filter(${config.calendarNotesTable}, true)`,
      runAsUserEmail,
    });
    const rows = extractAppSheetDataRows(data);
    const employeeLookups = {
      nameByKey: EMPLOYEE_CACHE.nameByKey,
      initialsByKey: EMPLOYEE_CACHE.initialsByKey,
    };
    normalized = rows
      .map((row) => normalizeCalendarNote(row, employeeLookups, employees))
      .filter((item) => item.rowId);
  } catch (error) {
    console.warn("No se pudieron leer las notas del calendario:", error instanceof Error ? error.message : error);
    normalized = [];
  }

  setCachedEntry(CALENDAR_NOTE_CACHE, runAsUserEmail, {
    loadedAt: now,
    rows: normalized,
  });
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

  if (currentRowId) {
    payload[config.calendarNotesKeyColumn || "ID"] = currentRowId;
    await appsheetAction({
      table: config.calendarNotesTable,
      action: "Edit",
      rows: [payload],
      runAsUserEmail,
    });
  } else {
    payload[config.calendarNotesKeyColumn || "ID"] = crypto.randomUUID();
    await appsheetAction({
      table: config.calendarNotesTable,
      action: "Add",
      rows: [payload],
      runAsUserEmail,
    });
  }

  await fetchCalendarNotesFromAppSheet(true, runAsUserEmail);
  return payload;
}

export async function getCapacitacionesDashboardData({ viewer = null, selectedEmployee = null } = {}) {
  const runAsUserEmail = normalizeEmail(viewer?.correo || selectedEmployee?.correo || "");
  const rows = await fetchCapacitacionesFromAppSheet(false, runAsUserEmail);
  const employees = await fetchEmployeesFromAppSheet(false, runAsUserEmail);
  const calendarNotesRows = await fetchCalendarNotesFromAppSheet(false, runAsUserEmail);
  const viewerRole = viewer?.role || "capacitador";
  const selectedRole = selectedEmployee?.role || viewerRole;
  const selectedRowId = String(selectedEmployee?.rowId || viewer?.rowId || "").trim();

  const visible = rows.filter((row) => {
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

  const calendarCapacitaciones = rows
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

  return {
    visible,
    programadas,
    finalizadasSinDiplomas,
    birthdayEvents,
    calendarCapacitaciones,
    calendarNotes,
  };
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
    throw new Error("No se pudo identificar la capacitaciÃ³n.");
  }
  if (!["PROGRAMADA", "FINALIZADA"].includes(suffix)) {
    throw new Error("Estado invalido.");
  }

  const rows = await fetchCapacitacionesFromAppSheet(false, runAsUserEmail);
  const current = rows.find((item) => item.rowId === targetRowId);
  if (!current) {
    throw new Error("No encontramos la capacitaciÃ³n solicitada.");
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

  await fetchCalendarNotesFromAppSheet(true, runAsUserEmail);
  return { rowId };
}

export function getRouteCardsForRole(role) {
  return role === "admin" ? GENERAL_ROUTE_CARDS : CAPACITADOR_ROUTE_CARDS;
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
    capacita: employee.capacita,
    initials: employee.initials || buildInitialsFromName(employee.nombre),
  };
}

export function getPortalMeta() {
  return {
    sessionTtlHours: SESSION_TTL_HOURS,
    cacheTtlMs: EMPLOYEE_CACHE_TTL_MS,
    cookieName: COOKIE_NAME,
  };
}

