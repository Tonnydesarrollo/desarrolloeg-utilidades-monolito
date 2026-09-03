import fetch from "node-fetch";
import https from "https";
import auth from "../utils/auth.js";
import { crearDriveClient, construirThumbnailDesdeLogoPath } from "../utils/drive.utils.js";
import {
  deletePersistentCacheEntry,
  deletePersistentCacheNamespace,
  getPersistentCacheEntry,
  setPersistentCacheEntry,
} from "../../../services/platformCache.js";
import { readLocalOperationalTable } from "../../../services/localOperationalRepository.js";

const drive = crearDriveClient(auth);
const APPSHEET_TIMEOUT_MS = Number(process.env.APPSHEET_TIMEOUT_MS || 60000);
const APPSHEET_MAX_CONCURRENCY = Number(process.env.APPSHEET_MAX_CONCURRENCY || 4);
const APPSHEET_MAX_RETRIES = Number(process.env.APPSHEET_MAX_RETRIES || 3);
const APPSHEET_RETRY_BASE_MS = Number(process.env.APPSHEET_RETRY_BASE_MS || 500);
const APPSHEET_RETRY_MAX_MS = Number(process.env.APPSHEET_RETRY_MAX_MS || 5000);
const APPSHEET_CACHE_TTL_MS = Number(process.env.APPSHEET_CACHE_TTL_MS || 5 * 60 * 1000);
const appsheetAgent = new https.Agent({
  keepAlive: true,
  maxSockets: Math.max(APPSHEET_MAX_CONCURRENCY * 2, 8)
});

const cachedTables = new Map();
const cachedCotizacionesCompletas = new Map();
let cotizacionesWarmupStarted = false;

const TABLE_CACHE_NAMESPACES = {
  COTIZACIONES_VARIOS_CT: "facturacion.tables.cotizaciones_varios_ct",
  CONCEPTOS_VARIOS_CT: "facturacion.tables.conceptos_varios_ct",
  EMPRESAS: "facturacion.tables.empresas",
  MUNICIPIOS: "facturacion.tables.municipios",
  ESTADOS: "facturacion.tables.estados",
  SUCURSALES: "facturacion.tables.sucursales",
  CATALOGO: "facturacion.tables.catalogo",
  PROVEEDORES: "facturacion.tables.proveedores",
};

const COTIZACION_CACHE_NAMESPACE = "facturacion.cotizacion-completa";

let appsheetActive = 0;
const appsheetQueue = [];

