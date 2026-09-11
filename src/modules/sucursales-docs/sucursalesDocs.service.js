import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getCompanyAddressLines } from "../../config/company.js";
import { readLocalOperationalTable } from "../../services/localOperationalRepository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");
const standaloneRoot = path.join(projectRoot, "standalone", "sucursales-docs");
const NAVOLATO_TEMPLATE_ID = "carta-entrega-navolato";
const NAVOLATO_PDF_FILENAME = "CARTA DE ENTREGA ZAPATERIA DLIS.pdf";

const cache = {
  ts: 0,
  rows: [],
};

const relatedCache = {
  ts: 0,
  empresasById: new Map(),
  municipiosById: new Map(),
  estadosById: new Map(),
  employeesById: new Map(),
};

const SUCURSALES_DOCS_CACHE_TTL_MS = Number(process.env.SUCURSALES_DOCS_CACHE_TTL_MS || 5 * 60 * 1000);
const SUCURSALES_DOCS_CACHE_NAMESPACE = "sucursales-docs.tables";

const TRANSPARENT_IMAGE_DATA_URI =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function readEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function getDefaultChromePath() {
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  return "/usr/bin/chromium";
}

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeTokenKey(value) {
  return stripAccents(value)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function normalizeSearch(value) {
  return stripAccents(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toDisplayValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

function toUpperDisplay(value) {
  return toDisplayValue(value).toLocaleUpperCase("es-MX");
}

const SIGNER_NAME_OVERRIDES = new Map([
  ["SERGIO GONZALES GAMEZ", "M.C. SERGIO GONZALES GAMEZ"],
  ["SERGIO GONZALEZ GAMEZ", "M.C. SERGIO GONZALES GAMEZ"],
  ["MORELOS ENRIQUE PEREZ PICOS", "LIC. MORELOS ENRIQUE PEREZ PICOS"],
]);

export function formatSignerDisplayName(value) {
  const displayName = toUpperDisplay(value);
  return SIGNER_NAME_OVERRIDES.get(normalizeSearch(displayName).toUpperCase()) || displayName;
}

function slugify(value) {
  return (
    stripAccents(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "documento"
  );
}

function getFirst(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function normalizeLooseKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFirstFlexible(row, keys) {
  const direct = getFirst(row, keys);
  if (direct !== undefined) return direct;

  const wanted = new Set(keys.map((key) => normalizeLooseKey(key)));
  for (const [key, value] of Object.entries(row || {})) {
    if (!wanted.has(normalizeLooseKey(key))) continue;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function formatCartaMonth(date = new Date()) {
  const months = [
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
  ];
  return `${months[date.getMonth()] || ""} DEL ${date.getFullYear()}`;
}

function formatShortDate(date = new Date()) {
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Mexico_City",
  }).format(date);
}

function formatInputDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Mexico_City",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year || "0000"}-${map.month || "01"}-${map.day || "01"}`;
}

function getConfig() {
  return {
    appsheetAppId: readEnv(
      [
        "DOCS_APPSHEET_APP_ID",
        "WHATSAPP_CAP_APPSHEET_APP_ID",
        "CONSTANCIAS_APPSHEET_APP_ID",
        "PLANEACION_APPSHEET_APP_ID",
        "APPSHEET_APP_ID",
      ],
      ""
    ),
    appsheetAccessKey: readEnv(
      [
        "DOCS_APPSHEET_ACCESS_KEY",
        "DOCS_APPSHEET_API_KEY",
        "WHATSAPP_CAP_APPSHEET_ACCESS_KEY",
        "CONSTANCIAS_APPSHEET_API_KEY",
        "PLANEACION_APPSHEET_API_KEY",
        "APPSHEET_API_KEY",
      ],
      ""
    ),
    appsheetRegion: readEnv(
      ["DOCS_APPSHEET_REGION", "WHATSAPP_CAP_APPSHEET_REGION", "APPSHEET_REGION"],
      "www.appsheet.com"
    ),
    appsheetLocale: readEnv(
      ["DOCS_APPSHEET_LOCALE", "WHATSAPP_CAP_APPSHEET_LOCALE", "APPSHEET_LOCALE"],
      "es-MX"
    ),
    appsheetTimezone: readEnv(
      ["DOCS_APPSHEET_TIMEZONE", "WHATSAPP_CAP_APPSHEET_TIMEZONE", "APPSHEET_TIMEZONE"],
      "America/Mexico_City"
    ),
    appsheetTableSucursales: readEnv(
      ["DOCS_TABLE_SUCURSALES", "WHATSAPP_CAP_TABLE_SUCURSALES"],
      "SUCURSALES"
    ),
    sucursalesIdCol: readEnv(
      ["DOCS_SUCURSALES_ID_COL", "WHATSAPP_CAP_SUCURSALES_KEY_COL"],
      "ID"
    ),
    sucursalesTiendaCol: readEnv(
      ["DOCS_SUCURSALES_TIENDA_COL", "WHATSAPP_CAP_SUCURSALES_TIENDA_COL"],
      "TIENDA"
    ),
    sucursalesNameCol: readEnv(
      ["DOCS_SUCURSALES_NAME_COL", "WHATSAPP_CAP_SUCURSALES_NAME_COL"],
      "LABEL2"
    ),
    chromePath: readEnv(
      ["DOCS_CHROME_PATH", "WHATSAPP_CAP_CHROME_PATH", "CHROME_PATH"],
      getDefaultChromePath()
    ),
    templatePath: path.join(standaloneRoot, "templates", "membrete-eg.html"),
    bodyTemplatePath: path.join(standaloneRoot, "templates", "cuerpo-base.html"),
    brandingPath: path.join(standaloneRoot, "config", "branding.default.json"),
    cartaTemplatePath: path.join(standaloneRoot, "templates", "carta-compromiso-municipal.html"),
    cartaEntregaCuliacanTemplatePath: path.join(standaloneRoot, "templates", "carta-entrega-culiacan.html"),
    cartaEntregaNavolatoTemplatePath: path.join(standaloneRoot, "templates", "carta-entrega-navolato.html"),
    cedulaTemplatePath: path.join(standaloneRoot, "templates", "cedula-simulacro.html"),
    cartaEntregaNavolatoPdfPath: path.join(__dirname, NAVOLATO_PDF_FILENAME),
    cedulaPdfTemplatePath: path.join(projectRoot, "CEDULA DE SIMULACRO - Hoja1 (1).pdf"),
    proteccionCivilLogoPath: readEnv(
      ["DOCS_PROTECCION_CIVIL_LOGO_PATH", "PROTECCION_CIVIL_LOGO_PATH"],
      ""
    ),
    defaultTitle: "Documento",
    defaultSubtitle: "Formato generado desde AppSheet",
  };
}

async function ensureFile(filePath, label) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`No se encontro ${label}: ${filePath}`);
  }
}

async function fileToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".svg"
          ? "image/svg+xml"
          : ext === ".webp"
            ? "image/webp"
            : "application/octet-stream";

  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function dataUriToBuffer(source) {
  const match = String(source || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { mimeType: "", buffer: null };
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function embedImage(pdfDoc, source) {
  const { mimeType, buffer } = dataUriToBuffer(source);
  if (!buffer) return null;
  if (mimeType.includes("png")) return pdfDoc.embedPng(buffer);
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return pdfDoc.embedJpg(buffer);
  return null;
}

async function remoteUrlToDataUri(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen remota: ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function normalizeDriveImageUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  const thumbMatch = value.match(/drive\.google\.com\/thumbnail\?id=([^&]+)/i);
  if (thumbMatch?.[1]) {
    return `https://drive.google.com/thumbnail?id=${thumbMatch[1]}&sz=w1200`;
  }

  const fileMatch = value.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (fileMatch?.[1]) {
    return `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w1200`;
  }

  const openMatch = value.match(/[?&]id=([^&]+)/i);
  if (value.includes("drive.google.com") && openMatch?.[1]) {
    return `https://drive.google.com/thumbnail?id=${openMatch[1]}&sz=w1200`;
  }

  return value;
}

async function resolveImageSource(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  if (rawValue.startsWith("data:")) {
    return rawValue;
  }

  if (/^https?:\/\//i.test(rawValue)) {
    const remoteUrl = normalizeDriveImageUrl(rawValue);
    try {
      return await remoteUrlToDataUri(remoteUrl);
    } catch {
      return remoteUrl;
    }
  }

  const filePath = path.isAbsolute(rawValue) ? rawValue : path.resolve(projectRoot, rawValue);
  try {
    await ensureFile(filePath, "imagen");
    return await fileToDataUri(filePath);
  } catch {
    return rawValue;
  }
}

function getAppSheetFileUrl(config, rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("data:")) return value;

  const fileName = value.includes("::") ? value.split("::").pop().trim() : value;
  if (!fileName || !fileName.includes("/")) return value;

  const appName = encodeURIComponent(config.appsheetAppId);
  const tableName = encodeURIComponent(config.appsheetTableSucursales);
  return `https://${config.appsheetRegion}/template/gettablefileurl?appName=${appName}&tableName=${tableName}&fileName=${encodeURIComponent(fileName)}`;
}

async function resolveSucursalLogoSource(row, config, fallbackLogoDataUri) {
  const logoValue = getFirstFlexible(row, [
    "LOGO",
    "Logo",
    "logo",
    "LOGO URL",
    "Logo URL",
    "URL LOGO",
    "IMAGEN",
    "Imagen",
  ]);

  if (!logoValue) return fallbackLogoDataUri;

  const appSheetUrl = getAppSheetFileUrl(config, logoValue);
  const resolved = await resolveImageSource(appSheetUrl);
  return resolved || fallbackLogoDataUri;
}

async function resolveCedulaBranchLogoSource(row, config) {
  const logoValue = getFirstFlexible(row, [
    "LOGO",
    "Logo",
    "logo",
    "LOGO URL",
    "Logo URL",
    "URL LOGO",
    "IMAGEN",
    "Imagen",
  ]);

  if (!logoValue) return TRANSPARENT_IMAGE_DATA_URI;

  const appSheetUrl = getAppSheetFileUrl(config, logoValue);
  const resolved = await resolveImageSource(appSheetUrl);
  return resolved || TRANSPARENT_IMAGE_DATA_URI;
}

async function buildStaticPdfPreviewHtml({ title, subtitle, pdfUrl, label }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f4f7fa;
      --panel: rgba(255,255,255,0.94);
      --line: #d5dee7;
      --ink: #10202a;
      --muted: #5f7281;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, Arial, sans-serif;
      background: radial-gradient(circle at top left, rgba(15,118,110,0.12), transparent 24%), var(--bg);
      color: var(--ink);
    }
    .shell {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 18px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 24px;
      background: var(--panel);
      box-shadow: 0 20px 50px rgba(16,32,42,0.12);
      overflow: hidden;
    }
    .header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--line);
    }
    .eyebrow {
      margin: 0 0 8px;
      font-size: 0.74rem;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #0f766e;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.5rem, 3vw, 2.2rem);
      line-height: 1.05;
    }
    .subtitle {
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.6;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 16px 24px 0;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .pill {
      padding: 8px 12px;
      border-radius: 999px;
      background: #eef7f6;
      border: 1px solid #d7ece8;
      font-weight: 700;
      color: #0f766e;
    }
    iframe {
      display: block;
      width: 100%;
      min-height: 84vh;
      border: 0;
      background: #fff;
    }
    .footer {
      padding: 14px 24px 20px;
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="card">
      <div class="header">
        <p class="eyebrow">Documento fijo</p>
        <h1>${escapeHtml(title)}</h1>
        <div class="subtitle">${escapeHtml(subtitle)}</div>
      </div>
      <div class="meta">
        <span class="pill">Sucursal: ${escapeHtml(label || "General")}</span>
        <span class="pill">Vista PDF integrada</span>
      </div>
      <iframe src="${escapeHtml(pdfUrl)}" title="${escapeHtml(title)}"></iframe>
      <div class="footer">
        Este formato se muestra como PDF directo porque el ejemplo de Navolato ya existe como archivo final.
      </div>
    </section>
  </div>
</body>
</html>`;
}

async function findFirstExistingFile(filePaths) {
  for (const filePath of filePaths) {
    if (!filePath) continue;
    try {
      await fs.access(filePath);
      return filePath;
    } catch {}
  }
  return "";
}

async function resolveProteccionCivilLogoDataUri(config) {
  const configuredPath = config.proteccionCivilLogoPath
    ? path.resolve(projectRoot, config.proteccionCivilLogoPath)
    : "";
  const candidates = [
    path.join(standaloneRoot, "assets", "proteccion-civil-oficial.png"),
    configuredPath,
    path.join(projectRoot, "proteccion-civil.png"),
    path.join(projectRoot, "proteccion-civil.jpg"),
    path.join(projectRoot, "proteccion-civil.jpeg"),
    path.join(projectRoot, "proteccion-civil.svg"),
    path.join(projectRoot, "proteccion civil.png"),
    path.join(projectRoot, "proteccion civil.jpg"),
    path.join(projectRoot, "proteccion civil.jpeg"),
    path.join(projectRoot, "proteccion civil.svg"),
    path.join(projectRoot, "logo-proteccion-civil.png"),
    path.join(projectRoot, "logo-proteccion-civil.jpg"),
    path.join(projectRoot, "logo-proteccion-civil.jpeg"),
    path.join(projectRoot, "logo-proteccion-civil.svg"),
    path.join(projectRoot, "logo proteccion civil.png"),
    path.join(projectRoot, "logo proteccion civil.jpg"),
    path.join(projectRoot, "logo proteccion civil.jpeg"),
    path.join(projectRoot, "logo proteccion civil.svg"),
    path.join(standaloneRoot, "assets", "proteccion-civil.svg"),
  ];
  const logoPath = await findFirstExistingFile(candidates);
  return logoPath ? fileToDataUri(logoPath) : "";
}

async function fetchTable(config, tableName) {
  void config;
  return readLocalOperationalTable(tableName);
}

async function fetchSucursales(config) {
  const rows = await fetchTable(config, config.appsheetTableSucursales);

  return rows.sort((a, b) => {
    const aTienda = String(a?.[config.sucursalesTiendaCol] ?? "");
    const bTienda = String(b?.[config.sucursalesTiendaCol] ?? "");
    return aTienda.localeCompare(bTienda, "es-MX", { numeric: true, sensitivity: "base" });
  });
}

async function loadSucursales() {
  const config = getConfig();
  const ttlMs = 5 * 60 * 1000;
  if (Date.now() - cache.ts < ttlMs && cache.rows.length) {
    return { config, rows: cache.rows };
  }

  const rows = await fetchSucursales(config);
  cache.ts = Date.now();
  cache.rows = rows;
  return { config, rows };
}

function getLookupId(row, keys = ["ID", "Id", "id"]) {
  return String(getFirstFlexible(row, keys) ?? "").trim();
}

function getEmployeeId(row) {
  return getLookupId(row, ["Row ID", "ROW ID", "ID", "Id", "id"]);
}

async function loadRelatedTables() {
  const config = getConfig();
  const ttlMs = 5 * 60 * 1000;
  if (
    Date.now() - relatedCache.ts < ttlMs &&
    relatedCache.empresasById.size &&
    relatedCache.municipiosById.size &&
    relatedCache.estadosById.size &&
    relatedCache.employeesById.size
  ) {
    return {
      config,
      empresasById: relatedCache.empresasById,
      municipiosById: relatedCache.municipiosById,
      estadosById: relatedCache.estadosById,
      employeesById: relatedCache.employeesById,
    };
  }

  const [empresasRows, municipiosRows, estadosRows, employeesRows] = await Promise.all([
    fetchTable(config, "EMPRESAS"),
    fetchTable(config, "MUNICIPIOS"),
    fetchTable(config, "ESTADOS"),
    fetchTable(config, "EMPLEADOS"),
  ]);

  const empresasById = new Map();
  const municipiosById = new Map();
  const estadosById = new Map();
  const employeesById = new Map();

  for (const row of empresasRows) {
    const id = getLookupId(row);
    if (id) empresasById.set(id, row);
  }

  for (const row of municipiosRows) {
    const id = getLookupId(row);
    if (id) municipiosById.set(id, row);
  }

  for (const row of estadosRows) {
    const id = getLookupId(row);
    if (id) estadosById.set(id, row);
  }

  for (const row of employeesRows) {
    const id = getEmployeeId(row);
    if (id) employeesById.set(id, row);
  }

  relatedCache.ts = Date.now();
  relatedCache.empresasById = empresasById;
  relatedCache.municipiosById = municipiosById;
  relatedCache.estadosById = estadosById;
  relatedCache.employeesById = employeesById;

  return { config, empresasById, municipiosById, estadosById, employeesById };
}

function buildAllFieldsRows(row) {
  return Object.entries(row || {})
    .map(([key, value]) => {
      const display = escapeHtml(toDisplayValue(value));
      const placeholder = escapeHtml(normalizeTokenKey(key));
      return `<tr><td><strong>${escapeHtml(key)}</strong><br><span style="color:#64748b;">&#123;&#123;${placeholder}&#125;&#125;</span></td><td>${display}</td></tr>`;
    })
    .join("\n");
}

