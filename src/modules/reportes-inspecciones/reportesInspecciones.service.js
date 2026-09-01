import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer-core";
import { readLocalOperationalTable } from "../../services/localOperationalRepository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");

const datasetCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const APP_SHEET_CACHE_TTL_MS = Number(process.env.REPORTES_INSPECCIONES_CACHE_TTL_MS || CACHE_TTL_MS);
const APP_SHEET_CACHE_NAMESPACE = "reportes-inspecciones.tables";

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
  return process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "/usr/bin/chromium";
}

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeLooseKey(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  return (
    stripAccents(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "reporte"
  );
}

function splitCsv(value = "") {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
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

function getFlexibleValue(row, keys) {
  if (!row || typeof row !== "object") return undefined;
  const normalized = new Map();
  for (const key of Object.keys(row)) {
    normalized.set(normalizeLooseKey(key), key);
  }

  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return direct;
    }
    const matched = normalized.get(normalizeLooseKey(key));
    if (matched) {
      const value = row[matched];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }
  }
  return undefined;
}

function toDisplayValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function parseDateLoose(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const text = String(value || "").trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const date = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    // AppSheet's API serializes Date columns as MM/DD/YYYY for this app.
    const date = new Date(Number(slashMatch[3]), Number(slashMatch[1]) - 1, Number(slashMatch[2]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateInput(date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Mexico_City",
  }).format(date);
}

function formatDateShort(date) {
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Mexico_City",
  }).format(date);
}

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "si";
}

function getDefaultSelection() {
  return { mode: "last12months", year: new Date().getFullYear() };
}

function normalizeSelection(period, year) {
  const normalizedPeriod = String(period || "").trim().toLowerCase();
  if (normalizedPeriod === "last12months" || normalizedPeriod === "ultimos12meses" || normalizedPeriod === "ultimos-12-meses") {
    return getDefaultSelection();
  }

  const parsedYear = Number.parseInt(String(year || period || "").trim(), 10);
  if (Number.isFinite(parsedYear) && parsedYear > 1900) {
    return { mode: "year", year: parsedYear };
  }

  return getDefaultSelection();
}

function getPeriodLabel(selection) {
  return selection.mode === "last12months" ? "Últimos 12 meses" : `Año ${selection.year}`;
}

function buildPeriodOptions() {
  const currentYear = new Date().getFullYear();
  const options = [{ value: "last12months", label: "Últimos 12 meses" }];
  for (let year = currentYear; year >= currentYear - 10; year -= 1) {
    options.push({ value: String(year), label: `Año ${year}` });
  }
  return options;
}

function getConfig() {
  return {
    appId: readEnv(["REPORTES_INSPECCIONES_APPSHEET_APP_ID", "PLANEACION_APPSHEET_APP_ID", "CONSTANCIAS_APPSHEET_APP_ID", "APPSHEET_APP_ID"]),
    accessKey: readEnv(["REPORTES_INSPECCIONES_APPSHEET_API_KEY", "REPORTES_INSPECCIONES_APPSHEET_ACCESS_KEY", "PLANEACION_APPSHEET_API_KEY", "CONSTANCIAS_APPSHEET_API_KEY", "APPSHEET_API_KEY"]),
    region: readEnv(["REPORTES_INSPECCIONES_APPSHEET_REGION", "APPSHEET_REGION"], "www.appsheet.com"),
    locale: readEnv(["REPORTES_INSPECCIONES_APPSHEET_LOCALE", "APPSHEET_LOCALE"], "es-MX"),
    timezone: readEnv(["REPORTES_INSPECCIONES_APPSHEET_TIMEZONE", "APPSHEET_TIMEZONE"], "America/Mexico_City"),
    chromePath: readEnv(["REPORTES_INSPECCIONES_CHROME_PATH", "CHROME_PATH"], getDefaultChromePath()),
    sucursalesTable: readEnv(["REPORTES_INSPECCIONES_TABLE_SUCURSALES", "APPSHEET_TABLE_SUCURSALES"], "SUCURSALES"),
    inspeccionesTable: readEnv(["REPORTES_INSPECCIONES_TABLE_INSPECCIONES", "APPSHEET_TABLE_INSPECCIONES"], "INSPECCIONES"),
    categoriaTable: readEnv(["REPORTES_INSPECCIONES_TABLE_CATEGORIA", "APPSHEET_TABLE_CATEGORIA"], "CATEGORIAS"),
    sucursalesKeyColumn: readEnv(["REPORTES_INSPECCIONES_SUCURSALES_KEY_COL"], "ID"),
    sucursalesLabelColumn: readEnv(["REPORTES_INSPECCIONES_SUCURSALES_LABEL_COL"], "LABEL"),
    sucursalesDireccionColumn: readEnv(["REPORTES_INSPECCIONES_SUCURSALES_DIRECCION_COL"], "Direccion"),
    sucursalesTiendaColumn: readEnv(["REPORTES_INSPECCIONES_SUCURSALES_TIENDA_COL"], "TIENDA"),
    inspeccionesKeyColumn: readEnv(["REPORTES_INSPECCIONES_INSPECCIONES_KEY_COL"], "Row ID"),
    inspeccionesDateColumn: readEnv(["REPORTES_INSPECCIONES_INSPECCIONES_DATE_COL"], "FECHA"),
    inspeccionesSucursalColumn: readEnv(["REPORTES_INSPECCIONES_INSPECCIONES_SUCURSAL_COL"], "SUCURSAL"),
    inspeccionesCategoriaColumn: readEnv(["REPORTES_INSPECCIONES_INSPECCIONES_CATEGORIA_COL"], "CATEGORIA"),
    inspeccionesObservacionColumn: readEnv(["REPORTES_INSPECCIONES_INSPECCIONES_OBSERVACION_COL"], "NOTA"),
    inspeccionesImageColumns: splitCsv(readEnv(["REPORTES_INSPECCIONES_INSPECCIONES_IMAGE_COLS"], "EVIDENCIA")),
    categoriaKeyColumn: readEnv(["REPORTES_INSPECCIONES_CATEGORIA_KEY_COL"], "Row ID"),
    inspeccionesTableAliases: uniqueStrings([
      readEnv(["REPORTES_INSPECCIONES_TABLE_INSPECCIONES"], ""),
      readEnv(["APPSHEET_TABLE_INSPECCIONES"], ""),
      "INSPECCIONES",
      "INSPECCION",
      "Inspecciones",
      "Inspeccion",
    ]),
    categoriaTableAliases: uniqueStrings([
      readEnv(["REPORTES_INSPECCIONES_TABLE_CATEGORIA"], ""),
      readEnv(["APPSHEET_TABLE_CATEGORIA"], ""),
      "CATEGORIAS",
      "Categoria",
      "CATEGORIA",
      "Categorias",
    ]),
    defaultTitle: "Reporte de Inspecciones",
    defaultSubtitle: "Observaciones de sucursal desde AppSheet",
  };
}