function withAppsheetConcurrency(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      appsheetActive += 1;
      fn().then(resolve, reject).finally(() => {
        appsheetActive -= 1;
        const next = appsheetQueue.shift();
        if (next) next();
      });
    };

    if (appsheetActive < APPSHEET_MAX_CONCURRENCY) run();
    else appsheetQueue.push(run);
  });
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APPSHEET_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, agent: appsheetAgent, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetryError(err) {
  const code = err?.code || err?.errno;
  return err?.name === "AbortError" || ["ENOBUFS", "EADDRINUSE", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH"].includes(code);
}

function getRetryDelayMs(attempt) {
  const exp = Math.min(APPSHEET_RETRY_BASE_MS * Math.pow(2, attempt - 1), APPSHEET_RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function getTableCacheNamespace(nombreTabla) {
  return TABLE_CACHE_NAMESPACES[String(nombreTabla || "").trim().toUpperCase()] || `facturacion.tables.${String(nombreTabla || "").trim().toLowerCase()}`;
}

function readPersistentRows(nombreTabla) {
  return readLocalOperationalTable(nombreTabla, {
    source: ["CATALOGO", "PROVEEDORES", "COTIZACIONES_VARIOS_CT", "CONCEPTOS_VARIOS_CT"].includes(String(nombreTabla).toUpperCase())
      ? "finance"
      : "desarrolloeg",
  });
}

function persistTableRows(nombreTabla, rows, ttlMs = APPSHEET_CACHE_TTL_MS) {
  setPersistentCacheEntry(getTableCacheNamespace(nombreTabla), "shared", {
    loadedAt: Date.now(),
    rows: Array.isArray(rows) ? rows : [],
  }, {
    ttlMs,
    source: "appsheet",
    meta: {
      rowCount: Array.isArray(rows) ? rows.length : 0,
      lastRowKey: Array.isArray(rows) && rows.length > 0 ? String(rows[rows.length - 1]?.["Row ID"] || rows[rows.length - 1]?.ID || "").trim() : "",
    },
  });
}

function readPersistentCotizacion(cotizacionId) {
  void cotizacionId;
  return null;
}

function persistPersistentCotizacion(cotizacionId, payload, ttlMs = APPSHEET_CACHE_TTL_MS) {
  const wantedId = String(cotizacionId || "").trim();
  if (!wantedId) return;
  setPersistentCacheEntry(COTIZACION_CACHE_NAMESPACE, wantedId, payload, {
    ttlMs,
    source: "appsheet",
    meta: {
      rowCount: Array.isArray(payload?.conceptos) ? payload.conceptos.length : 0,
      cotizacionId: wantedId,
    },
  });
}

async function fetchWithRetry(url, options) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await fetchWithTimeout(url, options);
    } catch (err) {
      console.warn("AppSheet fetch fallo, reintentando", { attempt, error: err?.name || err?.code || err?.message });
      if (!shouldRetryError(err) || attempt > APPSHEET_MAX_RETRIES) throw err;
      await new Promise(resolve => setTimeout(resolve, getRetryDelayMs(attempt)));
    }
  }
}

async function leerTablaAppSheet(nombreTabla) {
  return readLocalOperationalTable(nombreTabla, {
    source: ["CATALOGO", "PROVEEDORES", "COTIZACIONES_VARIOS_CT", "CONCEPTOS_VARIOS_CT"].includes(String(nombreTabla).toUpperCase())
      ? "finance"
      : "desarrolloeg",
  });
}

async function leerTablaAppSheetCacheada(nombreTabla, ttlMs = APPSHEET_CACHE_TTL_MS) {
  const now = Date.now();
  const cached = cachedTables.get(nombreTabla);
  if (cached && cached.expiraEn > now) {
    return cached.promise;
  }

  const persistentRows = readPersistentRows(nombreTabla);
  if (persistentRows.length > 0) {
    cachedTables.set(nombreTabla, {
      expiraEn: now + ttlMs,
      promise: Promise.resolve(persistentRows),
      value: persistentRows,
    });
    return persistentRows;
  }

  const promise = leerTablaAppSheet(nombreTabla);
  cachedTables.set(nombreTabla, { expiraEn: now + ttlMs, promise, value: cached?.value || null });
  try {
    const rows = await promise;
    persistTableRows(nombreTabla, rows, ttlMs);
    cachedTables.set(nombreTabla, { expiraEn: now + ttlMs, promise: Promise.resolve(rows), value: rows });
    return rows;
  } catch (err) {
    if (cached && Array.isArray(cached.value) && cached.value.length > 0) {
      cachedTables.set(nombreTabla, {
        expiraEn: now + ttlMs,
        promise: Promise.resolve(cached.value),
        value: cached.value,
      });
      return cached.value;
    }

    if (persistentRows.length > 0) {
      cachedTables.set(nombreTabla, {
        expiraEn: now + ttlMs,
        promise: Promise.resolve(persistentRows),
        value: persistentRows,
      });
      return persistentRows;
    }

    cachedTables.delete(nombreTabla);
    throw err;
  }
}

async function leerTablaAppSheetCacheadaSuave(nombreTabla, ttlMs = APPSHEET_CACHE_TTL_MS) {
  try {
    return await leerTablaAppSheetCacheada(nombreTabla, ttlMs);
  } catch (err) {
    console.error(`No se pudo leer ${nombreTabla} desde AppSheet:`, err.message);
    return [];
  }
}