function makeLookupMap(values) {
  const map = new Map();

  for (const [key, value] of Object.entries(values || {})) {
    if (!key) continue;
    const textValue = value === null || value === undefined ? "" : String(value);
    map.set(key, textValue);
    map.set(normalizeTokenKey(key), textValue);
    map.set(String(key).toLowerCase(), textValue);
    map.set(normalizeTokenKey(key).toLowerCase(), textValue);
  }

  return map;
}

function lookupToken(token, values) {
  const clean = String(token || "").trim();
  if (!clean) return "";
  const normalized = normalizeTokenKey(clean);

  return (
    values.get(clean) ??
    values.get(clean.toLowerCase()) ??
    values.get(normalized) ??
    values.get(normalized.toLowerCase()) ??
    ""
  );
}

function renderTemplate(source, values) {
  const rawRendered = source.replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_match, token) => lookupToken(token, values));
  return rawRendered.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, token) => escapeHtml(lookupToken(token, values)));
}

function normalizeEditableFields(fields = {}) {
  const normalized = {};

  for (const [key, value] of Object.entries(fields || {})) {
    const textValue = toDisplayValue(value);
    normalized[key] =
      key === "firma_url" || key === "signer_id"
        ? textValue
        : textValue.toLocaleUpperCase("es-MX");
  }

  return normalized;
}