async function fetchAppSheetTable(config, tableName, selector = "") {
  void config;
  void selector;
  return readLocalOperationalTable(tableName);
}

async function fetchAppSheetTableByAliases(config, aliases, selector = "") {
  let lastError = null;
  let firstEmptyResult = null;
  for (const tableName of aliases) {
    try {
      const resolvedSelector = typeof selector === "function" ? selector(tableName) : selector;
      const rows = await fetchAppSheetTable(config, tableName, resolvedSelector);
      if (rows.length > 0) return { tableName, rows };
      firstEmptyResult ||= { tableName, rows };
    } catch (error) {
      lastError = error;
    }
  }

  if (firstEmptyResult) return firstEmptyResult;
  if (lastError) throw lastError;
  return { tableName: "", rows: [] };
}

function buildAppSheetFileUrl(config, tableName, rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || /^https?:\/\//i.test(value) || value.startsWith("data:")) return value;

  const fileName = value.includes("::") ? value.split("::").pop().trim() : value;
  if (!fileName || !fileName.includes("/")) return value;

  return `https://${config.region}/template/gettablefileurl?appName=${encodeURIComponent(config.appId)}&tableName=${encodeURIComponent(tableName)}&fileName=${encodeURIComponent(fileName)}`;
}

async function remoteUrlToDataUri(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function resolveImageSource(config, tableName, rawValue) {
  const normalized = buildAppSheetFileUrl(config, tableName, rawValue);
  if (!normalized) return "";
  if (normalized.startsWith("data:")) return normalized;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      return await remoteUrlToDataUri(normalized);
    } catch {
      return normalized;
    }
  }
  return normalized;
}

function normalizeBranchRow(row, config) {
  const id = String(getFlexibleValue(row, [config.sucursalesKeyColumn, "Row ID", "ROW ID", "ID", "Id", "id"]) ?? "").trim();
  const companyId = String(getFlexibleValue(row, ["ID EMPRESA", "ID_EMPRESA", "EMPRESA", "Empresa"]) ?? "").trim();
  const sourceLabel = String(getFlexibleValue(row, [config.sucursalesLabelColumn, "LABEL", "Label"]) ?? "").trim();
  const sourceName = String(getFlexibleValue(row, ["NOMBRE", "Nombre", "NAME", "Name"]) ?? "").trim();
  const isSpaceGameCuliacan = normalizeLooseKey(sourceLabel) === normalizeLooseKey("407 SPACE GAME CULIACAN");
  const label = companyId === "1" && !isSpaceGameCuliacan
    ? sourceLabel || sourceName || id
    : sourceName || sourceLabel || id;
  const direccion = String(getFlexibleValue(row, [config.sucursalesDireccionColumn, "Direccion", "DIRECCION", "DIRECCION GOOGLE", "Direccion Google", "address"]) ?? "").trim();
  const tienda = String(getFlexibleValue(row, [config.sucursalesTiendaColumn, "TIENDA", "Tienda"]) ?? "").trim();
  return {
    id,
    label: label || id,
    companyId,
    sourceLabel,
    sourceName,
    direccion,
    tienda,
    displayLabel: label || id,
    raw: row,
  };
}

function normalizeCategoryRow(row, config) {
  const id = String(getFlexibleValue(row, [config.categoriaKeyColumn, "Row ID", "ROW ID", "ID", "Id", "id"]) ?? "").trim();
  const label = String(getFirst(row, ["LABEL", "Label", "NOMBRE", "Nombre", "Categoria", "CATEGORIA", "NAME", "Name"]) ?? id).trim();
  return { id, label: label || id, raw: row };
}