async function leerTablaAppSheetFresca(nombreTabla) {
  const promise = leerTablaAppSheet(nombreTabla);
  try {
    return await promise;
  } catch (err) {
    throw err;
  }
}

export async function obtenerCotizacion(cotizacionId, forceFresh = false) {
  const wantedId = String(cotizacionId || "").trim();
  if (!forceFresh) {
    const persistent = readPersistentCotizacion(wantedId);
    if (persistent) {
      return persistent.cotizacion || persistent;
    }
  }

  const rows = forceFresh
    ? await leerTablaAppSheetFresca("COTIZACIONES_VARIOS_CT")
    : await leerTablaAppSheetCacheada("COTIZACIONES_VARIOS_CT");
  const cachedMatch = rows.find(r => String(r["Row ID"] || r.ID) === wantedId) || null;
  if (cachedMatch) {
    persistPersistentCotizacion(wantedId, { kind: "cotizacion", cotizacion: cachedMatch, conceptos: [] });
    return cachedMatch;
  }

  const freshRows = forceFresh
    ? rows
    : await leerTablaAppSheetFresca("COTIZACIONES_VARIOS_CT");
  const found = freshRows.find(r => String(r["Row ID"] || r.ID) === wantedId) || null;
  if (found) {
    persistPersistentCotizacion(wantedId, { kind: "cotizacion", cotizacion: found, conceptos: [] });
  }
  return found;
}

export async function listarCotizaciones(forceFresh = false) {
  const rows = forceFresh
    ? await leerTablaAppSheetFresca("COTIZACIONES_VARIOS_CT")
    : await leerTablaAppSheetCacheada("COTIZACIONES_VARIOS_CT");
  return Array.isArray(rows) ? rows : [];
}

export async function buscarConceptosPorCotizacion(cotizacionId, forceFresh = false) {
  const wantedId = String(cotizacionId || "").trim();
  if (!forceFresh) {
    const persistent = readPersistentCotizacion(wantedId);
    if (persistent && Array.isArray(persistent.conceptos)) {
      return persistent.conceptos;
    }
  }

  const rows = forceFresh
    ? await leerTablaAppSheetFresca("CONCEPTOS_VARIOS_CT")
    : await leerTablaAppSheetCacheada("CONCEPTOS_VARIOS_CT");
  const cachedMatches = rows.filter(r => String(r.COTIZACION) === wantedId);
  if (cachedMatches.length > 0) {
    const cotizacion = readPersistentCotizacion(wantedId) || {};
    persistPersistentCotizacion(wantedId, { ...cotizacion, kind: cotizacion.kind || "conceptos", conceptos: cachedMatches });
    return cachedMatches;
  }

  const freshRows = forceFresh
    ? rows
    : await leerTablaAppSheetFresca("CONCEPTOS_VARIOS_CT");
  const found = freshRows.filter(r => String(r.COTIZACION) === wantedId);
  const cotizacion = readPersistentCotizacion(wantedId) || {};
  persistPersistentCotizacion(wantedId, { ...cotizacion, kind: cotizacion.kind || "conceptos", conceptos: found });
  return found;
}

export async function mapaEmpresas(forceFresh = false) {
  const rows = forceFresh
    ? await leerTablaAppSheetFresca("EMPRESAS")
    : await leerTablaAppSheetCacheadaSuave("EMPRESAS");
  const map = {};
  rows.forEach(r => {
    map[r.ID] = {
      id: r.ID,
      nombreComercial: r["NOMBRE COMERCIAL"] || "",
      razonSocial: r["RAZON SOCIAL"] || "",
      logo: r.LOGO || "",
      logoUrl: r.LOGOURL || ""
    };
  });
  return map;
}