async function loadBranding(config) {
  await ensureFile(config.brandingPath, "branding");
  const branding = JSON.parse(await fs.readFile(config.brandingPath, "utf8"));
  branding.footerLeftLines = getCompanyAddressLines();
  const defaultLogoPath = path.join(standaloneRoot, "assets", "logo.png");
  const resolvedLogoPath = branding.logoPath
    ? path.isAbsolute(branding.logoPath)
      ? branding.logoPath
      : path.resolve(path.dirname(config.brandingPath), branding.logoPath)
    : defaultLogoPath;

  await ensureFile(resolvedLogoPath, "logo");

  return {
    branding,
    companyLogoDataUri: await fileToDataUri(resolvedLogoPath),
  };
}

function findRowOrThrow(rows, config, id) {
  const match = rows.find(
    (row) => String(row?.[config.sucursalesIdCol] ?? "").trim() === String(id || "").trim()
  );

  if (!match) {
    throw new Error("No se encontro la sucursal solicitada.");
  }

  return match;
}

function getEmpresaRow(row, empresasById) {
  const empresaId = String(
    getFirstFlexible(row, ["ID EMPRESA", "EMPRESA", "Empresa"]) ?? ""
  ).trim();
  return empresasById.get(empresaId) || {};
}

function getMunicipioRow(row, municipiosById) {
  const municipioId = String(getFirstFlexible(row, ["MUNICIPIO", "Municipio"]) ?? "").trim();
  return municipiosById.get(municipioId) || {};
}

function getEstadoRow(row, estadosById) {
  const estadoId = String(getFirstFlexible(row, ["ESTADO", "Estado"]) ?? "").trim();
  return estadosById.get(estadoId) || {};
}

function getEmployeeSummary(row) {
  return {
    id: getEmployeeId(row),
    nombre: formatSignerDisplayName(getFirstFlexible(row, ["NOMBRE", "Nombre"]) ?? ""),
    puesto: toDisplayValue(getFirstFlexible(row, ["PUESTO", "Puesto"]) ?? ""),
    firma: toDisplayValue(getFirstFlexible(row, ["FIRMA", "Firma"]) ?? ""),
  };
}

function getSucursalLabel(row, config) {
  return toDisplayValue(
    getFirstFlexible(row, ["LABEL2", "Label2", config.sucursalesNameCol, "LABEL", "Label"]) ?? ""
  );
}

function getSucursalDisplayInfo(row, config, empresasById = new Map(), municipiosById = new Map(), estadosById = new Map()) {
  const empresaRow = getEmpresaRow(row, empresasById);
  const municipioRow = getMunicipioRow(row, municipiosById);
  const estadoRow = getEstadoRow(row, estadosById);
  return {
    id: getLookupId(row, [config.sucursalesIdCol, "ID", "Id", "id"]),
    tienda: toDisplayValue(getFirstFlexible(row, [config.sucursalesTiendaCol, "TIENDA", "Tienda"]) ?? ""),
    label: getSucursalLabel(row, config),
    empresa: toUpperDisplay(
      getFirstFlexible(empresaRow, ["RAZON SOCIAL", "RazÃ³n Social", "Razon Social", "NOMBRE"]) ?? ""
    ),
    municipio: toUpperDisplay(getFirstFlexible(municipioRow, ["NOMBRE", "Nombre"]) ?? ""),
    estado: toUpperDisplay(getFirstFlexible(estadoRow, ["NOMBRE", "Nombre"]) ?? ""),
    tipo: toUpperDisplay(getFirstFlexible(row, ["TIPO", "Tipo", "TIPO SUCURSAL", "Tipo Sucursal"]) ?? ""),
  };
}

function applySignerToFields(fields, employeeRow) {
  if (!employeeRow) {
    return {
      ...fields,
      signer_id: "",
      firma_url: "",
      nombre_firma: "",
      puesto_firma: "",
    };
  }

  const signer = getEmployeeSummary(employeeRow);
  return {
    ...fields,
    signer_id: signer.id,
    firma_url: signer.firma,
    nombre_firma: toUpperDisplay(signer.nombre),
    puesto_firma: toUpperDisplay(signer.puesto),
  };
}

function buildCartaCompromisoMunicipalFields(row, config, empresasById, municipiosById) {
  const empresaRow = getEmpresaRow(row, empresasById);
  const municipioRow = getMunicipioRow(row, municipiosById);

  return {
    fecha_carta: formatCartaMonth(new Date()),
    empresa: toUpperDisplay(
      getFirstFlexible(empresaRow, ["RAZON SOCIAL", "RazÃƒÂ³n Social", "Razon Social", "razon social", "NOMBRE"]) ?? ""
    ),
    label: toUpperDisplay(getSucursalLabel(row, config)),
    direccion_google: toUpperDisplay(
      getFirstFlexible(row, ["DIRECCION GOOGLE", "Direccion Google", "DIRECCION", "Direccion"]) ?? ""
    ),
    encargado_pc: toUpperDisplay(getFirstFlexible(municipioRow, ["ENCARGADO PC", "Encargado PC"]) ?? ""),
    puesto_destinatario: toUpperDisplay(getFirstFlexible(municipioRow, ["PUESTO", "Puesto"]) ?? ""),
    rfc: toUpperDisplay(getFirstFlexible(empresaRow, ["RFC", "Rfc"]) ?? ""),
    nivel_de_riesgo: toUpperDisplay(getFirstFlexible(row, ["NIVEL DE RIESGO", "Nivel de Riesgo"]) ?? ""),
    signer_id: "",
    firma_url: "",
    nombre_firma: "",
    puesto_firma: "",
  };
}

