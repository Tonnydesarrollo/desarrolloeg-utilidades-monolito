import fs from "fs";
import path from "path";
import https from "https";
import fetch from "node-fetch";
import {
  replaceCalendarioEmpleadosLocalRows,
  replaceCapacitacionCapacitadoresLocalRows,
  replaceCapacitacionSucursalesLocalRows,
  replaceCotizacionCentrosTrabajoLocalRows,
  upsertCalendarioLocalRows,
  upsertCatalogoLocalRows,
  upsertConceptosCotizacionLocalRows,
  upsertCotizacionesLocalRows,
  getCapacitacionesLocalRows,
  getCalendarioEmpleadosLocalRows,
  getEmpleadosLocalRows,
  getEmpresasLocalRows,
  getCalendarioLocalRows,
  getCatalogoLocalRows,
  getConceptosCotizacionLocalRows,
  getCotizacionCentrosTrabajoLocalRows,
  getCotizacionesLocalRows,
  getEstatalesLocalRows,
  getEstadosLocalRows,
  getMunicipiosLocalRows,
  getMunicipalesLocalRows,
  getProveedoresLocalRows,
  getSucursalesLocalRows,
  upsertCapacitacionesLocalRows,
  upsertEmpleadosLocalRows,
  upsertEmpresasLocalRows,
  upsertEstatalesLocalRows,
  upsertCapacitacionCapacitadoresLocalRows,
  upsertCapacitacionSucursalesLocalRows,
  upsertProveedoresLocalRows,
  upsertEstadosLocalRows,
  upsertMunicipiosLocalRows,
  upsertMunicipalesLocalRows,
  upsertSucursalesLocalRows,
} from "../services/localAppsheetDb.js";

const JOB_ID = "appsheet-base-sync";
const LOGS_DIR = path.resolve(process.env.RUNTIME_LOGS_DIR || path.join(process.cwd(), "runtime", "logs"));
const JOB_LOG_PATH = path.join(LOGS_DIR, `${JOB_ID}.log`);
const APPSHEET_TIMEOUT_MS = Math.max(5000, Number(process.env.APPSHEET_TIMEOUT_MS || 20000));
const APPSHEET_MAX_RETRIES = Math.max(0, Number(process.env.APPSHEET_MAX_RETRIES || 3));
const APPSHEET_RETRY_BASE_MS = Math.max(100, Number(process.env.APPSHEET_RETRY_BASE_MS || 500));
const APPSHEET_RETRY_MAX_MS = Math.max(APPSHEET_RETRY_BASE_MS, Number(process.env.APPSHEET_RETRY_MAX_MS || 5000));
const appsheetAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 8,
});

function log(message, details = null) {
  const line = `[${new Date().toISOString()}] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`;
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(JOB_LOG_PATH, `${line}\n`, "utf8");
  } catch {
    // Si el log falla, no interrumpimos la sincronizacion.
  }
  console.log(`[${JOB_ID}] ${message}`, details || "");
}

function firstEnv(names, fallback = "") {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return fallback;
}

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function countFilledFields(row) {
  return Object.values(row || {}).reduce((count, value) => {
    if (value === null || value === undefined) return count;
    if (typeof value === "string" && !String(value).trim()) return count;
    if (Array.isArray(value) && value.length === 0) return count;
    return count + 1;
  }, 0);
}

function mergeRowFields(baseRow, nextRow) {
  const merged = { ...baseRow };
  for (const [key, value] of Object.entries(nextRow || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !String(value).trim()) continue;
    if (merged[key] === null || merged[key] === undefined || (typeof merged[key] === "string" && !String(merged[key]).trim())) {
      merged[key] = value;
    }
  }
  return merged;
}