async function actualizarFilaAppSheet(nombreTabla, row) {
  const APP_ID = process.env.APPSHEET_APP_ID;
  const API_KEY = process.env.APPSHEET_API_KEY;
  const url = `https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent(nombreTabla)}/Action`;
  const body = {
    Action: "Edit",
    Properties: {
      Locale: "es-MX",
      Timezone: "Central Standard Time"
    },
    Rows: [row]
  };

  const res = await withAppsheetConcurrency(() => fetchWithRetry(url, {
    method: "POST",
    headers: {
      ApplicationAccessKey: API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }));

  const text = await res.text();
  if (!res.ok) throw new Error(`Error AppSheet Edit: ${text}`);

  const normalizedTable = String(nombreTabla || "").trim().toUpperCase();
  const editableTableNamespaces = new Set([
    "EMPRESAS",
    "MUNICIPIOS",
    "ESTADOS",
    "SUCURSALES",
    "CATALOGO",
    "PROVEEDORES",
    "COTIZACIONES_VARIOS_CT",
    "CONCEPTOS_VARIOS_CT",
  ]);

  if (editableTableNamespaces.has(normalizedTable)) {
    deletePersistentCacheEntry(getTableCacheNamespace(nombreTabla), "shared");
    deletePersistentCacheNamespace(COTIZACION_CACHE_NAMESPACE);
    cachedTables.delete(nombreTabla);
    cachedCotizacionesCompletas.clear();
  }
}

export async function mapaMunicipios(forceFresh = false) {
  const rows = forceFresh
    ? await leerTablaAppSheetFresca("MUNICIPIOS")
    : await leerTablaAppSheetCacheadaSuave("MUNICIPIOS");
  const map = {};
  rows.forEach(r => {
    map[r.ID] = { nombre: r.NOMBRE || "", escudo: r.ESCUDO || "" };
  });
  return map;
}

export async function mapaEstados(forceFresh = false) {
  const rows = forceFresh
    ? await leerTablaAppSheetFresca("ESTADOS")
    : await leerTablaAppSheetCacheadaSuave("ESTADOS");
  const map = {};
  rows.forEach(r => {
    map[r.ID] = { nombre: r.NOMBRE || "", escudo: r.ESCUDO || "" };
  });
  return map;
}

export async function mapaSucursales(forceFresh = false) {
  const rows = forceFresh
    ? await leerTablaAppSheetFresca("SUCURSALES")
    : await leerTablaAppSheetCacheadaSuave("SUCURSALES");
  const [municipios, estados] = await Promise.all([mapaMunicipios(forceFresh), mapaEstados(forceFresh)]);
  const map = {};

  rows.forEach(r => {
    const mun = municipios[r.MUNICIPIO] || {};
    const est = estados[r.ESTADO] || {};
    map[r.ID] = {
      id: r.ID,
      nombre: r.NOMBRE || "",
      domicilio: r.DOMICILIO || r.DIRECCION || r["DIRECCION GOOGLE"] || "",
      tienda: r.TIENDA || "",
      municipio: mun,
      estado: est
    };
  });

  return map;
}

export async function mapaCatalogo(forceFresh = false) {
  const rows = forceFresh
    ? await leerTablaAppSheetFresca("CATALOGO")
    : await leerTablaAppSheetCacheadaSuave("CATALOGO");
  const map = {};
  rows.forEach(r => {
    map[r["Row ID"] || r.ID] = {
      id: r["Row ID"] || r.ID || "",
      codigo: r.CODIGO || r["CODIGO"] || r["CÓDIGO"] || r.CLAVE || r["CLAVE"] || r.ID || "",
      nombre: r.NOMBRE || "",
      tipo: r.TIPO || "",
      descripcion: r.DESCRIPCION || ""
    };
  });
  return map;
}

export async function mapaProveedores(forceFresh = false) {
  const rows = forceFresh
    ? await leerTablaAppSheetFresca("PROVEEDORES")
    : await leerTablaAppSheetCacheadaSuave("PROVEEDORES");
  const map = {};
  rows.forEach(r => {
    map[r["Row ID"] || r.ID] = {
      nombre: r.NOMBRE,
      banco: r.BANCO,
      cuenta: r["CUENTA BANCARIA"],
      clabe: r.CLABE,
      firmaNombre: r["PIE DE FIRMA"],
      firmaPuesto: r.PUESTO,
      firmaUrl: r.FIRMA || ""
    };
  });
  return map;
}

function findEmpresaFromCotizacion(cotizacion, empresas = {}) {
  const candidateValues = [
    cotizacion?.["RAZON SOCIAL"],
    cotizacion?.RAZON_SOCIAL,
    cotizacion?.EMPRESA,
    cotizacion?.empresa,
    cotizacion?.["NOMBRE COMERCIAL"],
    cotizacion?.["NOMBRE COMERCIAL CLIENTE"],
  ]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  for (const candidate of candidateValues) {
    if (empresas[candidate]) {
      return empresas[candidate];
    }
  }

  const normalizedCandidates = candidateValues.map((value) => normalizeLookupText(value));
  return Object.values(empresas).find((empresa) => {
    const keys = [
      empresa?.id,
      empresa?.razonSocial,
      empresa?.nombreComercial,
    ].map((value) => normalizeLookupText(value));
    return normalizedCandidates.some((candidate) => candidate && keys.includes(candidate));
  }) || {};
}

export async function obtenerCotizacionCompleta(cotizacionId, { forceFresh = false } = {}) {
  const cacheKey = String(cotizacionId || "").trim();
  const now = Date.now();
  if (!forceFresh) {
    const persistent = readPersistentCotizacion(cacheKey);
    if (persistent && persistent.kind === "full" && persistent.cotizacion && Array.isArray(persistent.conceptos)) {
      return persistent;
    }
    const cached = cachedCotizacionesCompletas.get(cacheKey);
    if (cached && cached.expiraEn > now) {
      return cached.promise;
    }
  }

  const promise = (async () => {
    const cotizacion = await obtenerCotizacion(cotizacionId, forceFresh);
    if (!cotizacion) throw new Error("Cotizacion no encontrada");

    const [conceptos, empresas, sucursales, catalogo, proveedores] = await Promise.all([
      buscarConceptosPorCotizacion(cotizacionId, forceFresh),
      mapaEmpresas(forceFresh),
      mapaSucursales(forceFresh),
      mapaCatalogo(forceFresh),
      mapaProveedores(forceFresh)
    ]);

    const empresa = findEmpresaFromCotizacion(cotizacion, empresas);

    if (empresa.logo && !empresa.logoUrl && /^https?:\/\//i.test(empresa.logo)) {
      empresa.logoUrl = empresa.logo;
    } else if (empresa.logo && !empresa.logoUrl) {
      try {
        const logoUrl = await construirThumbnailDesdeLogoPath(drive, empresa.logo);
        if (logoUrl) {
          empresa.logoUrl = logoUrl;
          void actualizarFilaAppSheet("EMPRESAS", { ID: empresa.id, LOGOURL: logoUrl }).catch((err) => {
            console.error("No se pudo persistir LOGOURL:", err?.message || err);
          });
        }
      } catch (err) {
        console.error("No se pudo generar LOGOURL:", err?.message || err);
      }
    }

    const proveedor = proveedores[cotizacion.PROVEEDOR] || null;
    const titulo = cotizacion.TITULO || cotizacion["TITULO"] || "";
    const centroDeTrabajoRaw = cotizacion.CENTRO_DE_TRABAJO
      || cotizacion.CENTROS_DE_TRABAJO
      || cotizacion["CENTRO DE TRABAJO"]
      || cotizacion["CENTROS DE TRABAJO"]
      || "";
    const formaPago = cotizacion.formaPago || cotizacion["Forma pago"] || cotizacion["Forma Pago"] || cotizacion["FORMA PAGO"] || cotizacion.paymentTerms || "";
    const centrosDesdeCotizacion = Array.isArray(centroDeTrabajoRaw)
      ? centroDeTrabajoRaw
      : String(centroDeTrabajoRaw).split(/[,;]+/g).map(v => v.trim()).filter(Boolean);
    const centrosDesdeConceptos = conceptos.map(c => String(c.CENTRO_DE_TRABAJO || "").trim()).filter(Boolean);
    const centroDeTrabajoIds = [...new Set([...centrosDesdeCotizacion, ...centrosDesdeConceptos])];
    const centroDeTrabajoCount = centroDeTrabajoIds.length;
    const centroDeTrabajoUnicoId = centroDeTrabajoCount === 1 ? centroDeTrabajoIds[0] : "";
    const centroDeTrabajoUnico = centroDeTrabajoUnicoId ? (sucursales[centroDeTrabajoUnicoId] || {}) : {};
    const porCentro = {};

    conceptos.forEach(c => {
      const ctId = c.CENTRO_DE_TRABAJO;
      if (!ctId) return;
      const suc = sucursales[ctId] || {};

      if (!porCentro[ctId]) {
        porCentro[ctId] = {
          centro_id: ctId,
          centro_nombre: suc.nombre || ctId,
          tienda: suc.tienda || "",
          domicilio: suc.domicilio || "",
          municipio: suc.municipio || {},
          estado: suc.estado || {},
          conceptos: []
        };
      }

      const cat = catalogo[c.CONCEPTO] || {};
      porCentro[ctId].conceptos.push({
        concepto_id: c.CONCEPTO,
        concepto_nombre: cat.nombre || c.CONCEPTO,
        tipo: cat.tipo || "",
        catalogo_codigo: cat.codigo || cat.id || c.CONCEPTO || "",
        descripcion_catalogo: cat.descripcion || "",
        cantidad: Number(c.CANTIDAD || 0),
        precio: Number(c.PRECIO || 0),
        subtotal: Number(c.SUBTOTAL || 0),
        iva: Number(c["TOTAL IVA"] || 0),
        total: Number(c.TOTAL || 0)
      });
    });

    return {
      kind: "full",
      empresaId: empresa.id || cotizacion["RAZON SOCIAL"] || "",
      empresa,
      cotizacion: {
        id: cotizacion["Row ID"] || cotizacion.ID || cacheKey,
        fecha: cotizacion.FECHA,
        proveedor,
        titulo,
        formaPago,
        centroDeTrabajoIds,
        centroDeTrabajoCount,
        centroNombre: centroDeTrabajoUnico.nombre || centroDeTrabajoUnicoId || ""
      },
      firma: proveedor ? {
        firmaUrl: proveedor.firmaUrl,
        nombre: proveedor.firmaNombre,
        puesto: proveedor.firmaPuesto
      } : null,
      conceptos_por_centro: porCentro
    };
  })();

  if (!forceFresh) {
    cachedCotizacionesCompletas.set(cacheKey, { expiraEn: now + APPSHEET_CACHE_TTL_MS, promise });
  }
  try {
    const result = await promise;
    persistPersistentCotizacion(cacheKey, { ...result, kind: "full" }, APPSHEET_CACHE_TTL_MS);
    return result;
  } catch (err) {
    if (!forceFresh) cachedCotizacionesCompletas.delete(cacheKey);
    throw err;
  }
}

export function prewarmCotizacionesCaches() {
  if (cotizacionesWarmupStarted) return;
  cotizacionesWarmupStarted = true;

  if (!process.env.APPSHEET_APP_ID || !process.env.APPSHEET_API_KEY) {
    return;
  }

  setTimeout(() => {
    void Promise.allSettled([
      mapaEmpresas(),
      mapaSucursales(),
      mapaCatalogo(),
      mapaProveedores(),
    ]);
  }, 1500);
}

export const prewarmFacturacionCaches = prewarmCotizacionesCaches;