function buildCartaEntregaCuliacanFields(row, config, empresasById, municipiosById) {
  const municipioRow = getMunicipioRow(row, municipiosById);
  const empresaRow = getEmpresaRow(row, empresasById);
  const label2 = toUpperDisplay(getFirstFlexible(row, ["LABEL2", "Label2", config.sucursalesNameCol, "LABEL", "Label"]) ?? "");

  return {
    fecha_carta: formatCartaMonth(new Date()),
    encargado_pc: toUpperDisplay(getFirstFlexible(municipioRow, ["ENCARGADO PC", "Encargado PC"]) ?? ""),
    puesto_destinatario: toUpperDisplay(getFirstFlexible(municipioRow, ["PUESTO", "Puesto"]) ?? ""),
    empresa: toUpperDisplay(getFirstFlexible(empresaRow, ["RAZON SOCIAL", "RazÃ³n Social", "Razon Social", "NOMBRE"]) ?? ""),
    label: label2,
    direccion_google: toUpperDisplay(
      getFirstFlexible(row, ["DIRECCION GOOGLE", "Direccion Google", "DIRECCION", "Direccion"]) ?? ""
    ),
    nombre_firma: "",
    puesto_firma: "",
    signer_id: "",
    firma_url: "",
  };
}

function buildCartaEntregaNavolatoFields(row, config, empresasById, municipiosById) {
  const municipioRow = getMunicipioRow(row, municipiosById);
  const empresaRow = getEmpresaRow(row, empresasById);
  const label2 = toUpperDisplay(getFirstFlexible(row, ["LABEL2", "Label2", config.sucursalesNameCol, "LABEL", "Label"]) ?? "");
  const municipioNombre = toUpperDisplay(getFirstFlexible(municipioRow, ["NOMBRE", "Nombre"]) ?? "NAVOLATO");

  return {
    fecha_carta: formatCartaMonth(new Date()),
    destinatario_nombre: "LIC. CESAR HUMBERTO SANCHEZ ZAZUETA",
    destinatario_puesto: "COORDINADOR DE PROTECCION CIVIL MUNICIPAL",
    destinatario_municipio: municipioNombre || "NAVOLATO",
    destinatario_linea2: `COORDINADOR DE PROTECCION CIVIL MUNICIPAL ${municipioNombre || "NAVOLATO"}`,
    empresa: toUpperDisplay(getFirstFlexible(empresaRow, ["RAZON SOCIAL", "RazÃ³n Social", "Razon Social", "NOMBRE"]) ?? ""),
    label: label2,
    direccion_google: toUpperDisplay(
      getFirstFlexible(row, ["DIRECCION GOOGLE", "Direccion Google", "DIRECCION", "Direccion"]) ?? ""
    ),
    nombre_firma: "",
    puesto_firma: "",
    signer_id: "",
    firma_url: "",
  };
}

function buildCedulaSimulacroFields(row, config, estadosById = new Map(), empresasById = new Map(), cartaFields = {}) {
  const estadoRow = getEstadoRow(row, estadosById);
  const empresaRow = getEmpresaRow(row, empresasById);
  const label2 = toUpperDisplay(getFirstFlexible(row, ["LABEL2", "Label2", config.sucursalesNameCol, "LABEL", "Label"]) ?? "");
  const direccionSucursal = toUpperDisplay(
    getFirstFlexible(row, ["DIRECCION GOOGLE", "Direccion Google", "DIRECCION", "Direccion"]) ?? ""
  );
  const entidadFederativa = toUpperDisplay(getFirstFlexible(estadoRow, ["NOMBRE", "Nombre"]) ?? "");
  const empresaNombre = toUpperDisplay(
    getFirstFlexible(empresaRow, ["RAZON SOCIAL", "RazÃƒÆ’Ã‚Â³n Social", "Razon Social", "razon social", "NOMBRE"]) ?? ""
  );

  return {
    fecha: formatInputDate(new Date()),
    dependencia: empresaNombre,
    sucursal_label: label2,
    telefono: toUpperDisplay(getFirstFlexible(row, ["TELEFONO", "Telefono", "TelÃ©fono"]) ?? ""),
    direccion: direccionSucursal || toUpperDisplay(cartaFields.direccion_google || ""),
    entidad_federativa: entidadFederativa,
    tipo_inmueble: toUpperDisplay(getFirstFlexible(row, ["TIPO DE INMUEBLE", "Tipo de inmueble", "GIRO", "Giro"]) ?? ""),
    poblacion_fija: "",
    poblacion_flotante: "",
    trabajadores_matutino: "",
    trabajadores_vespertino: "",
    trabajadores_nocturno: "",
    trabajadores_mixto: "",
    brigadistas_matutino: "",
    brigadistas_vespertino: "",
    brigadistas_nocturno: "",
    brigadistas_mixto: "",
    niveles: "",
    sotanos: "",
    superiores: "",
    capacidad_estacionamiento: "",
    elevadores: "",
    escaleras_emergencia: "",
    helipuerto: "",
    estacionamiento: "",
    estacionamiento_abierto: "",
    estacionamiento_acomodo: "",
    hipotesis: "",
    tipo_simulacro: "",
    modalidad_evacuacion: "",
    aviso: "",
    difusion: "",
    difusion_medios: "",
    hora_inicio: "",
    hora_termino: "",
    tiempo_evacuacion: "",
    duracion_total: "",
    empleados_evacuados: "",
    visitantes_evacuados: "",
    sistema_alertamiento: "",
    puesto_mando: "",
    puesto_primeros_auxilios: "",
    plan_alertamiento: "",
    plan_emergencia: "",
    plan_evaluacion_danos: "",
    plan_vuelta_normalidad: "",
    verificacion_personal: "",
    reunion_evaluacion: "",
    participantes: "",
    brigadas_participaron: "",
    equipo_identificacion: "",
    equipo_utilizado: "",
    instituciones_apoyo: "",
    observaciones_generales: "",
    tiempo_evacuacion_eval: "",
    desviaciones_detectadas: "",
    recomendaciones: "",
    representante_pc: "",
    responsable_inmueble: "",
    responsable_programa: "",
  };
}

function buildChoiceValues(fields = {}) {
  const values = {};
  const selectedClass = "is-selected";
  const selectedText = "SI";

  for (const [key, value] of Object.entries(fields || {})) {
    if (!key.startsWith("choice_") && !key.startsWith("eval_")) continue;
    const cleanValue = normalizeTokenKey(value);
    if (!cleanValue) continue;

    values[`mark_${key}_${cleanValue}`] = selectedClass;
    values[`text_${key}_${cleanValue}`] = selectedText;
  }

  return values;
}

function buildSignatureImageHtml(signatureSource) {
  if (!signatureSource) {
    return '<div class="letter-signature-image letter-signature-empty"></div>';
  }

  return `<img class="letter-signature-image" src="${escapeHtml(signatureSource)}" alt="Firma">`;
}

async function renderCartaCompromisoMunicipalBody(fields = {}) {
  const config = getConfig();
  await ensureFile(config.cartaTemplatePath, "plantilla carta compromiso municipal");

  const template = await fs.readFile(config.cartaTemplatePath, "utf8");
  const normalizedFields = normalizeEditableFields(fields);
  const signatureSource = await resolveImageSource(fields.firma_url);
  const renderedFields = {
    ...normalizedFields,
    firma_image_html: buildSignatureImageHtml(signatureSource),
  };

  return renderTemplate(template, makeLookupMap(renderedFields));
}

async function renderCartaEntregaCuliacanBody(fields = {}) {
  const config = getConfig();
  await ensureFile(config.cartaEntregaCuliacanTemplatePath, "plantilla carta de entrega culiacan");

  const template = await fs.readFile(config.cartaEntregaCuliacanTemplatePath, "utf8");
  const normalizedFields = normalizeEditableFields(fields);
  const signatureSource = await resolveImageSource(fields.firma_url);
  const renderedFields = {
    ...normalizedFields,
    firma_image_html: buildSignatureImageHtml(signatureSource),
  };

  return renderTemplate(template, makeLookupMap(renderedFields));
}

