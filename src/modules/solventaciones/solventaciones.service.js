import fs from "fs/promises";
import fetch from "node-fetch";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { mapaSucursales } from "../facturacion/services/appsheet.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");

const APPSHEET_TIMEOUT_MS = Number(process.env.APPSHEET_TIMEOUT_MS || 20000);
const APPSHEET_MAX_CONCURRENCY = Number(process.env.APPSHEET_MAX_CONCURRENCY || 4);
const APPSHEET_MAX_RETRIES = Number(process.env.APPSHEET_MAX_RETRIES || 3);
const APPSHEET_RETRY_BASE_MS = Number(process.env.APPSHEET_RETRY_BASE_MS || 500);
const APPSHEET_RETRY_MAX_MS = Number(process.env.APPSHEET_RETRY_MAX_MS || 5000);
const APPSHEET_APP_ID = (process.env.APPSHEET_APP_ID || "").trim();
const APPSHEET_API_KEY = (process.env.APPSHEET_API_KEY || "").trim();
const APPSHEET_TABLE = process.env.SOLVENTACIONES_APPSHEET_TABLE || "STATUS SISTEMA PC";
const PCSINALOA_LOGIN_URL = "https://pcsinaloa.gob.mx/api/seguridad/signin";
const PCSINALOA_READ_URL = "https://pcsinaloa.gob.mx/api/read";
const PCSINALOA_BASE_URL = "https://pcsinaloa.gob.mx";
const PCSINALOA_CLIENT_FK = "fbdc9f5fef29db140000000000000000";
const COMPANY_BRANDING = {
  companyName: "DESARROLLO EG",
  companySubtitle: "",
  logoUrl: "https://drive.google.com/thumbnail?id=15YmFa3PwCXcZCdgzrtlFGcdIGXXF0XvL&sz=w400",
  footerLeftLines: [
    "Rio Tehuantepec 1704-1, Morelos,",
    "Los Pinos, 80170 Culiacan Rosales,",
    "Sin.",
  ],
  footerRightLines: [
    "WhatsApp: (667) 3059813",
    "Cel: (667) 3059813 y (667) 4950697",
    "Oficina: (667) 690 2218",
  ],
};
const COMPANY_LOGO_FALLBACK_PATH = path.join(projectRoot, "standalone", "sucursales-docs", "assets", "logo.png");
const PDF_IMAGE_CACHE = new Map();
const PCSINALOA_LOGIN_PAYLOAD = {
  VA: "login",
  usuario: "contacto.gga.sc@gmail.com",
  password: "lRf5LXvNB7tE95GpfLUFPA==",
};
const PCSINALOA_LOGIN_HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json;charset=utf-8",
  Origin: "https://pcsinaloa.gob.mx",
  Referer: "https://pcsinaloa.gob.mx/webapp/login",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/146.0.0.0 Safari/537.36",
  "client-fk": PCSINALOA_CLIENT_FK,
};
const PCSINALOA_COMMON_HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json;charset=utf-8",
  Origin: "https://pcsinaloa.gob.mx",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/146.0.0.0 Safari/537.36",
};

const appsheetAgent = new https.Agent({
  keepAlive: true,
  maxSockets: Math.max(APPSHEET_MAX_CONCURRENCY * 2, 8),
});

let appsheetActive = 0;
const appsheetQueue = [];

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function readField(row, names) {
  if (!row) return "";

  for (const name of names) {
    const direct = row[name];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return direct;
    }
  }

  const wanted = names.map((name) => normalizeText(name));
  for (const [key, value] of Object.entries(row)) {
    if (!wanted.includes(normalizeText(key))) continue;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function normalizeLoose(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function withAppsheetConcurrency(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      appsheetActive += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
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
  const base = Math.min(APPSHEET_RETRY_BASE_MS * Math.pow(2, attempt - 1), APPSHEET_RETRY_MAX_MS);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

async function fetchWithRetry(url, options) {
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await fetchWithTimeout(url, options);
    } catch (err) {
      if (!shouldRetryError(err) || attempt > APPSHEET_MAX_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(attempt)));
    }
  }
}