function parseListValues(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => parseListValues(item))
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  return String(value)
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function keyValueForTable(row, keyField) {
  const candidates = [keyField, keyField.toUpperCase(), keyField.toLowerCase()];
  if (keyField === "row_id") candidates.push("Row ID", "ROW ID");
  for (const key of candidates) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APPSHEET_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, agent: appsheetAgent, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getRetryDelayMs(attempt) {
  const exp = Math.min(APPSHEET_RETRY_BASE_MS * Math.pow(2, attempt - 1), APPSHEET_RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

async function fetchWithRetry(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= APPSHEET_MAX_RETRIES + 1; attempt += 1) {
    try {
      return await fetchWithTimeout(url, options);
    } catch (error) {
      lastError = error;
      if (attempt > APPSHEET_MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(attempt)));
    }
  }
  throw lastError || new Error("AppSheet fetch fallo");
}

function buildSourceConfigs() {
  return [
    {
      name: "finanzas",
      appId: firstEnv(["FINANZAS_APPSHEET_APP_ID", "APPSHEET_APP_ID"]),
      apiKey: firstEnv(["FINANZAS_APPSHEET_API_KEY", "APPSHEET_API_KEY", "APPSHEET_ACCESS_KEY"]),
      region: firstEnv(["FINANZAS_APPSHEET_REGION", "APPSHEET_REGION"], "api.appsheet.com"),
      locale: firstEnv(["FINANZAS_APPSHEET_LOCALE", "APPSHEET_LOCALE"], "es-MX"),
      timezone: firstEnv(["FINANZAS_APPSHEET_TIMEZONE", "APPSHEET_TIMEZONE"], "America/Mexico_City"),
    },
    {
      name: "desarrolloeg_v2",
      appId: firstEnv(["DESARROLLOEG_APPSHEET_APP_ID", "DESARROLLOEG_V2_APPSHEET_APP_ID"]),
      apiKey: firstEnv(["DESARROLLOEG_APPSHEET_ACCESS_KEY", "DESARROLLOEG_V2_APPSHEET_API_KEY", "DESARROLLOEG_V2_APPSHEET_ACCESS_KEY"]),
      region: firstEnv(["DESARROLLOEG_APPSHEET_REGION", "DESARROLLOEG_V2_APPSHEET_REGION"], "www.appsheet.com"),
      locale: firstEnv(["DESARROLLOEG_APPSHEET_LOCALE", "DESARROLLOEG_V2_APPSHEET_LOCALE"], "es-MX"),
      timezone: firstEnv(["DESARROLLOEG_APPSHEET_TIMEZONE", "DESARROLLOEG_V2_APPSHEET_TIMEZONE"], "America/Mexico_City"),
    },
  ].filter((source) => source.appId && source.apiKey);
}

function isMissingTableError(error) {
  const message = String(error?.message || error || "");
  return /Table or slice .* was not found/i.test(message);
}

async function fetchTableRows(source, tableName) {
  const url = `https://${source.region}/api/v2/apps/${source.appId}/tables/${encodeURIComponent(tableName)}/Action`;
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      ApplicationAccessKey: source.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Action: "Find",
      Properties: {
        Locale: source.locale,
        Timezone: source.timezone,
        UserSettings: {},
      },
      Rows: [],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AppSheet ${source.name} ${tableName} fallo (${response.status}): ${text}`);
  }

  if (!text.trim()) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed?.Rows || parsed?.rows || []);
}

function mergeRowsByKey(rows, keyField) {
  const merged = new Map();
  for (const row of rows) {
    const key = keyValueForTable(row, keyField);
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { row: { ...row }, score: countFilledFields(row) });
      continue;
    }

    const nextScore = countFilledFields(row);
    const combined = mergeRowFields(existing.row, row);
    const combinedScore = countFilledFields(combined);
    merged.set(key, {
      row: combinedScore >= existing.score || nextScore > existing.score ? combined : existing.row,
      score: Math.max(existing.score, nextScore, combinedScore),
    });
  }

  return [...merged.values()].map((entry) => entry.row);
}

function normalizeReferenceList(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .join(", ");
  }
  return normalizeText(value);
}

function enrichSucursalRows(rows, { municipios, estados, empresas }) {
  const municipiosMap = new Map();
  for (const row of municipios) {
    const id = keyValueForTable(row, "id");
    if (!id) continue;
    municipiosMap.set(id, normalizeText(row?.nombre || row?.NOMBRE || row?.Nombre));
  }

  const estadosMap = new Map();
  for (const row of estados) {
    const id = keyValueForTable(row, "id");
    if (!id) continue;
    estadosMap.set(id, normalizeText(row?.nombre || row?.NOMBRE || row?.Nombre));
  }

  const empresasMap = new Map();
  for (const row of empresas) {
    const id = keyValueForTable(row, "id");
    if (!id) continue;
    empresasMap.set(id, normalizeText(row?.razon_social || row?.["RAZON SOCIAL"] || row?.["Razón Social"] || row?.["Razon Social"]));
  }

  return rows.map((row) => {
    const municipioId = normalizeText(row?.municipio_id || row?.MUNICIPIO || row?.Municipio || row?.municipio);
    const estadoId = normalizeText(row?.estado_id || row?.ESTADO || row?.Estado || row?.estado);
    const empresaId = normalizeText(row?.empresa_id || row?.EMPRESA || row?.Empresa || row?.["ID EMPRESA"]);

    return {
      ...row,
      municipio_id: municipioId || null,
      municipio_nombre: row?.municipio_nombre || municipiosMap.get(municipioId) || "",
      estado_id: estadoId || null,
      estado_nombre: row?.estado_nombre || estadosMap.get(estadoId) || "",
      empresa_id: empresaId || null,
      empresa_nombre: row?.empresa_nombre || empresasMap.get(empresaId) || "",
      label: row?.label || row?.LABEL || row?.Label || row?.nombre || row?.NOMBRE || "",
      label2: row?.label2 || row?.LABEL2 || row?.Label2 || "",
      nombre: row?.nombre || row?.NOMBRE || row?.Label || row?.LABEL || "",
      tienda: row?.tienda || row?.TIENDA || row?.Tienda || row?.ID || row?.id || "",
      id_pc: row?.id_pc || row?.ID_PC || row?.["ID PC"] || "",
      vencimiento_estatal: row?.vencimiento_estatal || row?.["VENCIMIENTO ESTATAL"] || row?.VENCIMIENTOESTATAL || row?.["ULTIMO PIPC ESTATAL"] || "",
      vencimiento_municipal: row?.vencimiento_municipal || row?.["VENCIMIENTO MUNICIPAL"] || row?.VENCIMIENTOMUNICIPAL || row?.["ULTIMO MUNICIPAL"] || "",
      trabajos: row?.trabajos || row?.TRABAJOS || row?.Trabajos || "",
      tipo: row?.tipo || row?.TIPO || row?.Tipo || "",
      nivel_riesgo: row?.nivel_riesgo || row?.["NIVEL DE RIESGO"] || row?.["Nivel de Riesgo"] || "",
      precio_estatal: row?.precio_estatal ?? row?.["PRECIO ESTATAL"] ?? row?.PrecioEstatal ?? null,
      precio_municipal: row?.precio_municipal ?? row?.["PRECIO MUNICIPAL"] ?? row?.PrecioMunicipal ?? null,
      ultimo_pipc_estatal: row?.ultimo_pipc_estatal || row?.["ULTIMO PIPC ESTATAL"] || "",
      ultimo_municipal: row?.ultimo_municipal || row?.["ULTIMO MUNICIPAL"] || "",
      pedido: row?.pedido || row?.PEDIDO || row?.Pedido || "",
      address: row?.address || row?.["DIRECCION GOOGLE"] || row?.["DIRECCION_GOOGLE"] || row?.DIRECCION || row?.DOMICILIO || "",
      street: row?.street || row?.STREET || row?.address || "",
      sucursales: normalizeReferenceList(row?.sucursales || row?.SUCURSALES),
      capacitadores: normalizeReferenceList(row?.capacitadores || row?.CAPACITADORES),
    };
  });
}

const TABLES = [
  {
    name: "EMPRESAS",
    keyField: "id",
    localUpdater: upsertEmpresasLocalRows,
  },
  {
    name: "MUNICIPIOS",
    keyField: "id",
    localUpdater: upsertMunicipiosLocalRows,
  },
  {
    name: "ESTADOS",
    keyField: "id",
    localUpdater: upsertEstadosLocalRows,
  },
  {
    name: "SUCURSALES",
    keyField: "id",
    localUpdater: upsertSucursalesLocalRows,
  },
  {
    name: "ESTATALES",
    keyField: "row_id",
    localUpdater: upsertEstatalesLocalRows,
  },
  {
    name: "MUNICIPALES",
    keyField: "row_id",
    localUpdater: upsertMunicipalesLocalRows,
  },
  {
    name: "EMPLEADOS",
    keyField: "row_id",
    localUpdater: upsertEmpleadosLocalRows,
  },
  {
    name: "CAPACITACIONES",
    keyField: "row_id",
    localUpdater: upsertCapacitacionesLocalRows,
  },
  {
    name: "CALENDARIO",
    keyField: "id",
    localUpdater: upsertCalendarioLocalRows,
  },
  {
    name: "CATALOGO",
    keyField: "row_id",
    localUpdater: upsertCatalogoLocalRows,
  },
  {
    name: "PROVEEDORES",
    keyField: "row_id",
    localUpdater: upsertProveedoresLocalRows,
  },
  {
    name: "COTIZACIONES_VARIOS_CT",
    keyField: "row_id",
    localUpdater: upsertCotizacionesLocalRows,
  },
  {
    name: "CONCEPTOS_VARIOS_CT",
    keyField: "row_id",
    localUpdater: upsertConceptosCotizacionLocalRows,
  },
];

function getSourceRowsByTable(sourceRows, tableName) {
  return sourceRows.get(tableName) || [];
}

export async function syncAppsheetBaseToLocal() {
  const sources = buildSourceConfigs();
  if (!sources.length) {
    throw new Error("No hay credenciales AppSheet disponibles para el sync base");
  }

  log("Iniciando sync base AppSheet -> local", {
    sources: sources.map((source) => ({ name: source.name, appId: source.appId })),
  });

  const fetchedBySource = new Map();
  const failures = [];

  for (const source of sources) {
    const tableRows = new Map();
    for (const table of TABLES) {
      try {
        const rows = await fetchTableRows(source, table.name);
        tableRows.set(table.name, rows);
      } catch (error) {
        if (!isMissingTableError(error)) {
          failures.push({ source: source.name, table: table.name, error: String(error?.message || error) });
        }
        tableRows.set(table.name, []);
      }
    }
    fetchedBySource.set(source.name, tableRows);
  }

  const combined = new Map();
  for (const table of TABLES) {
    const allRows = [];
    for (const source of sources) {
      const tableRows = fetchedBySource.get(source.name);
      const rows = getSourceRowsByTable(tableRows, table.name);
      allRows.push(...rows);
    }
    combined.set(table.name, mergeRowsByKey(allRows, table.keyField));
  }

  const empresas = combined.get("EMPRESAS") || [];
  const municipios = combined.get("MUNICIPIOS") || [];
  const estados = combined.get("ESTADOS") || [];
  const sucursales = enrichSucursalRows(combined.get("SUCURSALES") || [], { municipios, estados, empresas });
  const estatales = combined.get("ESTATALES") || [];
  const municipales = combined.get("MUNICIPALES") || [];
  const empleados = combined.get("EMPLEADOS") || [];
  const capacitaciones = combined.get("CAPACITACIONES") || [];
  const calendario = combined.get("CALENDARIO") || [];
  const catalogo = combined.get("CATALOGO") || [];
  const proveedores = combined.get("PROVEEDORES") || [];
  const cotizaciones = combined.get("COTIZACIONES_VARIOS_CT") || [];
  const conceptosCotizacion = combined.get("CONCEPTOS_VARIOS_CT") || [];

  const calendarioEmpleadosRows = [];
  for (const row of calendario) {
    const calendarioId = String(row?.ID || row?.id || "").trim();
    const empleadosList = parseListValues(row?.EMPLEADOS ?? row?.empleados);
    empleadosList.forEach((empleadoId, index) => {
      if (!calendarioId || !empleadoId) return;
      calendarioEmpleadosRows.push({
        id: `${calendarioId}::${empleadoId}`,
        calendario_id: calendarioId,
        empleado_id: empleadoId,
        orden: index + 1,
      });
    });
  }

  const capacitacionSucursalesRows = [];
  const capacitacionCapacitadoresRows = [];
  for (const row of capacitaciones) {
    const capacitacionId = String(row?.ID || row?.id || "").trim();
    parseListValues(row?.SUCURSALES ?? row?.sucursales).forEach((sucursalId, index) => {
      if (!capacitacionId || !sucursalId) return;
      capacitacionSucursalesRows.push({
        id: `${capacitacionId}::${sucursalId}`,
        capacitacion_id: capacitacionId,
        sucursal_id: sucursalId,
        orden: index + 1,
      });
    });
    parseListValues(row?.CAPACITADORES ?? row?.capacitadores).forEach((empleadoId, index) => {
      if (!capacitacionId || !empleadoId) return;
      capacitacionCapacitadoresRows.push({
        id: `${capacitacionId}::${empleadoId}`,
        capacitacion_id: capacitacionId,
        empleado_id: empleadoId,
        orden: index + 1,
      });
    });
  }

  const cotizacionCentrosTrabajoRows = [];
  for (const row of cotizaciones) {
    const cotizacionId = String(row?.ID || row?.id || row?.["Row ID"] || "").trim();
    parseListValues(row?.CENTROS_DE_TRABAJO ?? row?.CENTROS_TRABAJO ?? row?.["CENTROS DE TRABAJO"] ?? row?.centros_trabajo).forEach((sucursalId, index) => {
      if (!cotizacionId || !sucursalId) return;
      cotizacionCentrosTrabajoRows.push({
        id: `${cotizacionId}::${sucursalId}`,
        cotizacion_id: cotizacionId,
        sucursal_id: sucursalId,
        orden: index + 1,
      });
    });
  }

  upsertEmpresasLocalRows(empresas);
  upsertMunicipiosLocalRows(municipios);
  upsertEstadosLocalRows(estados);
  upsertSucursalesLocalRows(sucursales);
  upsertEstatalesLocalRows(estatales);
  upsertMunicipalesLocalRows(municipales);
  upsertEmpleadosLocalRows(empleados);
  upsertCapacitacionesLocalRows(capacitaciones);
  upsertCalendarioLocalRows(calendario);
  upsertCatalogoLocalRows(catalogo);
  upsertProveedoresLocalRows(proveedores);
  upsertCotizacionesLocalRows(cotizaciones);
  upsertConceptosCotizacionLocalRows(conceptosCotizacion);
  replaceCalendarioEmpleadosLocalRows(calendarioEmpleadosRows);
  replaceCapacitacionSucursalesLocalRows(capacitacionSucursalesRows);
  replaceCapacitacionCapacitadoresLocalRows(capacitacionCapacitadoresRows);
  replaceCotizacionCentrosTrabajoLocalRows(cotizacionCentrosTrabajoRows);

  const result = {
    ok: true,
    sources: sources.map((source) => source.name),
    tables: {
      empresas: getEmpresasLocalRows().length,
      municipios: getMunicipiosLocalRows().length,
      estados: getEstadosLocalRows().length,
      sucursales: getSucursalesLocalRows().length,
      estatales: getEstatalesLocalRows().length,
      municipales: getMunicipalesLocalRows().length,
      empleados: getEmpleadosLocalRows().length,
      capacitaciones: getCapacitacionesLocalRows().length,
      calendario: getCalendarioLocalRows().length,
      calendario_empleados: getCalendarioEmpleadosLocalRows().length,
      catalogo: getCatalogoLocalRows().length,
      proveedores: getProveedoresLocalRows().length,
      cotizaciones: getCotizacionesLocalRows().length,
      cotizacion_centros_trabajo: getCotizacionCentrosTrabajoLocalRows().length,
      conceptos_cotizacion: getConceptosCotizacionLocalRows().length,
    },
    failures,
  };

  log("Sync base AppSheet -> local completado", result);
  return result;
}