async function renderCartaEntregaNavolatoBody(fields = {}) {
  const config = getConfig();
  await ensureFile(config.cartaEntregaNavolatoTemplatePath, "plantilla carta de entrega navolato");

  const template = await fs.readFile(config.cartaEntregaNavolatoTemplatePath, "utf8");
  const normalizedFields = normalizeEditableFields(fields);
  const signatureSource = await resolveImageSource(fields.firma_url);
  const renderedFields = {
    ...normalizedFields,
    firma_image_html: buildSignatureImageHtml(signatureSource),
  };

  return renderTemplate(template, makeLookupMap(renderedFields));
}

async function renderCedulaSimulacroDocument(row, config, fields = {}, branchLogoDataUri) {
  await ensureFile(config.cedulaTemplatePath, "plantilla cedula de simulacro");

  const template = await fs.readFile(config.cedulaTemplatePath, "utf8");
  const { empresasById, estadosById } = await loadRelatedTables();
  const cartaFields = buildCartaCompromisoMunicipalFields(row, config, empresasById, new Map());
  const defaults = buildCedulaSimulacroFields(row, config, estadosById, empresasById, cartaFields);
  const normalizedFields = normalizeEditableFields({ ...defaults, ...fields });
  const proteccionCivilLogoDataUri = await resolveProteccionCivilLogoDataUri(config);
  const values = {
    ...normalizedFields,
    ...buildChoiceValues(fields),
    branch_logo_data_uri: branchLogoDataUri,
    proteccion_civil_logo_data_uri: proteccionCivilLogoDataUri,
    document_label: getSucursalLabel(row, config),
  };

  return renderTemplate(template, makeLookupMap(values));
}

async function renderStaticPdfPreviewDocument(row, config, title, subtitle, pdfUrl) {
  const label =
    getSucursalLabel(row, config) ||
    row?.[config.sucursalesTiendaCol] ||
    row?.[config.sucursalesIdCol] ||
    "sucursal";

  return buildStaticPdfPreviewHtml({
    title,
    subtitle,
    label,
    pdfUrl,
  });
}

function normalizeBasePath(basePath = "") {
  const value = String(basePath || "").trim().replace(/\/+$/g, "");
  return value || "";
}

function buildBaseValues(row, config, defaults, branding, companyLogoDataUri, title, subtitle) {
  const now = new Date();
  const generatedDate = new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    timeZone: "America/Mexico_City",
  }).format(now);
  const generatedDateTime = new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  }).format(now);

  return {
    ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toDisplayValue(value)])),
    document_title: title || defaults.title,
    document_label: getSucursalLabel(row, config),
    document_subtitle: subtitle || defaults.subtitle,
    generated_date: generatedDate,
    generated_datetime: generatedDateTime,
    company_name: branding.companyName || "DESARROLLO EG",
    company_subtitle: branding.companySubtitle || "",
    company_logo_data_uri: companyLogoDataUri,
    footer_left_html: (branding.footerLeftLines || []).map((line) => escapeHtml(line)).join("<br>"),
    footer_right_html: (branding.footerRightLines || []).map((line) => escapeHtml(line)).join("<br>"),
    all_fields_rows: buildAllFieldsRows(row),
  };
}

export async function getWebDefaults() {
  const config = getConfig();
  await ensureFile(config.bodyTemplatePath, "plantilla base");

  return {
    title: config.defaultTitle,
    subtitle: config.defaultSubtitle,
    bodyTemplate: await fs.readFile(config.bodyTemplatePath, "utf8"),
  };
}

export async function buildCartaCompromisoMunicipalPreset(id, signerId = "") {
  const [{ config, rows }, { empresasById, municipiosById, employeesById }] = await Promise.all([
    loadSucursales(),
    loadRelatedTables(),
  ]);

  const row = findRowOrThrow(rows, config, id);
  let fields = buildCartaCompromisoMunicipalFields(row, config, empresasById, municipiosById);

  if (signerId && employeesById.has(String(signerId).trim())) {
    fields = applySignerToFields(fields, employeesById.get(String(signerId).trim()));
  }

  return {
    templateId: "carta-compromiso-municipal",
    title: "Carta Compromiso Municipal",
    subtitle: "",
    fields,
  };
}

export async function buildCartaEntregaCuliacanPreset(id, signerId = "") {
  const [{ config, rows }, { empresasById, municipiosById, employeesById }] = await Promise.all([
    loadSucursales(),
    loadRelatedTables(),
  ]);

  const row = findRowOrThrow(rows, config, id);
  let fields = buildCartaEntregaCuliacanFields(row, config, empresasById, municipiosById);

  if (signerId && employeesById.has(String(signerId).trim())) {
    fields = applySignerToFields(fields, employeesById.get(String(signerId).trim()));
  }

  return {
    templateId: "carta-entrega-culiacan",
    title: "Carta de Entrega Culiacan",
    subtitle: "",
    fields,
  };
}

export async function buildCartaEntregaNavolatoPreset(id, signerId = "") {
  const [{ config, rows }, { empresasById, municipiosById, employeesById }] = await Promise.all([
    loadSucursales(),
    loadRelatedTables(),
  ]);

  const row = findRowOrThrow(rows, config, id);
  let fields = buildCartaEntregaNavolatoFields(row, config, empresasById, municipiosById);

  if (signerId && employeesById.has(String(signerId).trim())) {
    fields = applySignerToFields(fields, employeesById.get(String(signerId).trim()));
  }

  return {
    templateId: "carta-entrega-navolato",
    title: "Carta de Entrega Navolato",
    subtitle: "",
    fields,
  };
}

export async function buildCedulaSimulacroPreset(id) {
  const [{ config, rows }, { empresasById, estadosById }] = await Promise.all([
    loadSucursales(),
    loadRelatedTables(),
  ]);
  const row = findRowOrThrow(rows, config, id);
  const cartaFields = buildCartaCompromisoMunicipalFields(row, config, empresasById, new Map());

  return {
    templateId: "cedula-simulacro",
    title: "Cedula de Simulacro",
    subtitle: "",
    fields: buildCedulaSimulacroFields(row, config, estadosById, empresasById, cartaFields),
  };
}

export async function listSucursalesSummary(query = "") {
  const { config, rows } = await loadSucursales();
  const { empresasById, municipiosById, estadosById } = await loadRelatedTables();
  const normalizedQuery = normalizeSearch(query);

  return rows
    .map((row) => ({
      ...getSucursalDisplayInfo(row, config, empresasById, municipiosById, estadosById),
      raw: row,
    }))
    .filter((row) => {
      if (!normalizedQuery) return true;
      const haystack = normalizeSearch(
        `${row.id} ${row.tienda} ${row.label} ${row.empresa} ${row.municipio} ${row.estado} ${row.tipo}`
      );
      return haystack.includes(normalizedQuery);
    })
    .sort((a, b) => {
      const tiendaCompare = String(a.tienda).localeCompare(String(b.tienda), "es-MX", {
        numeric: true,
        sensitivity: "base",
      });
      if (tiendaCompare !== 0) return tiendaCompare;
      return String(a.label).localeCompare(String(b.label), "es-MX", { sensitivity: "base" });
    })
    .map(({ raw, ...row }) => row);
}

export async function listEmpleadosSummary(query = "") {
  const { employeesById } = await loadRelatedTables();
  const normalizedQuery = normalizeSearch(query);

  return Array.from(employeesById.values())
    .map((row) => getEmployeeSummary(row))
    .filter((item) => {
      if (!normalizedQuery) return true;
      const haystack = normalizeSearch(`${item.id} ${item.nombre} ${item.puesto}`);
      return haystack.includes(normalizedQuery);
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es-MX", { sensitivity: "base" }));
}

function drawWhite(page, x, y, width, height) {
  page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1), borderColor: rgb(1, 1, 1), borderWidth: 0 });
}

function drawFieldText(page, font, text, x, y, size = 7, maxWidth = 180) {
  const value = toUpperDisplay(text);
  if (!value) return;
  const words = value.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  lines.slice(0, 3).forEach((line, index) => {
    page.drawText(line, { x, y: y - index * (size + 1.5), size, font, color: rgb(0, 0, 0) });
  });
}