function buildLookupMaps(rows, getLabel) {
  const byId = new Map();
  const byToken = new Map();
  for (const row of rows) {
    const id = String(getFirst(row, ["Row ID", "ROW ID", "ID", "Id", "id"]) ?? "").trim();
    const label = String(getLabel(row) ?? id).trim();
    if (id) byId.set(id, row);
    for (const value of [id, label, row?.label, row?.displayLabel, row?.tienda, row?.nombre]) {
      const token = normalizeLooseKey(value);
      if (token) byToken.set(token, row);
    }
  }
  return { byId, byToken };
}

function resolveLookupValue(rawValue, lookups, fallbackLabel = "") {
  const raw = String(rawValue || "").trim();
  if (!raw) return { id: "", label: fallbackLabel || "" };

  const direct = lookups.byId.get(raw);
  if (direct) {
    return {
      id: String(getFirst(direct, ["Row ID", "ROW ID", "ID", "Id", "id"]) ?? raw).trim(),
      label: String(getFirst(direct, ["label", "LABEL", "Label", "NOMBRE", "Nombre", "Categoria", "CATEGORIA", "NAME", "Name"]) ?? raw).trim(),
    };
  }

  const token = normalizeLooseKey(raw);
  const tokenMatch = lookups.byToken.get(token);
  if (tokenMatch) {
    return {
      id: String(getFirst(tokenMatch, ["Row ID", "ROW ID", "ID", "Id", "id"]) ?? raw).trim(),
      label: String(getFirst(tokenMatch, ["label", "LABEL", "Label", "NOMBRE", "Nombre", "Categoria", "CATEGORIA", "NAME", "Name"]) ?? raw).trim(),
    };
  }

  return { id: raw, label: fallbackLabel || raw };
}

function collectInspectionImageValues(row, config) {
  const explicitColumns = config.inspeccionesImageColumns;
  const candidates = explicitColumns.length
    ? explicitColumns
    : Object.keys(row || {}).filter((key) => {
        const token = normalizeLooseKey(key);
        return /image|foto|evidencia|captura|archivo|adjunto/.test(token) && !/categoria|sucursal|fecha|observacion/.test(token);
      });

  const values = [];
  const seen = new Set();
  for (const column of candidates) {
    const raw = row?.[column];
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      const text = String(item || "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      values.push(text);
    }
  }
  return values;
}

function normalizeInspectionRow(row, config, branchLookups, categoryLookups) {
  const id = String(getFlexibleValue(row, [config.inspeccionesKeyColumn, "Row ID", "ROW ID", "ID", "Id", "id"]) ?? "").trim();
  const rawBranch = getFlexibleValue(row, [config.inspeccionesSucursalColumn, "SUCURSAL", "Sucursal", "TIENDA", "Tienda", "LABEL", "Label", "NOMBRE", "Nombre"]);
  const branch = resolveLookupValue(rawBranch, branchLookups, String(rawBranch || "").trim());
  const rawCategory = getFlexibleValue(row, [config.inspeccionesCategoriaColumn, "Categoria", "CATEGORIA", "Category", "CATEGORY"]);
  const category = resolveLookupValue(rawCategory, categoryLookups, String(rawCategory || "").trim());
  const rawDate = getFlexibleValue(row, [config.inspeccionesDateColumn, "FECHA", "Fecha", "DATE", "Date", "CREATED AT", "CREATED_AT"]);
  const date = parseDateLoose(rawDate);
  const observation = String(getFlexibleValue(row, [config.inspeccionesObservacionColumn, "OBSERVACION", "Observacion", "OBSERVACIÓN", "Observación", "NOTAS", "Notas", "COMENTARIO", "Comentario", "COMMENT", "COMMENTS"]) ?? "").trim();
  const images = collectInspectionImageValues(row, config);

  return {
    id,
    branchId: branch.id,
    branchLabel: branch.label,
    branchDisplayLabel: branch.label || branch.id,
    categoryId: category.id,
    categoryLabel: category.label,
    observation,
    date,
    dateLabel: date ? formatDateShort(date) : toDisplayValue(rawDate),
    year: date ? date.getFullYear() : null,
    images,
    raw: row,
  };
}

function buildInspectionSelector(config, selection, tableName = config.inspeccionesTable) {
  const column = config.inspeccionesDateColumn;
  const table = tableName;
  if (selection.mode === "year") {
    return `Filter(${table}, YEAR([${column}]) = ${selection.year})`;
  }

  return `Filter(${table}, AND([${column}] >= (TODAY() - 365), [${column}] <= TODAY()))`;
}

function isInspectionInSelection(inspection, selection) {
  if (!(inspection.date instanceof Date) || Number.isNaN(inspection.date.getTime())) return false;
  if (selection.mode === "year") return inspection.date.getFullYear() === selection.year;

  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - 12);
  startDate.setHours(0, 0, 0, 0);
  return inspection.date >= startDate && inspection.date <= endDate;
}