async function postJsonWithRetry(url, options) {
  return fetchWithRetry(url, options);
}

async function leerTablaAppSheet(nombreTabla) {
  if (!APPSHEET_APP_ID || !APPSHEET_API_KEY) {
    return null;
  }

  const url = `https://api.appsheet.com/api/v2/apps/${APPSHEET_APP_ID}/tables/${encodeURIComponent(nombreTabla)}/Action`;
  const body = {
    Action: "Find",
    Properties: {
      Locale: "es-MX",
      Timezone: "Central Standard Time",
      UserSettings: {},
    },
    Rows: [],
  };

  const res = await withAppsheetConcurrency(() =>
    fetchWithRetry(url, {
      method: "POST",
      headers: {
        ApplicationAccessKey: APPSHEET_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );

  const text = await res.text();
  if (!text) return [];

  const data = JSON.parse(text);
  return Array.isArray(data) ? data : (data.Rows || data.rows || []);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Mexico_City",
  }).format(date);
}

function compact(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function buildRowView(row, sucursal) {
  const razonSocial = String(readField(row, ["contribuyente_razon_social", "RAZON SOCIAL", "RAZON_SOCIAL"]) || "").trim();
  const sucursalNombre = String(
    readField(row, ["sucursal_nombre_comercial", "SUCURSAL_NOMBRE_COMERCIAL", "sucursal_nombre", "SUCURSAL"]) ||
      sucursal?.nombre ||
      ""
  ).trim();
  const tienda = String(
    readField(row, ["TIENDA", "Tienda"]) ||
      sucursalNombre ||
      sucursal?.tienda ||
      ""
  ).trim();
  const sucursalId = String(readField(row, ["sucursal_id", "SUCURSAL_ID", "Row ID", "ID"]) || "").trim();
  const municipioNombre = String(
    readField(row, ["municipio", "MUNICIPIO"]) ||
      sucursal?.municipio?.nombre ||
      ""
  ).trim();
  const estadoNombre = String(sucursal?.estado?.nombre || "").trim();
  const solicitudId = String(readField(row, ["solicitud_id", "SOLICITUD_ID"]) || "").trim();
  const estatus = String(readField(row, ["estatus", "ESTATUS"]) || "").trim();
  const motivo = String(readField(row, ["motivo", "MOTIVO"]) || "").trim();
  const registroFecha = formatDate(readField(row, ["registro_fecha", "REGISTRO_FECHA"]));
  const vigenciaFecha = formatDate(readField(row, ["vigencia_fecha_propuesta", "VIGENCIA_FECHA_PROPUESTA"]));

  return {
    solicitudId,
    estatus,
    razonSocial,
    tienda,
    sucursalId,
    sucursalNombre,
    municipioNombre,
    estadoNombre,
    motivo,
    registroFecha,
    vigenciaFecha,
    etiquetaGrupo: tienda || razonSocial || municipioNombre || sucursalNombre || "SIN GRUPO",
    filtroTienda: compact(tienda),
    filtroRazonSocial: compact(razonSocial),
    filtroMunicipio: compact(municipioNombre),
  };
}

function matchesToken(value, token) {
  const left = compact(value);
  const right = compact(token);
  if (!right) return true;
  if (!left) return false;
  return left.includes(right) || right.includes(left);
}

function dedupeStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
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
          : "application/octet-stream";

  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function parseImageList(raw) {
  if (!raw) return [];

  let list = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }

  if (!Array.isArray(list)) return [];

  return list
    .map((img) => {
      if (!img) return null;

      const sysfilename = String(img.sysfilename || img.fileName || img.filename || "").trim();
      const baseUrlArchivos = String(img.baseUrlArchivos || img.base_url_archivos || "").trim();
      const urlImgen = String(img.url_imagen || img.url || img.imageUrl || "").trim();
      const thumbnailUrl = String(img.thumbnailUrl || img.thumbUrl || img.thumbnail || "").trim();
      const previewUrl = buildProxyImageUrl(thumbnailUrl || urlImgen || "");
      const computedUrl = !urlImgen && sysfilename && baseUrlArchivos
        ? `${baseUrlArchivos.replace(/\/+$/, "")}/static/${sysfilename}`
        : urlImgen;

      return {
        ...img,
        sysfilename,
        url_imagen: computedUrl || urlImgen,
        thumbnailUrl: previewUrl || computedUrl || urlImgen,
        previewUrl: previewUrl || computedUrl || urlImgen,
      };
    })
    .filter(Boolean);
}

function buildProxyImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  if (!/^https?:\/\//i.test(raw)) return raw;
  return `/facturacion/img-proxy?url=${encodeURIComponent(raw)}`;
}

async function imageUrlToPdfDataUri(url, options = {}) {
  const source = String(url || "").trim();
  if (!source) return "";
  if (source.startsWith("data:")) return source;

  const width = Number(options.width || 960);
  const height = Number(options.height || 720);
  const quality = Number(options.quality || 68);
  const cacheKey = `${source}|${width}|${height}|${quality}`;
  if (PDF_IMAGE_CACHE.has(cacheKey)) {
    return PDF_IMAGE_CACHE.get(cacheKey);
  }

  const promise = (async () => {
    const response = await fetch(source, { headers: { Accept: "image/*" } });
    if (!response.ok) {
      throw new Error(`No se pudo descargar evidencia (${response.status})`);
    }

    const inputBuffer = Buffer.from(await response.arrayBuffer());
    const outputBuffer = await sharp(inputBuffer)
      .rotate()
      .resize({ width, height, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();

    return `data:image/jpeg;base64,${outputBuffer.toString("base64")}`;
  })();

  PDF_IMAGE_CACHE.set(cacheKey, promise);

  try {
    const result = await promise;
    PDF_IMAGE_CACHE.set(cacheKey, result);
    return result;
  } catch (err) {
    PDF_IMAGE_CACHE.delete(cacheKey);
    throw err;
  }
}

function buildImagesFromRow(row) {
  const rawImages =
    readField(row, ["imagenes", "IMAGENES"]) ||
    readField(row, ["image_list", "IMAGE_LIST"]) ||
    readField(row, ["imageList", "IMAGELIST"]);

  return parseImageList(rawImages);
}

async function loginPcsinaloa() {
  const res = await fetchWithRetry(PCSINALOA_LOGIN_URL, {
    method: "POST",
    headers: PCSINALOA_LOGIN_HEADERS,
    body: JSON.stringify(PCSINALOA_LOGIN_PAYLOAD),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Login PCSinaloa fallido (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text);
  const token = data?.data?.user?.sessionToken;
  if (!token) {
    throw new Error("PCSinaloa no devolvio sessionToken");
  }

  return token;
}

async function pcsinaloaReadBySolicitudId(token, solicitudId) {
  const payload = {
    VC: "slc_solicitud_incidencia",
    VA: "by_solicitud_id",
    solicitud_id: Number(solicitudId),
  };

  const res = await postJsonWithRetry(PCSINALOA_READ_URL, {
    method: "POST",
    headers: {
      ...PCSINALOA_COMMON_HEADERS,
      Authorization: token,
      Referer: "https://pcsinaloa.gob.mx/webapp/buzon",
      "client-fk": PCSINALOA_CLIENT_FK,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PCSinaloa read fallido (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text);
  const contenido = data?.data;
  const registros = Array.isArray(contenido) ? contenido : (contenido ? [contenido] : []);
  return registros;
}

function enriquecerIncidenciasConImagenes(incidencias) {
  return incidencias
    .map((inc) => {
      if (!inc) return null;

      let imageList = inc.image_list || [];
      if (typeof imageList === "string") {
        try {
          imageList = JSON.parse(imageList);
        } catch {
          imageList = [];
        }
      }
      if (!Array.isArray(imageList)) imageList = [];

      const imagenes = imageList.map((img) => {
        const sysfilename = String(img?.sysfilename || "").trim();
        const url_imagen = sysfilename ? `${PCSINALOA_BASE_URL.replace(/\/+$/, "")}/static/${sysfilename}` : "";
        const previewUrl = buildProxyImageUrl(url_imagen);
        return {
          ...img,
          sysfilename,
          url_imagen,
          thumbnailUrl: previewUrl || String(img?.thumbnailUrl || img?.thumbUrl || img?.thumbnail || "").trim() || url_imagen,
          previewUrl: previewUrl || url_imagen,
        };
      });

      return {
        incidencia_id: inc.incidencia_id,
        solicitud_id: inc.solicitud_id,
        titulo: inc.titulo,
        descripcion: inc.descripcion,
        estatus: inc.estatus,
        status: inc.status,
        registro_fecha: inc.registro_fecha,
        evidencias: Number(inc.evidencias) || imagenes.length || 0,
        imagenes,
      };
    })
    .filter(Boolean);
}

function compactText(value) {
  return normalizeLoose(value).replace(/\s+/g, "");
}

function buildReportGroupKey(row, filtros) {
  const parts = [];
  if (filtros.tienda) parts.push(`TIENDA ${filtros.tienda}`);
  if (filtros.razonSocial) parts.push(row.razonSocial || "SIN RAZON SOCIAL");
  if (filtros.municipio) parts.push(row.municipioNombre || filtros.municipio);
  if (!parts.length) {
    if (row.razonSocial) parts.push(row.razonSocial);
    if (!parts.length && row.tienda) parts.push(row.tienda);
    if (!parts.length && row.municipioNombre) parts.push(row.municipioNombre);
  }
  return parts.join(" | ") || "SIN GRUPO";
}

function buildSourceLabel(row) {
  return [row.sucursalNombre, row.tienda, row.municipioNombre]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" - ");
}

function buildIncidenciaKey(inc) {
  return [
    String(inc?.incidencia_id || "").trim(),
    String(inc?.titulo || "").trim(),
    String(inc?.descripcion || "").trim(),
  ]
    .filter(Boolean)
    .join("|");
}

function parseStatusValue(inc) {
  const raw = inc?.status ?? inc?.estatus ?? inc?.estado_codigo ?? null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function getStatusLabelFromValue(status) {
  if (status === 0) return "Pendiente";
  if (status === 1) return "Revisada";
  if (status === 2) return "Solventada";
  if (status === 3) return "Cerrada";
  return "Sin clasificar";
}

function getStatusPriority(inc) {
  const status = parseStatusValue(inc);
  if (status === 0) return 1;
  if (status === 2) return 2;
  if (status === 1) return 3;
  if (status === 3) return 4;
  return 9;
}

function sortIncidenciasForReport(incidencias) {
  return [...(Array.isArray(incidencias) ? incidencias : [])].sort((a, b) => {
    const priorityDiff = getStatusPriority(a) - getStatusPriority(b);
    if (priorityDiff !== 0) return priorityDiff;

    const evidenciaDiff = (Number(b?.imagenes?.length || b?.evidencias || 0) || 0) - (Number(a?.imagenes?.length || a?.evidencias || 0) || 0);
    if (evidenciaDiff !== 0) return evidenciaDiff;

    const fechaA = new Date(a?.registro_fecha || 0).getTime();
    const fechaB = new Date(b?.registro_fecha || 0).getTime();
    if (Number.isFinite(fechaA) && Number.isFinite(fechaB) && fechaA !== fechaB) {
      return fechaA - fechaB;
    }

    return String(a?.titulo || "").localeCompare(String(b?.titulo || ""), "es-MX");
  });
}

function buildStatusBreakdown(incidencias) {
  const base = { pendiente: 0, subido: 0, rechazado: 0, subsanado: 0, sinClasificar: 0 };

  incidencias.forEach((inc) => {
    const status = parseStatusValue(inc);
    if (status === 0) base.pendiente += 1;
    else if (status === 1) base.subido += 1;
    else if (status === 2) base.rechazado += 1;
    else if (status === 3) base.subsanado += 1;
    else base.sinClasificar += 1;
  });

  return base;
}

function buildTopCounts(items, getLabel, getWeight, limit = 3) {
  const map = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const label = String(getLabel(item) || "").trim();
    if (!label) continue;
    const weight = Number(getWeight(item) || 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;

    const key = normalizeLoose(label);
    const current = map.get(key);
    if (current) {
      current.count += weight;
      if (label.length > current.label.length) current.label = label;
    } else {
      map.set(key, { label, count: weight });
    }
  }

  return [...map.values()]
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label, "es-MX"))
    .slice(0, limit);
}

export async function obtenerSolventacionesCompleto(query = {}) {
  const filtros = {
    tienda: String(query.tienda || query.TIENDA || "").trim(),
    razonSocial: String(query.razonSocial || query.razon_social || query["razon social"] || "").trim(),
    municipio: String(query.municipio || query.MUNICIPIO || "").trim(),
  };

  if (!APPSHEET_APP_ID || !APPSHEET_API_KEY) {
    throw new Error("Faltan credenciales AppSheet para Solventaciones");
  }

  const [rowsRaw, sucursalesMap] = await Promise.all([
    leerTablaAppSheet(APPSHEET_TABLE),
    mapaSucursales(),
  ]);

  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  const visitadasBase = rows
    .filter((row) => normalizeText(readField(row, ["estatus", "ESTATUS"])) === "visitada")
    .map((row) => {
      const sucursalId = String(readField(row, ["sucursal_id", "SUCURSAL_ID", "Row ID", "ID"]) || "").trim();
      const sucursal = sucursalesMap?.[sucursalId] || null;
      return {
        ...buildRowView(row, sucursal),
      };
    })
    .filter(Boolean);

  const visitadasFiltradas = visitadasBase
    .filter((row) => {
      if (!matchesToken(row.tienda, filtros.tienda)) return false;
      if (!matchesToken(row.razonSocial, filtros.razonSocial)) return false;
      if (!matchesToken(row.municipioNombre, filtros.municipio)) return false;
      return true;
    });

  const token = await loginPcsinaloa();
  const visitadas = await Promise.all(
    visitadasFiltradas.map(async (item) => {
      const solicitudId = String(item.solicitudId || "").trim();
      let incidencias = [];

      if (solicitudId) {
        try {
          const rawIncidencias = await pcsinaloaReadBySolicitudId(token, solicitudId);
          incidencias = sortIncidenciasForReport(enriquecerIncidenciasConImagenes(rawIncidencias));
        } catch (err) {
          incidencias = [];
          item.errorIncidencias = err.message;
        }
      }

      const imagenes = incidencias.flatMap((inc) => Array.isArray(inc.imagenes) ? inc.imagenes : []);
      return {
        ...item,
        incidencias,
        imagenes,
        evidenciasCount: imagenes.length || Number(item.evidenciasCount || 0) || 0,
      };
    })
  );

  const grupos = new Map();
  visitadas.forEach((row) => {
    const key = buildReportGroupKey(row, filtros);
    if (!grupos.has(key)) {
      grupos.set(key, {
        key,
        titulo: key,
        subtitulo: buildSourceLabel(row),
        items: [],
      });
    }

    const grupo = grupos.get(key);
    grupo.items.push(row);
  });

  const gruposLista = [...grupos.values()].map((grupo) => ({
    ...grupo,
    subtitulo: dedupeStrings([
      grupo.subtitulo,
      ...grupo.items.map((item) => buildSourceLabel(item)),
    ]),
    items: grupo.items.map((item) => ({
      ...item,
      incidencias: Array.isArray(item.incidencias)
        ? item.incidencias.map((inc) => ({
            ...inc,
            imagenes: Array.isArray(inc.imagenes) ? inc.imagenes : [],
            imageKey: buildIncidenciaKey(inc),
          }))
        : [],
    })),
  }));

  const resumen = {
    totalRegistros: visitadas.length,
    totalTiendas: new Set(visitadas.map((item) => item.tienda).filter(Boolean)).size,
    totalRazonSociales: new Set(visitadas.map((item) => item.razonSocial).filter(Boolean)).size,
    totalMunicipios: new Set(visitadas.map((item) => item.municipioNombre).filter(Boolean)).size,
  };

  const incidenciasTodas = visitadas.flatMap((item) => Array.isArray(item.incidencias) ? item.incidencias : []);
  const totalEvidencias = incidenciasTodas.reduce((acc, inc) => acc + (Array.isArray(inc.imagenes) ? inc.imagenes.length : 0), 0);
  const incidenciasConEvidencia = incidenciasTodas.filter((inc) => (Array.isArray(inc.imagenes) ? inc.imagenes.length : 0) > 0).length;
  const incidenciasSinEvidencia = Math.max(0, incidenciasTodas.length - incidenciasConEvidencia);
  const visitasConEvidencia = visitadas.filter((item) => Number(item.evidenciasCount || 0) > 0).length;
  const visitasSinEvidencia = Math.max(0, visitadas.length - visitasConEvidencia);
  const topMotivos = buildTopCounts(
    incidenciasTodas,
    (inc) => inc.titulo || inc.motivo || inc.descripcion || "Sin titulo",
    () => 1,
    3
  );
  const topTiendas = buildTopCounts(
    visitadas,
    (item) => item.sucursalNombre || item.tienda || item.razonSocial || "Sin tienda",
    (item) => Number(item.incidencias?.length || 0),
    3
  );

  const resumenAvanzado = {
    totalIncidencias: incidenciasTodas.length,
    totalEvidencias,
    incidenciasConEvidencia,
    incidenciasSinEvidencia,
    visitasConEvidencia,
    visitasSinEvidencia,
    coberturaEvidencia: incidenciasTodas.length ? Math.round((incidenciasConEvidencia / incidenciasTodas.length) * 100) : 0,
    evidenciaPromedio: incidenciasTodas.length ? Number((totalEvidencias / incidenciasTodas.length).toFixed(1)) : 0,
    visitasConIncidencias: visitadas.filter((item) => Array.isArray(item.incidencias) && item.incidencias.length > 0).length,
    statusBreakdown: buildStatusBreakdown(incidenciasTodas),
    topMotivos,
    topTiendas,
  };

  const catalogos = {
    tiendas: dedupeStrings(visitadasBase.map((item) => item.tienda)).sort((a, b) => a.localeCompare(b, "es-MX")),
    razonesSociales: dedupeStrings(visitadasBase.map((item) => item.razonSocial)).sort((a, b) => a.localeCompare(b, "es-MX")),
    municipios: dedupeStrings(visitadasBase.map((item) => item.municipioNombre)).sort((a, b) => a.localeCompare(b, "es-MX")),
  };

  let companyLogoDataUri = "";
  try {
    companyLogoDataUri = await fileToDataUri(COMPANY_LOGO_FALLBACK_PATH);
  } catch {
    companyLogoDataUri = "";
  }

  return {
    source: "appsheet",
    generatedAt: new Date().toISOString(),
    tableName: APPSHEET_TABLE,
    company: {
      ...COMPANY_BRANDING,
      logoDataUri: companyLogoDataUri,
    },
    filtros,
    resumen,
    resumenAvanzado,
    catalogos,
    grupos: gruposLista,
    items: visitadas,
    advertencias: [],
  };
}

export async function prepararSolventacionesPdf(reporte) {
  const copia = typeof structuredClone === "function"
    ? structuredClone(reporte)
    : JSON.parse(JSON.stringify(reporte || {}));

  const grupos = Array.isArray(copia?.grupos) ? copia.grupos : [];
  for (const grupo of grupos) {
    for (const item of Array.isArray(grupo.items) ? grupo.items : []) {
      for (const inc of Array.isArray(item.incidencias) ? item.incidencias : []) {
        const imagenes = Array.isArray(inc.imagenes) ? inc.imagenes : [];
        for (const img of imagenes) {
          const source = img.url_imagen || img.url || img.previewUrl || img.thumbnailUrl || "";
          try {
            img.pdfPreviewUrl = await imageUrlToPdfDataUri(source, { width: 420, height: 320, quality: 38 });
          } catch {
            img.pdfPreviewUrl = source;
          }
        }
      }
    }
  }

  return copia;
}