function drawGreenSi(page, font, x, y, width = 14, height = 8) {
  page.drawRectangle({ x, y, width, height, color: rgb(0.09, 0.64, 0.29) });
  page.drawText("SI", { x: x + 3, y: y + 1.7, size: 5.5, font, color: rgb(1, 1, 1) });
}

const CEDULA_MARKS = {
  choice_elevadores: { si: [421, 616], no: [421, 605] },
  choice_escaleras_emergencia: { si: [512, 616], no: [512, 605] },
  choice_helipuerto: { si: [139, 575], no: [139, 564] },
  choice_estacionamiento: { si: [37, 544], no: [37, 533] },
  choice_estacionamiento_abierto: { si: [405, 544], no: [405, 533] },
  choice_estacionamiento_acomodo: { si: [494, 544], no: [494, 533] },
  choice_hipotesis: {
    amenaza_bomba: [140, 480],
    sismo: [235, 480],
    incendio: [300, 480],
    documento: [372, 480],
    huracan: [455, 480],
    otra: [523, 480],
  },
  choice_tipo_simulacro: { individual: [157, 443], integral: [253, 443], macro: [356, 443] },
  choice_modalidad_evacuacion: { repliegue: [125, 426], evacuacion_parcial: [267, 426], evacuacion_total: [438, 426] },
  choice_aviso: { con_previo_aviso: [247, 408], sin_previo_aviso: [402, 408] },
  choice_difusion: { si: [54, 380], no: [82, 380] },
  choice_puesto_mando: { si: [245, 291], no: [275, 291] },
  choice_puesto_primeros_auxilios: { si: [245, 268], no: [275, 268] },
  choice_plan_alertamiento: { si: [245, 246], no: [275, 246] },
  choice_plan_emergencia: { si: [245, 224], no: [275, 224] },
  choice_plan_evaluacion_danos: { si: [245, 202], no: [275, 202] },
  choice_plan_vuelta_normalidad: { si: [245, 180], no: [275, 180] },
  choice_verificacion_personal: { si: [245, 158], no: [275, 158] },
  choice_reunion_evaluacion: { si: [245, 136], no: [275, 136] },
  choice_equipo_identificacion: { si: [455, 646], no: [485, 646], page: 1 },
};

const CEDULA_EVAL_MARKS = {
  eval_zonas_menor_riesgo: [432, 502],
  eval_punto_reunion: [432, 485],
  eval_condiciones_punto: [432, 468],
  eval_rutas_evacuacion: [432, 451],
  eval_localizacion_salidas: [432, 434],
  eval_condiciones_salidas: [432, 417],
  eval_plan_alertamiento: [432, 400],
  eval_evacuacion: [432, 383],
  eval_plan_emergencia: [432, 349],
  eval_danos: [432, 332],
  eval_vuelta_normalidad: [432, 315],
  eval_mandos: [432, 298],
  eval_jefes_piso: [432, 281],
  eval_brigadistas: [432, 264],
  eval_comportamiento: [432, 247],
  eval_grupos_externos: [432, 230],
};

const CEDULA_TEXT_LAYOUTS = [
  { key: "fecha", page: 0, x: 28, y: 682, width: 75, height: 14, textX: 38, textY: 685, size: 7, maxWidth: 58 },
  { key: "dependencia", page: 0, x: 106, y: 682, width: 315, height: 14, textX: 112, textY: 685, size: 7, maxWidth: 300 },
  { key: "telefono", page: 0, x: 424, y: 682, width: 160, height: 14, textX: 435, textY: 685, size: 7, maxWidth: 135 },
  { key: "direccion", page: 0, x: 28, y: 650, width: 395, height: 18, textX: 34, textY: 657, size: 6.5, maxWidth: 380 },
  { key: "entidad_federativa", page: 0, x: 426, y: 650, width: 158, height: 18, textX: 458, textY: 657, size: 7, maxWidth: 90 },
  { key: "tipo_inmueble", page: 0, x: 29, y: 617, width: 190, height: 16, textX: 35, textY: 622, size: 7, maxWidth: 175 },
  { key: "poblacion_fija", page: 0, x: 221, y: 617, width: 78, height: 16, textX: 252, textY: 622, size: 7, maxWidth: 40 },
  { key: "poblacion_flotante", page: 0, x: 301, y: 617, width: 74, height: 16, textX: 330, textY: 622, size: 7, maxWidth: 40 },
  { key: "brigadistas_matutino", page: 0, x: 29, y: 583, width: 70, height: 12, textX: 58, textY: 586, size: 7, maxWidth: 25 },
  { key: "niveles", page: 0, x: 294, y: 583, width: 54, height: 12, textX: 316, textY: 586, size: 7, maxWidth: 25 },
  { key: "sotanos", page: 0, x: 171, y: 543, width: 46, height: 13, textX: 190, textY: 547, size: 7, maxWidth: 20 },
  { key: "superiores", page: 0, x: 219, y: 543, width: 58, height: 13, textX: 242, textY: 547, size: 7, maxWidth: 20 },
  { key: "capacidad_estacionamiento", page: 0, x: 280, y: 543, width: 62, height: 13, textX: 303, textY: 547, size: 7, maxWidth: 24 },
  { key: "hora_inicio", page: 0, x: 132, y: 336, width: 90, height: 13, textX: 155, textY: 340, size: 7, maxWidth: 45 },
  { key: "hora_termino", page: 0, x: 350, y: 336, width: 90, height: 13, textX: 374, textY: 340, size: 7, maxWidth: 45 },
  { key: "tiempo_evacuacion", page: 0, x: 250, y: 315, width: 160, height: 13, textX: 305, textY: 319, size: 7, maxWidth: 70 },
  { key: "duracion_total", page: 0, x: 205, y: 296, width: 150, height: 13, textX: 260, textY: 300, size: 7, maxWidth: 70 },
  { key: "empleados_evacuados", page: 0, x: 120, y: 276, width: 70, height: 13, textX: 150, textY: 280, size: 7, maxWidth: 30 },
  { key: "visitantes_evacuados", page: 0, x: 267, y: 276, width: 70, height: 13, textX: 295, textY: 280, size: 7, maxWidth: 30 },
];

const CEDULA_LOGO_LAYOUTS = {
  branch: { page: 0, x: 22, y: 725, width: 92, height: 52, imageX: 27, imageY: 729, imageWidth: 82, imageHeight: 46 },
  pc: { page: 0, x: 492, y: 720, width: 92, height: 58, imageX: 496, imageY: 722, imageWidth: 88, imageHeight: 54 },
};

function drawCedulaMarks(pdfDoc, font, fields) {
  const pages = pdfDoc.getPages();
  for (const [key, options] of Object.entries(CEDULA_MARKS)) {
    const selected = normalizeTokenKey(fields[key]).toLowerCase();
    if (!selected || !options[selected]) continue;
    const [x, y] = options[selected];
    const pageIndex = options.page ?? 0;
    drawGreenSi(pages[pageIndex], font, x, y);
  }

  const evalOffsets = { bien: 0, regular: 55, mal: 110 };
  for (const [key, base] of Object.entries(CEDULA_EVAL_MARKS)) {
    const selected = normalizeTokenKey(fields[key]).toLowerCase();
    if (!selected || evalOffsets[selected] === undefined) continue;
    drawGreenSi(pages[1], font, base[0] + evalOffsets[selected], base[1]);
  }
}