async function loadDataset(selection = getDefaultSelection(), force = false) {
  const normalizedSelection = normalizeSelection(selection.mode, selection.year);
  const cacheKey = `${normalizedSelection.mode}:${normalizedSelection.mode === "year" ? normalizedSelection.year : "last12months"}`;
  const cached = datasetCache.get(cacheKey);
  const now = Date.now();
  if (!force && cached && cached.expireAt > now) {
    return cached.promise;
  }

  const promise = (async () => {
    const config = getConfig();
    const [branchRows, categoryResult, inspectionResult] = await Promise.all([
      fetchAppSheetTable(config, config.sucursalesTable, `Filter(${config.sucursalesTable}, true)`),
      fetchAppSheetTableByAliases(config, config.categoriaTableAliases, (tableName) => `Filter(${tableName}, true)`),
      fetchAppSheetTableByAliases(config, config.inspeccionesTableAliases, (tableName) => buildInspectionSelector(config, normalizedSelection, tableName)),
    ]);

    const categoryRows = categoryResult.rows;
    const inspectionRows = inspectionResult.rows;

    const branches = branchRows.map((row) => normalizeBranchRow(row, config)).filter((row) => row.id || row.label);
    const categories = categoryRows.map((row) => normalizeCategoryRow(row, config)).filter((row) => row.id || row.label);
    const branchLookups = buildLookupMaps(branches, (row) => row.label || row.id);
    const categoryLookups = buildLookupMaps(categories, (row) => row.label || row.id);
    const inspections = inspectionRows
      .map((row) => normalizeInspectionRow(row, config, branchLookups, categoryLookups))
      .filter((row) => row.id || row.branchId || row.observation || row.categoryLabel)
      .filter((row) => isInspectionInSelection(row, normalizedSelection));

    const inspectionsByBranch = new Map();
    for (const inspection of inspections) {
      const key = inspection.branchId || inspection.branchLabel || "sin-sucursal";
      if (!inspectionsByBranch.has(key)) inspectionsByBranch.set(key, []);
      inspectionsByBranch.get(key).push(inspection);
    }

    const branchesWithStats = branches
      .map((branch) => {
        const branchInspections = inspectionsByBranch.get(branch.id) || inspectionsByBranch.get(branch.label) || [];
        const totalImages = branchInspections.reduce((sum, item) => sum + item.images.length, 0);
        const lastDate = branchInspections
          .map((item) => item.date)
          .filter(Boolean)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        const categoriesCount = new Map();
        for (const inspection of branchInspections) {
          const key = inspection.categoryLabel || "Sin categoría";
          categoriesCount.set(key, (categoriesCount.get(key) || 0) + 1);
        }
        const topCategories = [...categoriesCount.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([label, count]) => ({ label, count }));

        return {
          ...branch,
          inspectionCount: branchInspections.length,
          imageCount: totalImages,
          lastInspectionDate: lastDate ? lastDate.toISOString() : "",
          lastInspectionLabel: lastDate ? formatDateShort(lastDate) : "",
          topCategories,
        };
      })
      .filter((branch) => branch.inspectionCount > 0)
      .sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id), "es-MX", { numeric: true, sensitivity: "base" }));

    return {
      config,
      selection: normalizedSelection,
      periodLabel: getPeriodLabel(normalizedSelection),
      branches: branchesWithStats,
      inspections,
      inspectionsByBranch,
      inspectionTableName: inspectionResult.tableName,
      categoryTableName: categoryResult.tableName,
    };
  })();

  datasetCache.set(cacheKey, { expireAt: now + CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    datasetCache.delete(cacheKey);
    throw error;
  }
}

function resolveSelectedBranch(dataset, branchId) {
  if (!branchId) return dataset.branches[0] || null;
  return dataset.branches.find((branch) => branch.id === branchId || branch.label === branchId || branch.displayLabel === branchId) || null;
}

async function resolveInspectionImages(config, inspections) {
  const resolved = [];
  for (const inspection of inspections) {
    const imagesResolved = [];
    for (const raw of inspection.images) {
      const source = await resolveImageSource(config, config.inspeccionesTable, raw);
      if (source) imagesResolved.push(source);
    }
    resolved.push({ ...inspection, imagesResolved });
  }
  return resolved;
}

