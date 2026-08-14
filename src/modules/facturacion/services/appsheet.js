import fetch from "node-fetch";
import https from "https";
import auth from "../utils/auth.js";
import { crearDriveClient, construirThumbnailDesdeLogoPath } from "../utils/drive.utils.js";

const drive = crearDriveClient(auth);
const APPSHEET_TIMEOUT_MS = Number(process.env.APPSHEET_TIMEOUT_MS || 20000);
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
let facturacionWarmupStarted = false;

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
  return ["ENOBUFS", "EADDRINUSE", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH"].includes(code);
}

function getRetryDelayMs(attempt) {
  const exp = Math.min(APPSHEET_RETRY_BASE_MS * Math.pow(2, attempt - 1), APPSHEET_RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * 250);
  return exp + jitter;
}

async function fetchWithRetry(url, options) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await fetchWithTimeout(url, options);
    } catch (err) {
      if (!shouldRetryError(err) || attempt > APPSHEET_MAX_RETRIES) throw err;
      await new Promise(resolve => setTimeout(resolve, getRetryDelayMs(attempt)));
    }
  }
}

async function leerTablaAppSheet(nombreTabla) {
  const APP_ID = process.env.APPSHEET_APP_ID;
  const API_KEY = process.env.APPSHEET_API_KEY;

  if (!APP_ID || !API_KEY) {
    throw new Error("Variables de entorno AppSheet no disponibles");
  }

  const url = `https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent(nombreTabla)}/Action`;
  const body = {
    Action: "Find",
    Properties: {
      Locale: "es-MX",
      Timezone: "Central Standard Time",
      UserSettings: {}
    },
    Rows: []
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
  if (!text) return [];
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : (data.Rows || []);
}

async function leerTablaAppSheetCacheada(nombreTabla, ttlMs = APPSHEET_CACHE_TTL_MS) {
  const now = Date.now();
  const cached = cachedTables.get(nombreTabla);
  if (cached && cached.expiraEn > now) {
    return cached.promise;
  }

  const promise = leerTablaAppSheet(nombreTabla);
  cachedTables.set(nombreTabla, { expiraEn: now + ttlMs, promise });
  try {
    return await promise;
  } catch (err) {
    cachedTables.delete(nombreTabla);
    throw err;
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

export async function obtenerCotizacion(cotizacionId) {
  const wantedId = String(cotizacionId || "").trim();
  const rows = await leerTablaAppSheetCacheada("COTIZACIONES_VARIOS_CT");
  const cachedMatch = rows.find(r => String(r["Row ID"] || r.ID) === wantedId) || null;
  if (cachedMatch) return cachedMatch;

  const freshRows = await leerTablaAppSheetFresca("COTIZACIONES_VARIOS_CT");
  return freshRows.find(r => String(r["Row ID"] || r.ID) === wantedId) || null;
}

export async function buscarConceptosPorCotizacion(cotizacionId) {
  const wantedId = String(cotizacionId || "").trim();
  const rows = await leerTablaAppSheetCacheada("CONCEPTOS_VARIOS_CT");
  const cachedMatches = rows.filter(r => String(r.COTIZACION) === wantedId);
  if (cachedMatches.length > 0) return cachedMatches;

  const freshRows = await leerTablaAppSheetFresca("CONCEPTOS_VARIOS_CT");
  return freshRows.filter(r => String(r.COTIZACION) === wantedId);
}

export async function mapaEmpresas() {
  const rows = await leerTablaAppSheetCacheada("EMPRESAS");
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
}

export async function mapaMunicipios() {
  const rows = await leerTablaAppSheetCacheada("MUNICIPIOS");
  const map = {};
  rows.forEach(r => {
    map[r.ID] = { nombre: r.NOMBRE || "", escudo: r.ESCUDO || "" };
  });
  return map;
}

export async function mapaEstados() {
  const rows = await leerTablaAppSheetCacheada("ESTADOS");
  const map = {};
  rows.forEach(r => {
    map[r.ID] = { nombre: r.NOMBRE || "", escudo: r.ESCUDO || "" };
  });
  return map;
}

export async function mapaSucursales() {
  const rows = await leerTablaAppSheetCacheada("SUCURSALES");
  const [municipios, estados] = await Promise.all([mapaMunicipios(), mapaEstados()]);
  const map = {};

  rows.forEach(r => {
    const mun = municipios[r.MUNICIPIO] || {};
    const est = estados[r.ESTADO] || {};
    map[r.ID] = {
      id: r.ID,
      nombre: r.NOMBRE || "",
      domicilio: r.DOMICILIO || "",
      tienda: r.TIENDA || "",
      municipio: mun,
      estado: est
    };
  });

  return map;
}

export async function mapaCatalogo() {
  const rows = await leerTablaAppSheetCacheada("CATALOGO");
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

export async function mapaProveedores() {
  const rows = await leerTablaAppSheetCacheada("PROVEEDORES");
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

export async function obtenerCotizacionCompleta(cotizacionId) {
  const cacheKey = String(cotizacionId || "").trim();
  const cached = cachedCotizacionesCompletas.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiraEn > now) {
    return cached.promise;
  }

  const promise = (async () => {
    const cotizacion = await obtenerCotizacion(cotizacionId);
    if (!cotizacion) throw new Error("Cotizacion no encontrada");

    const [conceptos, empresas, sucursales, catalogo, proveedores] = await Promise.all([
      buscarConceptosPorCotizacion(cotizacionId),
      mapaEmpresas(),
      mapaSucursales(),
      mapaCatalogo(),
      mapaProveedores()
    ]);

    const empresa = empresas[cotizacion["RAZON SOCIAL"]] || {};

    if (empresa.logo && !empresa.logoUrl) {
      void (async () => {
        try {
          const logoUrl = await construirThumbnailDesdeLogoPath(drive, empresa.logo);
          if (!logoUrl) return;
          empresa.logoUrl = logoUrl;
          await actualizarFilaAppSheet("EMPRESAS", { ID: empresa.id, LOGOURL: logoUrl });
        } catch (err) {
          console.error("No se pudo generar LOGOURL:", err.message);
        }
      })();
    }

    const proveedor = proveedores[cotizacion.PROVEEDOR] || null;
    const titulo = cotizacion.TITULO || cotizacion["TITULO"] || "";
    const centroDeTrabajoRaw = cotizacion.CENTRO_DE_TRABAJO || cotizacion["CENTRO_DE_TRABAJO"] || cotizacion["CENTRO DE TRABAJO"] || "";
    const formaPago = cotizacion.formaPago || cotizacion["Forma pago"] || cotizacion["Forma Pago"] || cotizacion["FORMA PAGO"] || cotizacion.paymentTerms || "";
    const centroDeTrabajoIds = Array.isArray(centroDeTrabajoRaw) ? centroDeTrabajoRaw : String(centroDeTrabajoRaw).split(/[,;]+/g).map(v => v.trim()).filter(Boolean);
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
      empresaId: cotizacion["RAZON SOCIAL"],
      empresa,
      cotizacion: {
        id: cotizacion["Row ID"],
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

  cachedCotizacionesCompletas.set(cacheKey, { expiraEn: now + APPSHEET_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (err) {
    cachedCotizacionesCompletas.delete(cacheKey);
    throw err;
  }
}

export function prewarmFacturacionCaches() {
  if (facturacionWarmupStarted) return;
  facturacionWarmupStarted = true;

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