async function renderCedulaSimulacroOfficialPdf({ id, title = "Cedula de Simulacro", fields = {} }) {
  const [{ config, rows }, { empresasById, estadosById }] = await Promise.all([
    loadSucursales(),
    loadRelatedTables(),
  ]);
  const row = findRowOrThrow(rows, config, id);
  const cartaFields = buildCartaCompromisoMunicipalFields(row, config, empresasById, new Map());
  const defaults = buildCedulaSimulacroFields(row, config, estadosById, empresasById, cartaFields);
  const selectedFields = normalizeEditableFields({ ...defaults, ...fields });
  const branchLogoDataUri = await resolveCedulaBranchLogoSource(row, config);
  const proteccionCivilLogoDataUri = await resolveProteccionCivilLogoDataUri(config);

  await ensureFile(config.cedulaPdfTemplatePath, "formato oficial de cedula de simulacro");
  const pdfDoc = await PDFDocument.load(await fs.readFile(config.cedulaPdfTemplatePath));
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page1 = pdfDoc.getPage(0);

  drawWhite(page1, CEDULA_LOGO_LAYOUTS.branch.x, CEDULA_LOGO_LAYOUTS.branch.y, CEDULA_LOGO_LAYOUTS.branch.width, CEDULA_LOGO_LAYOUTS.branch.height);
  const branchLogo = await embedImage(pdfDoc, branchLogoDataUri);
  if (branchLogo) {
    const scaled = branchLogo.scaleToFit(CEDULA_LOGO_LAYOUTS.branch.imageWidth, CEDULA_LOGO_LAYOUTS.branch.imageHeight);
    page1.drawImage(branchLogo, { x: CEDULA_LOGO_LAYOUTS.branch.imageX, y: CEDULA_LOGO_LAYOUTS.branch.imageY, width: scaled.width, height: scaled.height });
  }

  drawWhite(page1, CEDULA_LOGO_LAYOUTS.pc.x, CEDULA_LOGO_LAYOUTS.pc.y, CEDULA_LOGO_LAYOUTS.pc.width, CEDULA_LOGO_LAYOUTS.pc.height);
  const pcLogo = await embedImage(pdfDoc, proteccionCivilLogoDataUri);
  if (pcLogo) {
    const scaled = pcLogo.scaleToFit(CEDULA_LOGO_LAYOUTS.pc.imageWidth, CEDULA_LOGO_LAYOUTS.pc.imageHeight);
    page1.drawImage(pcLogo, { x: CEDULA_LOGO_LAYOUTS.pc.imageX, y: CEDULA_LOGO_LAYOUTS.pc.imageY, width: scaled.width, height: scaled.height });
  }

  for (const layout of CEDULA_TEXT_LAYOUTS) {
    if (layout.page !== 0) continue;
    drawWhite(page1, layout.x, layout.y, layout.width, layout.height);
    drawFieldText(page1, font, selectedFields[layout.key], layout.textX, layout.textY, layout.size, layout.maxWidth);
  }

  drawCedulaMarks(pdfDoc, font, selectedFields);

  const label =
    selectedFields.dependencia ||
    getSucursalLabel(row, config) ||
    row?.[config.sucursalesTiendaCol] ||
    row?.[config.sucursalesIdCol] ||
    "sucursal";

  return {
    buffer: Buffer.from(await pdfDoc.save()),
    row,
    fileBaseName: `${slugify(title)}-${slugify(label)}`,
  };
}