function buildReportSummary(selectedBranch, inspections, dataset) {
  const categoryCount = new Map();
  let imageCount = 0;
  for (const inspection of inspections) {
    const category = inspection.categoryLabel || "Sin categoría";
    categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
    imageCount += inspection.imagesResolved?.length || inspection.images.length || 0;
  }

  return {
    branchLabel: selectedBranch?.label || selectedBranch?.displayLabel || selectedBranch?.id || "",
    periodLabel: dataset.periodLabel,
    inspectionCount: inspections.length,
    imageCount,
    topCategories: [...categoryCount.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
  };
}

const COMPANY_BRANDING = {
  legalName: "González Gámez y Asociados",
  rfc: "GGA230218GL3",
  address: "Río Tehuantepec 1397, Local 6, Col. Morelos, C.P. 80170, Culiacán Rosales, Sinaloa.",
  contact: "WhatsApp: (667) 305 9813 · Cel: (667) 495 0697 · Oficina: (667) 690 2218",
  logoUrl: "https://drive.google.com/thumbnail?id=15YmFa3PwCXcZCdgzrtlFGcdIGXXF0XvL&sz=w400",
};

let companyLogoPromise = null;

async function getCompanyBranding() {
  companyLogoPromise ||= remoteUrlToDataUri(COMPANY_BRANDING.logoUrl).catch(() => "");
  return { ...COMPANY_BRANDING, logo: await companyLogoPromise };
}

function buildReportHtml({ selectedBranch, inspections, summary, branding }) {
  const coverMeta = [
    { label: "Dirección", value: selectedBranch?.direccion || "Sin dirección registrada" },
    { label: "Tienda", value: selectedBranch?.tienda || "-" },
    { label: "Periodo", value: summary.periodLabel },
  ];

  const categorySummary = summary.topCategories.length
    ? summary.topCategories.slice(0, 8).map((item) => {
        const percentage = summary.inspectionCount ? Math.round((item.count / summary.inspectionCount) * 100) : 0;
        return `<div class="category-row">
          <div class="category-copy"><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></div>
          <div class="category-track"><i style="width:${percentage}%"></i></div>
        </div>`;
      }).join("")
    : `<span class="empty-chip">Sin categorías detectadas</span>`;

  const observationsHtml = inspections.length
    ? inspections.map((inspection, index) => {
        const imagesHtml = inspection.imagesResolved?.length
          ? inspection.imagesResolved.map((src, imageIndex) => `
              <figure class="photo-card">
                <img src="${escapeHtml(src)}" alt="Imagen ${imageIndex + 1} de la observación ${index + 1}">
                <figcaption>Imagen ${imageIndex + 1}</figcaption>
              </figure>`).join("")
          : `<div class="empty-images">Sin imágenes adjuntas</div>`;

        return `
          <article class="observation-card">
            <div class="observation-head">
              <div>
                <p class="observation-label">Observación ${index + 1}</p>
                <h3>${escapeHtml(inspection.categoryLabel || "Sin categoría")}</h3>
              </div>
              <div class="observation-date">${escapeHtml(inspection.dateLabel || "Fecha no disponible")}</div>
            </div>
            <div class="observation-body">
              <p class="observation-text">${escapeHtml(inspection.observation || "Sin observación registrada")}</p>
            </div>
            <div class="photo-grid">${imagesHtml}</div>
          </article>`;
      }).join("")
    : `<section class="empty-state">
        <h3>Sin observaciones para este periodo</h3>
        <p>No se encontraron inspecciones para la sucursal y el rango seleccionados.</p>
      </section>`;

  const script = `
    const state = {
      branches: [],
      filteredBranches: [],
      periodOptions: [],
      busy: false,
    };

    const routeBase = window.location.pathname.replace(/\\/$/, "");
    const apiUrl = (path) => routeBase + "/api/" + path;

    const els = {
      search: document.getElementById("search"),
      period: document.getElementById("period"),
      branch: document.getElementById("branch"),
      loadingStatus: document.getElementById("loading-status"),
      statBranches: document.getElementById("stat-branches"),
      statObservations: document.getElementById("stat-observations"),
      statImages: document.getElementById("stat-images"),
      statPeriod: document.getElementById("stat-period"),
      categoryChips: document.getElementById("category-chips"),
      previewFrame: document.getElementById("preview-frame"),
      previewBtn: document.getElementById("preview-btn"),
      pdfBtn: document.getElementById("pdf-btn"),
    };

    function setBusy(nextBusy, message) {
      state.busy = nextBusy;
      els.previewBtn.disabled = nextBusy;
      els.pdfBtn.disabled = nextBusy;
      if (message) {
        els.loadingStatus.textContent = message;
      }
    }

    function setError(message) {
      els.loadingStatus.textContent = message;
      els.loadingStatus.style.color = "#b91c1c";
      setBusy(false);
    }

    function renderPeriodOptions(options) {
      els.period.innerHTML = options.map((option) => '<option value="' + option.value + '">' + option.label + '</option>').join("");
    }

    function renderBranchOptions(rows) {
      if (!rows.length) {
        els.branch.innerHTML = '<option value="">Sin resultados</option>';
        return;
      }

      els.branch.innerHTML = rows.map((row) => {
        const detail = [row.tienda, row.direccion].filter(Boolean).join(" · ");
        const extra = row.inspectionCount ? " · " + row.inspectionCount + " obs." : "";
        return '<option value="' + row.id + '">' + row.label + (detail ? " · " + detail : "") + extra + '</option>';
      }).join("");
    }

    function updateStats(summary) {
      els.statBranches.textContent = String(state.filteredBranches.length || 0);
      els.statObservations.textContent = String(summary?.inspectionCount ?? 0);
      els.statImages.textContent = String(summary?.imageCount ?? 0);
      els.statPeriod.textContent = summary?.periodLabel || "-";

      const topCategories = summary?.topCategories || [];
      els.categoryChips.innerHTML = topCategories.length
        ? topCategories.slice(0, 8).map((item) => '<span class="chip">' + item.label + ' <strong>' + item.count + '</strong></span>').join("")
        : '<span class="empty-chip">Sin categorías detectadas</span>';
    }

    function filterBranches() {
      const query = els.search.value.trim().toLowerCase();
      const currentId = els.branch.value;

      state.filteredBranches = !query
        ? [...state.branches]
        : state.branches.filter((row) => {
            const haystack = [row.id, row.label, row.displayLabel, row.tienda, row.direccion].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(query);
          });

      renderBranchOptions(state.filteredBranches);
      if (state.filteredBranches.some((row) => row.id === currentId)) {
        els.branch.value = currentId;
      } else if (state.filteredBranches[0]) {
        els.branch.value = state.filteredBranches[0].id;
      }
      els.statBranches.textContent = String(state.filteredBranches.length || 0);
      els.loadingStatus.textContent = state.filteredBranches.length + " sucursales visibles";
    }

    async function fetchJson(url, options = {}) {
      const res = await fetch(url, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || ("Error " + res.status));
      }
      return data;
    }

    function getPayload() {
      return {
        id: els.branch.value,
        period: els.period.value,
      };
    }

    async function loadDefaults() {
      const data = await fetchJson(apiUrl("defaults"));
      state.periodOptions = data.periodOptions || [];
      renderPeriodOptions(state.periodOptions);
      els.period.value = data.defaultPeriod || "last12months";
    }

    async function loadBranches() {
      const params = new URLSearchParams({ period: els.period.value });
      const data = await fetchJson(apiUrl("sucursales?" + params.toString()));
      state.branches = data.branches || [];
      state.filteredBranches = [...state.branches];
      renderBranchOptions(state.filteredBranches);
      if (state.filteredBranches[0]) {
        els.branch.value = state.filteredBranches[0].id;
      }
      updateStats(data.summary || {});
      els.loadingStatus.textContent = state.branches.length + " sucursales con inspecciones";
      els.loadingStatus.style.color = "";
    }

    async function loadData() {
      setBusy(true, "Cargando inspecciones...");
      try {
        await loadBranches();
        filterBranches();
        if (!els.branch.value && state.filteredBranches[0]) {
          els.branch.value = state.filteredBranches[0].id;
        }
      } catch (error) {
        setError(error.message || "No se pudieron cargar los datos.");
      } finally {
        setBusy(false);
      }
    }

    async function previewDocument() {
      try {
        setBusy(true, "Generando vista previa...");
        const res = await fetch(apiUrl("preview"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(getPayload()),
        });

        const html = await res.text();
        if (!res.ok) {
          const errorData = JSON.parse(html || "{}");
          throw new Error(errorData.error || ("Error " + res.status));
        }

        els.previewFrame.removeAttribute("src");
        els.previewFrame.srcdoc = html;
        els.loadingStatus.textContent = "Vista previa actualizada";
        els.loadingStatus.style.color = "";
      } catch (error) {
        setError(error.message || "No se pudo generar la vista previa.");
      } finally {
        setBusy(false);
      }
    }

    async function downloadPdf() {
      try {
        setBusy(true, "Generando PDF...");
        const res = await fetch(apiUrl("pdf"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(getPayload()),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || ("Error " + res.status));
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const header = res.headers.get("Content-Disposition") || "";
        const match = header.match(/filename\\*=UTF-8''([^;]+)/);
        const fallback = header.match(/filename="([^"]+)"/);
        const fileName = match ? decodeURIComponent(match[1]) : (fallback ? fallback[1] : "reporte.pdf");

        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        els.loadingStatus.textContent = "PDF generado correctamente";
        els.loadingStatus.style.color = "";
      } catch (error) {
        setError(error.message || "No se pudo generar el PDF.");
      } finally {
        setBusy(false);
      }
    }

    async function refreshAll() {
      await loadData();
      await previewDocument();
    }

    async function bootstrap() {
      try {
        await loadDefaults();
        await refreshAll();
      } catch (error) {
        setError(error.message || "No se pudo iniciar el reporte.");
      }
    }

    els.search.addEventListener("input", filterBranches);
    els.period.addEventListener("change", async () => {
      await refreshAll();
    });
    els.branch.addEventListener("change", previewDocument);
    els.previewBtn.addEventListener("click", previewDocument);
    els.pdfBtn.addEventListener("click", downloadPdf);

    bootstrap();
  `;

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(`Reporte de inspecciones - ${selectedBranch?.label || selectedBranch?.id || "Sucursal"}`)}</title>
  <style>
    :root {
      --bg: #edf1f5;
      --paper: #ffffff;
      --ink: #1a2a3a;
      --muted: #667483;
      --navy: #1a2a3a;
      --crimson: #c0392b;
      --gold: #d6a43a;
      --line: #d9e0e6;
      --shadow: 0 16px 36px rgba(26, 42, 58, 0.09);
    }
    * { box-sizing: border-box; }
    @page { size: Letter; margin: 10mm 8mm 24mm; }
    html { background: #ffffff; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top right, rgba(192,57,43,0.08), transparent 24%),
        linear-gradient(180deg, #f8fafc 0%, var(--bg) 100%);
      color: var(--ink);
      font-family: "Montserrat", "Segoe UI", sans-serif;
    }
    .page {
      width: 100%;
      max-width: 215.9mm;
      margin: 0 auto;
      padding: 28px;
    }
    .hero, .panel, .empty-state, .observation-card {
      border: 1px solid rgba(215, 224, 231, 0.94);
      border-radius: 18px;
      background: var(--paper);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .hero {
      position: relative;
      padding: 30px 32px;
      margin-bottom: 18px;
      background: linear-gradient(135deg, #1a2a3a 0%, #263e52 100%);
      color: #ffffff;
      border-top: 5px solid var(--crimson);
    }
    .brand-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 24px;
      align-items: start;
    }
    .brand-company { text-align: right; }
    .brand-logo { display: block; width: 78px; max-height: 78px; margin: 0 0 8px auto; object-fit: contain; }
    .brand-legal { color: #ffffff; font-size: 0.72rem; font-weight: 800; line-height: 1.35; text-transform: uppercase; }
    .brand-rfc { margin-top: 3px; color: #cbd6df; font-size: 0.68rem; }
    .eyebrow {
      margin: 0 0 10px;
      color: #f0c45f;
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }
    .hero h1 {
      margin: 0;
      font-family: Georgia, serif;
      font-size: clamp(1.9rem, 4vw, 3rem);
      line-height: 1.04;
      text-transform: uppercase;
    }
    .hero p {
      margin: 14px 0 0;
      max-width: 880px;
      color: #d9e2e9;
      line-height: 1.55;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 18px;
      margin-bottom: 18px;
    }
    .summary-card {
      border: 1px solid rgba(215, 224, 231, 0.94);
      border-radius: 18px;
      background: var(--paper);
      box-shadow: var(--shadow);
      padding: 22px 24px;
    }
    .summary-card h2 {
      margin: 0 0 14px;
      font-size: 0.92rem;
      font-weight: 900;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1.6fr 0.65fr 0.85fr;
      gap: 12px;
    }
    .meta-item {
      border-radius: 12px;
      border: 1px solid #dbe5eb;
      background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,248,251,0.94));
      padding: 14px;
    }
    .meta-item span {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 0.7rem;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .meta-item strong {
      display: block;
      line-height: 1.4;
      font-size: 0.96rem;
    }
    .chip-list { display: grid; gap: 11px; }
    .category-copy { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 0.82rem; }
    .category-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .category-copy strong { color: var(--navy); }
    .category-track { height: 5px; margin-top: 6px; overflow: hidden; border-radius: 999px; background: #e9eef2; }
    .category-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--crimson), var(--gold)); }
    .chip,
    .empty-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      padding: 10px 12px;
      background: #eef7f6;
      color: #0f766e;
      border: 1px solid #d7ece8;
      font-size: 0.84rem;
      font-weight: 700;
    }
    .chip strong {
      color: var(--ink);
    }
    .observations-stack {
      display: grid;
      gap: 16px;
    }
    .observation-card {
      page-break-inside: avoid;
      break-inside: avoid;
      border-left: 4px solid var(--crimson);
    }
    .observation-head {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-start;
      padding: 18px 20px 0;
    }
    .observation-label {
      margin: 0 0 8px;
      color: var(--crimson);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .observation-head h3 {
      margin: 0;
      font-size: 1.1rem;
      line-height: 1.25;
    }
    .observation-date {
      padding: 8px 12px;
      border-radius: 999px;
      background: #f0f6f8;
      border: 1px solid #d9e5ec;
      color: #425667;
      font-size: 0.84rem;
      white-space: nowrap;
    }
    .observation-body { padding: 14px 20px 4px; }
    .observation-text {
      margin: 0;
      line-height: 1.72;
      color: #24323b;
      white-space: pre-wrap;
    }
    .observation-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      padding: 12px 20px 20px;
    }
    .photo-card {
      margin: 0;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #d9e3ea;
      background: #f3f6f8;
      text-align: center;
    }
    .photo-card img {
      width: auto;
      max-width: 100%;
      height: auto;
      max-height: 620px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      background: #e9eef2;
    }
    .photo-card figcaption {
      padding: 10px 12px;
      font-size: 0.78rem;
      color: var(--muted);
      border-top: 1px solid #edf2f6;
    }
    .executive-kpis {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 22px;
      max-width: 620px;
    }
    .executive-kpi {
      padding: 11px 13px;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 10px;
      background: rgba(255,255,255,0.08);
    }
    .executive-kpi strong { display: block; color: #ffffff; font-size: 1.35rem; }
    .executive-kpi span { display: block; margin-top: 2px; color: #cbd6df; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    .empty-images, .empty-state {
      padding: 18px 20px;
      color: var(--muted);
    }
    .empty-state h3 {
      margin: 0 0 8px;
      color: var(--ink);
      font-size: 1.1rem;
    }
    .company-footer {
      margin-top: 18px;
      padding: 10px 14px;
      background: var(--crimson);
      color: #ffffff;
      font-size: 0.68rem;
      line-height: 1.35;
    }
    .company-footer-inner { display: flex; justify-content: space-between; gap: 16px; }
    @media (max-width: 1180px) {
      .summary-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .page { padding: 16px; }
      .hero, .summary-card, .observation-card { border-radius: 22px; }
      .meta-grid { grid-template-columns: 1fr; }
      .observation-head { flex-direction: column; }
      .observation-date { white-space: normal; }
      .photo-card img { max-height: 520px; }
      .executive-kpis { grid-template-columns: 1fr; }
      .brand-header { grid-template-columns: 1fr; }
      .brand-company { text-align: left; }
      .brand-logo { margin-left: 0; }
      .company-footer-inner { display: block; }
    }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { background: #ffffff; font-size: 10px; }
      .page { max-width: none; padding: 0; }
      .hero, .summary-card, .observation-card { box-shadow: none; }
      .hero, .summary-grid, .observation-card, .photo-card { break-inside: avoid; page-break-inside: avoid; }
      .company-footer { position: fixed; left: 0; right: 0; bottom: 0; margin: 0; min-height: 14mm; }
      .photo-card img { max-height: 155mm; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="brand-header">
        <div>
          <p class="eyebrow">Desarrollo EG · Informe ejecutivo</p>
          <h1>${escapeHtml(selectedBranch?.label || selectedBranch?.id || "Reporte de inspecciones")}</h1>
          <p>Resumen de hallazgos de inspección, organizado por categoría y respaldado con evidencia fotográfica.</p>
        </div>
        <div class="brand-company">
          ${branding.logo ? `<img class="brand-logo" src="${escapeHtml(branding.logo)}" alt="Desarrollo EG">` : ""}
          <div class="brand-legal">${escapeHtml(branding.legalName)}</div>
          <div class="brand-rfc">RFC: ${escapeHtml(branding.rfc)}</div>
        </div>
      </div>
      <div class="executive-kpis">
        <div class="executive-kpi"><strong>${summary.inspectionCount}</strong><span>Hallazgos</span></div>
        <div class="executive-kpi"><strong>${summary.imageCount}</strong><span>Evidencias</span></div>
        <div class="executive-kpi"><strong>${summary.topCategories.length}</strong><span>Categorías</span></div>
      </div>
    </section>
    <section class="summary-grid">
      <article class="summary-card">
        <h2>Información general</h2>
        <div class="meta-grid">
          ${coverMeta.map((item) => `<div class="meta-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}
        </div>
      </article>
      <article class="summary-card">
        <h2>Distribución de hallazgos</h2>
        <div class="chip-list">${categorySummary}</div>
      </article>
    </section>

    <section class="observations-stack">
      ${observationsHtml}
    </section>
    <footer class="company-footer">
      <div class="company-footer-inner">
        <span>${escapeHtml(branding.address)}</span>
        <span>${escapeHtml(branding.contact)}</span>
      </div>
    </footer>
  </main>

</body>
</html>`;
}

export async function getReportDefaults() {
  return {
    defaultPeriod: "last12months",
    periodOptions: buildPeriodOptions(),
    title: "Reporte de Inspecciones",
  };
}

export async function listSucursalesConInspecciones({ period, year, q = "" } = {}) {
  const selection = normalizeSelection(period, year);
  const dataset = await loadDataset(selection);
  const query = String(q || "").trim().toLowerCase();
  const branches = query
    ? dataset.branches.filter((branch) => {
        const haystack = [branch.id, branch.label, branch.displayLabel, branch.tienda, branch.direccion].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(query);
      })
    : dataset.branches;

  const categoryCount = new Map();
  for (const inspection of dataset.inspections) {
    const key = inspection.categoryLabel || "Sin categoría";
    categoryCount.set(key, (categoryCount.get(key) || 0) + 1);
  }

  return {
    period: selection.mode,
    year: selection.year,
    periodLabel: dataset.periodLabel,
    summary: {
      branchCount: branches.length,
      inspectionCount: dataset.inspections.length,
      imageCount: branches.reduce((sum, branch) => sum + (branch.imageCount || 0), 0),
      topCategories: [...categoryCount.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
    },
    branches,
    periodOptions: buildPeriodOptions(),
  };
}

export async function renderInspectionReportHtml({ id, period, year } = {}) {
  const selection = normalizeSelection(period, year);
  const dataset = await loadDataset(selection);
  const selectedBranch = resolveSelectedBranch(dataset, id);
  if (!selectedBranch) {
    throw new Error("Debes seleccionar una sucursal con inspecciones.");
  }

  const branchInspectionsRaw = dataset.inspections.filter((inspection) => inspection.branchId === selectedBranch.id || inspection.branchLabel === selectedBranch.label);
  const branchInspections = await resolveInspectionImages(dataset.config, branchInspectionsRaw);
  const summary = buildReportSummary(selectedBranch, branchInspections, dataset);
  const branding = await getCompanyBranding();
  const html = buildReportHtml({
    selectedBranch,
    inspections: branchInspections.sort((a, b) => {
      const left = a.date ? a.date.getTime() : 0;
      const right = b.date ? b.date.getTime() : 0;
      return right - left;
    }),
    summary,
    branding,
  });

  const fileBaseName = `${slugify("reporte-inspecciones")}-${slugify(selectedBranch.label || selectedBranch.id)}-${slugify(summary.periodLabel)}`;
  return { html, row: selectedBranch.raw, fileBaseName };
}

export async function renderInspectionReportPdf(params = {}) {
  const config = getConfig();
  await fs.access(config.chromePath).catch(() => {
    throw new Error(`No se encontro Chrome: ${config.chromePath}`);
  });

  const { html, row, fileBaseName } = await renderInspectionReportHtml(params);
  const browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all([...document.images].map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }));
    });
    const pdfBytes = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
    });
    return { buffer: Buffer.from(pdfBytes), row, fileBaseName };
  } finally {
    await browser.close();
  }
}