function buildCedulaPreviewHtml({ title, pdfBase64, branchLogoDataUri, proteccionCivilLogoDataUri, fields = {} }) {
  const previewState = {
    title,
    pdfBase64,
    branchLogoDataUri,
    proteccionCivilLogoDataUri,
    fields,
    marks: CEDULA_MARKS,
    evalMarks: CEDULA_EVAL_MARKS,
    textLayouts: CEDULA_TEXT_LAYOUTS,
    logoLayouts: CEDULA_LOGO_LAYOUTS,
  };
  const stateJson = JSON.stringify(previewState).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png">
  <link rel="shortcut icon" type="image/png" href="/img/Logo%20sin%20fondo%203D%20HD.png">
  <style>
    :root { --page-width: 612px; --page-height: 792px; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #5b6067; font-family: Arial, Helvetica, sans-serif; }
    body { padding: 18px 0 26px; }
    .stack { display: grid; gap: 18px; justify-content: center; }
    .page-wrap { position: relative; width: min(calc(100vw - 24px), var(--page-width)); }
    .page-shell {
      position: relative;
      width: var(--page-width);
      height: var(--page-height);
      transform-origin: top left;
      background: #fff;
      box-shadow: 0 18px 40px rgba(0,0,0,0.28);
      overflow: hidden;
    }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .overlay { position: absolute; inset: 0; }
    .mask { position: absolute; background: #fff; }
    .logo { position: absolute; object-fit: contain; }
    .text {
      position: absolute;
      font-weight: 700;
      text-transform: uppercase;
      color: #111;
      white-space: pre-wrap;
      overflow: hidden;
      line-height: 1.15;
    }
    .mark {
      position: absolute;
      width: 14px;
      height: 8px;
      border: 1px solid transparent;
      cursor: pointer;
      background: transparent;
      user-select: none;
    }
    .mark.selected {
      background: #16a34a;
      border-color: #15803d;
    }
    .mark.selected::after {
      content: "SI";
      color: #fff;
      display: block;
      font-size: 5.5px;
      line-height: 8px;
      font-weight: 800;
      text-align: center;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <div class="stack" id="stack"></div>
  <script>
    const state = ${stateJson};
    const PAGE_HEIGHT = 792;
    const stack = document.getElementById("stack");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    function getScale() {
      return Math.min((window.innerWidth - 24) / 612, 1);
    }

    function cssY(pdfY, height = 0) {
      return PAGE_HEIGHT - pdfY - height;
    }

    function normalizeValue(value) {
      return String(value || "").trim().toUpperCase();
    }

    function selectedValueFor(name) {
      return String(state.fields[name] || "").trim().toLowerCase();
    }

    function sendSelection(name, value) {
      parent.postMessage({ type: "cedula-choice", name, value }, "*");
    }

    function buildTextNode(layout) {
      const value = normalizeValue(state.fields[layout.key]);
      const node = document.createElement("div");
      node.className = "text";
      node.style.left = layout.textX + "px";
      node.style.top = cssY(layout.textY, layout.size + 2) + "px";
      node.style.width = layout.maxWidth + "px";
      node.style.fontSize = layout.size + "px";
      node.textContent = value;
      return node;
    }

    function buildLogoOverlay(kind) {
      const layout = state.logoLayouts[kind];
      const frag = document.createDocumentFragment();
      const mask = document.createElement("div");
      mask.className = "mask";
      mask.style.left = layout.x + "px";
      mask.style.top = cssY(layout.y, layout.height) + "px";
      mask.style.width = layout.width + "px";
      mask.style.height = layout.height + "px";
      frag.appendChild(mask);

      const src = kind === "branch" ? state.branchLogoDataUri : state.proteccionCivilLogoDataUri;
      if (src) {
        const img = document.createElement("img");
        img.className = "logo";
        img.src = src;
        img.style.left = layout.imageX + "px";
        img.style.top = cssY(layout.imageY, layout.imageHeight) + "px";
        img.style.width = layout.imageWidth + "px";
        img.style.height = layout.imageHeight + "px";
        frag.appendChild(img);
      }
      return frag;
    }

    function buildChoiceMark(pageIndex, name, option, coords) {
      const [x, y] = coords;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mark";
      btn.dataset.group = name;
      btn.dataset.value = option;
      btn.style.left = x + "px";
      btn.style.top = cssY(y, 8) + "px";
      btn.style.width = "14px";
      btn.style.height = "8px";
      if (selectedValueFor(name) === option) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        document.querySelectorAll('.mark[data-group="' + name + '"]').forEach((el) => el.classList.remove("selected"));
        btn.classList.add("selected");
        sendSelection(name, option);
      });
      return { pageIndex, node: btn };
    }

    async function render() {
      const pdfData = Uint8Array.from(atob(state.pdfBase64), (char) => char.charCodeAt(0));
      const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
      const scale = getScale();
      stack.innerHTML = "";

      const overlayByPage = Array.from({ length: pdf.numPages }, () => []);
      for (const layout of state.textLayouts) overlayByPage[layout.page].push(buildTextNode(layout));
      overlayByPage[0].push(buildLogoOverlay("branch"));
      overlayByPage[0].push(buildLogoOverlay("pc"));

      for (const [name, options] of Object.entries(state.marks)) {
        const pageIndex = options.page || 0;
        for (const [option, coords] of Object.entries(options)) {
          if (option === "page") continue;
          const mark = buildChoiceMark(pageIndex, name, option, coords);
          overlayByPage[mark.pageIndex].push(mark.node);
        }
      }

      const evalOffsets = { bien: 0, regular: 55, mal: 110 };
      for (const [name, base] of Object.entries(state.evalMarks)) {
        for (const [option, offset] of Object.entries(evalOffsets)) {
          const mark = buildChoiceMark(1, name, option, [base[0] + offset, base[1]]);
          overlayByPage[1].push(mark.node);
        }
      }

      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = await pdf.getPage(index);
        const viewport = page.getViewport({ scale: 1 });
        const wrap = document.createElement("div");
        wrap.className = "page-wrap";
        wrap.style.height = viewport.height * scale + "px";

        const shell = document.createElement("div");
        shell.className = "page-shell";
        shell.style.transform = 'scale(' + scale + ')';

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        shell.appendChild(canvas);

        const overlay = document.createElement("div");
        overlay.className = "overlay";
        (overlayByPage[index - 1] || []).forEach((node) => overlay.appendChild(node));
        shell.appendChild(overlay);
        wrap.appendChild(shell);
        stack.appendChild(wrap);
      }
      window.__LETTER_READY__ = true;
    }

    window.__LETTER_READY__ = false;
    window.addEventListener("resize", render);
    render();
  </script>
</body>
</html>`;
}

export async function renderSucursalDocumentHtml({
  id,
  title = "",
  subtitle = "",
  bodyHtml = "",
  templateId = "",
  fields = {},
  basePath = "",
}) {
  const { config, rows } = await loadSucursales();
  const row = findRowOrThrow(rows, config, id);
  const routeBase = normalizeBasePath(basePath);
  const isCedulaSimulacro = String(templateId || "").trim() === "cedula-simulacro";
  const isCartaEntregaCuliacan = String(templateId || "").trim() === "carta-entrega-culiacan";

  if (isCedulaSimulacro) {
    const { companyLogoDataUri } = await loadBranding(config);
    const branchLogoDataUri = await resolveCedulaBranchLogoSource(row, config);
    return {
      html: await renderCedulaSimulacroDocument(row, config, fields, branchLogoDataUri),
      row,
      fileBaseName: `cedula-de-simulacro-${slugify(getSucursalLabel(row, config) || row?.[config.sucursalesTiendaCol] || "sucursal")}`,
    };
  }

  const isCartaEntregaNavolato = String(templateId || "").trim() === "carta-entrega-navolato";

  if (isCartaEntregaNavolato) {
    const defaults = await getWebDefaults();
    const { branding, companyLogoDataUri } = await loadBranding(config);
    const baseValues = buildBaseValues(
      row,
      config,
      defaults,
      branding,
      companyLogoDataUri,
      "Carta de Entrega Navolato",
      "PDF de ejemplo integrado en el modulo"
    );
    let selectedFields = normalizeEditableFields(fields);

    if (!Object.keys(selectedFields).length) {
      selectedFields = (await buildCartaEntregaNavolatoPreset(id)).fields;
    }

    const bodyHtml = await renderCartaEntregaNavolatoBody({
      ...selectedFields,
      firma_url: toDisplayValue(fields?.firma_url ?? ""),
      signer_id: toDisplayValue(fields?.signer_id ?? ""),
    });
    const tokenMap = makeLookupMap(baseValues);
    tokenMap.set("body_html", bodyHtml);
    tokenMap.set("BODY_HTML", bodyHtml);
    const html = renderTemplate(await fs.readFile(config.templatePath, "utf8"), tokenMap);
    const label =
      selectedFields.label ||
      getSucursalLabel(row, config) ||
      row?.[config.sucursalesTiendaCol] ||
      row?.[config.sucursalesIdCol] ||
      "sucursal";

    return {
      html,
      row,
      fileBaseName: `${slugify("carta-de-entrega-navolato")}-${slugify(label)}`,
    };
  }

  if (isCartaEntregaCuliacan) {
    const defaults = await getWebDefaults();
    const { branding, companyLogoDataUri } = await loadBranding(config);
    const baseValues = buildBaseValues(
      row,
      config,
      defaults,
      branding,
      companyLogoDataUri,
      "Carta de Entrega Culiacan",
      ""
    );
    const selectedFields = normalizeEditableFields(fields);
    const finalFields = Object.keys(selectedFields).length
      ? selectedFields
      : (await buildCartaEntregaCuliacanPreset(id)).fields;
    const bodyHtml = await renderCartaEntregaCuliacanBody(finalFields);
    const tokenMap = makeLookupMap(baseValues);
    tokenMap.set("body_html", bodyHtml);
    tokenMap.set("BODY_HTML", bodyHtml);
    const html = renderTemplate(await fs.readFile(config.templatePath, "utf8"), tokenMap);
    const label =
      finalFields.label ||
      getSucursalLabel(row, config) ||
      row?.[config.sucursalesTiendaCol] ||
      row?.[config.sucursalesIdCol] ||
      "sucursal";
    return {
      html,
      row,
      fileBaseName: `${slugify("carta-de-entrega-culiacan")}-${slugify(label)}`,
    };
  }

  await ensureFile(config.templatePath, "plantilla principal");

  const mainTemplate = await fs.readFile(config.templatePath, "utf8");
  const defaults = await getWebDefaults();
  const { branding, companyLogoDataUri } = await loadBranding(config);

  const isCartaMunicipal = String(templateId || "").trim() === "carta-compromiso-municipal";
  let selectedFields = normalizeEditableFields(fields);

  if (isCartaMunicipal && !Object.keys(selectedFields).length) {
    selectedFields = (await buildCartaCompromisoMunicipalPreset(id)).fields;
  }

  if (isCedulaSimulacro && !Object.keys(selectedFields).length) {
    selectedFields = (await buildCedulaSimulacroPreset(id)).fields;
  }

  const finalTitle = title || (isCartaMunicipal ? "Carta Compromiso Municipal" : isCedulaSimulacro ? "Cedula de Simulacro" : defaults.title);
  const finalSubtitle = subtitle || defaults.subtitle;
  const branchLogoDataUri = await resolveCedulaBranchLogoSource(row, config);
  const baseValues = buildBaseValues(
    row,
    config,
    defaults,
    branding,
    companyLogoDataUri,
    finalTitle,
    finalSubtitle
  );

  let renderedBody = "";

  if (isCartaMunicipal) {
    renderedBody = await renderCartaCompromisoMunicipalBody({
      ...selectedFields,
      firma_url: toDisplayValue(fields?.firma_url ?? ""),
      signer_id: toDisplayValue(fields?.signer_id ?? ""),
    });
  } else if (isCartaEntregaCuliacan) {
    renderedBody = await renderCartaEntregaCuliacanBody({
      ...selectedFields,
      firma_url: toDisplayValue(fields?.firma_url ?? ""),
      signer_id: toDisplayValue(fields?.signer_id ?? ""),
    });
  } else {
    const tokenMap = makeLookupMap(baseValues);
    renderedBody = renderTemplate(String(bodyHtml || defaults.bodyTemplate), tokenMap);
  }

  const tokenMap = makeLookupMap(baseValues);
  tokenMap.set("body_html", renderedBody);
  tokenMap.set("BODY_HTML", renderedBody);

  const html = renderTemplate(mainTemplate, tokenMap);
  const label =
    selectedFields.label ||
    getSucursalLabel(row, config) ||
    row?.[config.sucursalesTiendaCol] ||
    row?.[config.sucursalesIdCol] ||
    "sucursal";

  return {
    html,
    row,
    fileBaseName: `${slugify(finalTitle)}-${slugify(label)}`,
  };
}

export async function renderSucursalDocumentPdf(params) {
  const config = getConfig();
  await ensureFile(config.chromePath, "Chrome");

  const { html, row, fileBaseName } = await renderSucursalDocumentHtml(params);
  const browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction(() => window.__LETTER_READY__ === true, { timeout: 30000 }).catch(() => {});
    const pdfBytes = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: {
        top: "0in",
        right: "0in",
        bottom: "0in",
        left: "0in",
      },
    });

    return {
      buffer: Buffer.from(pdfBytes),
      row,
      fileBaseName,
    };
  } finally {
    await browser.close();
  }
}

