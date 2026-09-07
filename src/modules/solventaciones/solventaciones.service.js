import fs from "fs/promises";
import fetch from "node-fetch";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { readLocalOperationalTable } from "../../services/localOperationalRepository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..", "..");

const APPSHEET_TIMEOUT_MS = Number(process.env.APPSHEET_TIMEOUT_MS || 20000);
const APPSHEET_MAX_CONCURRENCY = Number(process.env.APPSHEET_MAX_CONCURRENCY || 4);
const APPSHEET_MAX_RETRIES = Number(process.env.APPSHEET_MAX_RETRIES || 3);
const APPSHEET_RETRY_BASE_MS = Number(process.env.APPSHEET_RETRY_BASE_MS || 500);
const APPSHEET_RETRY_MAX_MS = Number(process.env.APPSHEET_RETRY_MAX_MS || 5000);
const REPORT_CACHE_TTL_MS = Number(process.env.SOLVENTACIONES_REPORT_CACHE_TTL_MS || 2 * 60 * 1000);
const PDF_IMAGE_CONCURRENCY = Number(process.env.SOLVENTACIONES_PDF_IMAGE_CONCURRENCY || 6);
const PDF_IMAGE_TIMEOUT_MS = Number(process.env.SOLVENTACIONES_PDF_IMAGE_TIMEOUT_MS || 12_000);
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
const LOCAL_DB_PATH = String(
  process.env.DESARROLLOEG_LOCAL_DB_PATH ||
  process.env.DESARROLLOEG_SYNC_DB_PATH ||
  path.join(projectRoot, "data", "desarrolloeg.sqlite"),
).trim();
const PDF_IMAGE_CACHE = new Map();
const REPORT_CACHE = new Map();
const PCSINALOA_READ_CACHE = new Map();
let lastDatabaseRevision = "";
const PCSINALOA_TOKEN_CACHE_TTL_MS = Number(process.env.PCSINALOA_TOKEN_CACHE_TTL_MS || 10 * 60 * 1000);
const PCSINALOA_READ_CACHE_TTL_MS = Number(process.env.PCSINALOA_READ_CACHE_TTL_MS || 2 * 60 * 1000);
const PCSINALOA_TOKEN_STATE = {
  token: "",
  expiraEn: 0,
  promise: null,
};
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

function getCachedPcsinaloaRead(cacheKey) {
  const cached = PCSINALOA_READ_CACHE.get(cacheKey);
  if (cached && cached.expiraEn > Date.now()) {
    return cached.promise;
  }

  return null;
}

function setCachedPcsinaloaRead(cacheKey, promise, ttlMs = PCSINALOA_READ_CACHE_TTL_MS) {
  PCSINALOA_READ_CACHE.set(cacheKey, { expiraEn: Date.now() + ttlMs, promise });
  return promise;
}

function invalidatePcsinaloaToken() {
  PCSINALOA_TOKEN_STATE.token = "";
  PCSINALOA_TOKEN_STATE.expiraEn = 0;
  PCSINALOA_TOKEN_STATE.promise = null;
}

async function postJsonWithRetry(url, options) {
  return fetchWithRetry(url, options);
}

async function leerTablaAppSheet(nombreTabla) {
  return readLocalOperationalTable(nombreTabla);
}

async function readDatabaseRevision() {
  const paths = [LOCAL_DB_PATH, `${LOCAL_DB_PATH}-wal`];
  const stats = await Promise.all(paths.map(async (filePath) => {
    try {
      const value = await fs.stat(filePath);
      return `${filePath}:${value.size}:${value.mtimeMs}`;
    } catch {
      return `${filePath}:missing`;
    }
  }));
  return stats.join("|");
}

async function refreshCachesForDatabaseRevision() {
  const revision = await readDatabaseRevision();
  if (lastDatabaseRevision && revision !== lastDatabaseRevision) {
    REPORT_CACHE.clear();
    PCSINALOA_READ_CACHE.clear();
  }
  lastDatabaseRevision = revision;
  return revision;
}

async function mapaSucursales() {
  const map = {};
  for (const row of readLocalOperationalTable("SUCURSALES")) {
    map[row.ID] = {
      id: row.ID,
      nombre: row.NOMBRE || row.LABEL || "",
      tienda: row.TIENDA || "",
      razonSocial: row["RAZON SOCIAL"] || "",
      municipio: { nombre: row.MUNICIPIO_NOMBRE || "" },
      estado: { nombre: row.ESTADO_NOMBRE || "" },
    };
  }
  return map;
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
  const razonSocial = String(
    readField(row, ["contribuyente_razon_social", "RAZON SOCIAL", "RAZON_SOCIAL"]) ||
      sucursal?.razonSocial ||
      ""
  ).trim();
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
  return `/cotizaciones/img-proxy?url=${encodeURIComponent(raw)}`;
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.max(1_000, PDF_IMAGE_TIMEOUT_MS));
    try {
      const response = await fetch(source, {
        headers: { Accept: "image/*" },
        signal: controller.signal,
      });
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
    } finally {
      clearTimeout(timeoutId);
    }
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

async function loginPcsinaloa(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && PCSINALOA_TOKEN_STATE.token && PCSINALOA_TOKEN_STATE.expiraEn > now) {
    return PCSINALOA_TOKEN_STATE.token;
  }

  if (!forceRefresh && PCSINALOA_TOKEN_STATE.promise) {
    return PCSINALOA_TOKEN_STATE.promise;
  }

  const promise = (async () => {
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

    const expiresInRaw =
      data?.data?.user?.expiresInMs ??
      data?.data?.user?.sessionExpiresInMs ??
      data?.data?.expiresInMs ??
      PCSINALOA_TOKEN_CACHE_TTL_MS;
    const expiresInMs = Number(expiresInRaw);
    const ttlMs = Number.isFinite(expiresInMs) && expiresInMs > 0
      ? Math.min(Math.max(expiresInMs, 60_000), PCSINALOA_TOKEN_CACHE_TTL_MS)
      : PCSINALOA_TOKEN_CACHE_TTL_MS;

    PCSINALOA_TOKEN_STATE.token = token;
    PCSINALOA_TOKEN_STATE.expiraEn = Date.now() + ttlMs;
    return token;
  })();

  PCSINALOA_TOKEN_STATE.promise = promise;
  try {
    return await promise;
  } finally {
    if (PCSINALOA_TOKEN_STATE.promise === promise) {
      PCSINALOA_TOKEN_STATE.promise = null;
    }
  }
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

async function pcsinaloaReadIncidenciaEvidenciaList(token, incidenciaId) {
  const payload = {
    VC: "slc_solicitud_incidencia",
    VA: "incidencia_evidencia_list",
    incidencia_id: Number(incidenciaId),
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

async function pcsinaloaReadBySolicitudIdCacheada(solicitudId) {
  const cacheKey = `solicitud:${String(solicitudId || "").trim()}`;
  const cached = getCachedPcsinaloaRead(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const token = await loginPcsinaloa();
    return pcsinaloaReadBySolicitudId(token, solicitudId);
  })();

  return setCachedPcsinaloaRead(cacheKey, promise);
}

async function pcsinaloaReadIncidenciaEvidenciaListCacheada(incidenciaId) {
  const cacheKey = `incidencia:${String(incidenciaId || "").trim()}`;
  const cached = getCachedPcsinaloaRead(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const token = await loginPcsinaloa();
    return pcsinaloaReadIncidenciaEvidenciaList(token, incidenciaId);
  })();

  return setCachedPcsinaloaRead(cacheKey, promise);
}

function normalizarAdjuntosIncidencia(imageList) {
  return (Array.isArray(imageList) ? imageList : [])
    .filter(Boolean)
    .map((img) => {
      const sysfilename = String(img?.sysfilename || "").trim();
      const url_imagen = sysfilename ? `${PCSINALOA_BASE_URL.replace(/\/+$/, "")}/static/${sysfilename}` : "";
      const previewUrl = buildProxyImageUrl(url_imagen);
      return {
        ...img,
        sysfilename,
        url_imagen,
        thumbnailUrl: previewUrl || url_imagen,
        previewUrl: previewUrl || url_imagen,
        filename: String(img?.filename || "").trim(),
        contenttype: String(img?.contenttype || "").trim(),
        descripcion: String(img?.descripcion || "").trim(),
        has_media: Boolean(url_imagen || previewUrl),
      };
    });
}

function enriquecerIncidenciasConImagenes(incidencias) {
  return incidencias
    .map((inc) => {
      if (!inc) return null;

      const files = Array.isArray(inc?.files) ? inc.files.filter(Boolean) : [];
      const imageSources = [
        inc.image_list,
        inc.imageList,
        inc.imagenes,
        inc.images,
        inc.evidencias,
        inc.evidence_list,
        inc.evidencia_list,
      ];

      let imageList = imageSources
        .flatMap((value) => {
          if (!value) return [];
          if (typeof value === "string") {
            try {
              const parsed = JSON.parse(value);
              return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            } catch {
              return [];
            }
          }
          return Array.isArray(value) ? value : [value];
        })
        .filter(Boolean);

      if (!imageList.length && (files.length || inc.incidencia_evidencia_id || inc.is_observacion || inc.observacion)) {
        imageList = [{
          ...inc,
          files,
        }];
      }

      const imagenes = imageList.map((img) => {
        const attachedFiles = Array.isArray(img?.files) ? img.files.filter(Boolean) : [];
        const primaryFile = attachedFiles[0] || null;
        const sysfilename = String(
          img?.sysfilename ||
          primaryFile?.sysfilename ||
          primaryFile?.filename ||
          ""
        ).trim();
        const url_imagen = sysfilename ? `${PCSINALOA_BASE_URL.replace(/\/+$/, "")}/static/${sysfilename}` : "";
        const previewUrl = buildProxyImageUrl(url_imagen);
        const descripcion = String(img?.descripcion || img?.observacion || img?.comentario || "").trim();
        const isObservacion = Boolean(img?.is_observacion || (!url_imagen && !previewUrl && !attachedFiles.length && descripcion));
        return {
          ...img,
          sysfilename,
          descripcion,
          files: attachedFiles,
          is_observacion: isObservacion,
          url_imagen,
          filename: String(img?.filename || primaryFile?.filename || "").trim(),
          contenttype: String(img?.contenttype || primaryFile?.contenttype || "").trim(),
          thumbnailUrl: previewUrl || String(img?.thumbnailUrl || img?.thumbUrl || img?.thumbnail || "").trim() || url_imagen,
          previewUrl: previewUrl || url_imagen,
          has_media: Boolean(url_imagen || previewUrl || attachedFiles.length),
        };
      });

      const evidenciaDescripcion = getBestEvidenceDescription(imagenes.map((img) => img.descripcion));

      return {
        ...inc,
        incidencia_id: inc.incidencia_id,
        solicitud_id: inc.solicitud_id,
        titulo: inc.titulo,
        descripcion: inc.descripcion,
        evidenciaDescripcion,
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

function getBestEvidenceDescription(descriptions) {
  const candidates = dedupeStrings(Array.isArray(descriptions) ? descriptions : []);
  if (!candidates.length) return "";

  const genericPattern = /^(se anexa evidencia|evidencia|observacion|observación|sin archivo adjunto|sin miniatura)$/i;
  const scored = candidates.map((text) => {
    const normalized = normalizeLoose(text);
    let score = text.length;
    if (genericPattern.test(text)) score -= 1000;
    if (/falta|presentar|renovar|actualizar|subsan/i.test(normalized)) score += 75;
    if (/\d/.test(text)) score += 5;
    return { text, score };
  });

  scored.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  return scored[0]?.text || candidates[0] || "";
}

function mergeIncidenciasById(incidencias) {
  const map = new Map();

  for (const inc of Array.isArray(incidencias) ? incidencias : []) {
    if (!inc) continue;
    const key = String(inc.incidencia_id || buildIncidenciaKey(inc) || "").trim() || `row-${map.size + 1}`;
    const current = map.get(key);
    const baseImages = Array.isArray(inc.imagenes) ? inc.imagenes : [];
    const evidenceTexts = [
      inc.evidenciaDescripcion,
      inc.descripcion,
      ...baseImages.map((img) => img?.descripcion),
    ].filter(Boolean);

    if (!current) {
      map.set(key, {
        ...inc,
        imagenes: [...baseImages],
        _evidenceTexts: [...evidenceTexts],
        _rawRecords: [inc],
      });
      continue;
    }

    current.imagenes = [...(Array.isArray(current.imagenes) ? current.imagenes : []), ...baseImages];
    current._evidenceTexts.push(...evidenceTexts);
    current._rawRecords.push(inc);

    const keepFields = [
      "titulo",
      "descripcion",
      "estatus",
      "status",
      "registro_fecha",
      "solicitud_id",
    ];
    for (const field of keepFields) {
      if ((current[field] === undefined || current[field] === null || current[field] === "") && inc[field]) {
        current[field] = inc[field];
      }
    }
  }

  return [...map.values()].map((inc) => {
    const imagenes = dedupeStrings([]); // placeholder to keep shape stable if needed
    const mergedImages = [];
    const seen = new Set();
    for (const img of Array.isArray(inc.imagenes) ? inc.imagenes : []) {
      const imgKey = [
        String(img?.sysfilename || "").trim(),
        String(img?.filename || "").trim(),
        String(img?.descripcion || "").trim(),
      ].join("|");
      if (seen.has(imgKey)) continue;
      seen.add(imgKey);
      mergedImages.push(img);
    }

    const evidenciaDescripcion = getBestEvidenceDescription(inc._evidenceTexts);
    return {
      ...inc,
      evidenciaDescripcion,
      imagenes: mergedImages,
      evidencias: mergedImages.length || Number(inc.evidencias) || 0,
    };
  });
}

function parseStatusValue(inc) {
  const raw = inc?.status ?? inc?.estatus ?? inc?.estado_codigo ?? null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function getStatusLabelFromValue(status) {
  if (status === 0) return "Pendiente";
  if (status === 1) return "Subido";
  if (status === 2) return "Rechazado";
  if (status === 3) return "Subsanado";
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
  const databaseRevision = await refreshCachesForDatabaseRevision();
  const cacheKey = JSON.stringify({
    tienda: String(query.tienda || query.TIENDA || "").trim(),
    razonSocial: String(query.razonSocial || query.razon_social || query["razon social"] || "").trim(),
    municipio: String(query.municipio || query.MUNICIPIO || "").trim(),
  });
  const cached = REPORT_CACHE.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiraEn > now && cached.databaseRevision === databaseRevision) {
    return cached.promise;
  }

  const promise = (async () => {
  const filtros = {
    tienda: String(query.tienda || query.TIENDA || "").trim(),
    razonSocial: String(query.razonSocial || query.razon_social || query["razon social"] || "").trim(),
    municipio: String(query.municipio || query.MUNICIPIO || "").trim(),
  };

  const [rowsRaw, sucursalesMap] = await Promise.all([
    leerTablaAppSheet(APPSHEET_TABLE),
    mapaSucursales(),
  ]);

  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  const estatusIncluidos = new Set(["visitada", "rechazada"]);
  const visitadasBase = rows
    .filter((row) => estatusIncluidos.has(normalizeText(readField(row, ["estatus", "ESTATUS"]))))
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

  const visitadas = await Promise.all(
    visitadasFiltradas.map(async (item) => {
      const solicitudId = String(item.solicitudId || "").trim();
      let incidencias = [];

      if (solicitudId) {
        try {
          const rawIncidencias = await pcsinaloaReadBySolicitudIdCacheada(solicitudId);
          const incidenciasBase = sortIncidenciasForReport(rawIncidencias);
          incidencias = await Promise.all(
            incidenciasBase.map(async (inc) => {
              const adjuntosIncidencia = normalizarAdjuntosIncidencia(inc.image_list || inc.imageList || []);
              let evidenciasDetalle = [];
              try {
                evidenciasDetalle = await pcsinaloaReadIncidenciaEvidenciaListCacheada(inc.incidencia_id);
              } catch (err) {
                evidenciasDetalle = [];
                inc.errorEvidencias = err.message;
              }

              evidenciasDetalle = (Array.isArray(evidenciasDetalle) ? evidenciasDetalle : []).map((ev) => ({
                ...ev,
                files: (Array.isArray(ev?.files) ? ev.files.filter(Boolean) : []).map((file) => {
                  const sysfilename = String(file?.sysfilename || "").trim();
                  const url_imagen = sysfilename ? `${PCSINALOA_BASE_URL.replace(/\/+$/, "")}/static/${sysfilename}` : "";
                  const previewUrl = buildProxyImageUrl(url_imagen);
                  return {
                    ...file,
                    sysfilename,
                    url_imagen,
                    thumbnailUrl: previewUrl || url_imagen,
                    previewUrl: previewUrl || url_imagen,
                  };
                }),
              }));

              const evidenciaDescripcion = getBestEvidenceDescription(evidenciasDetalle.map((ev) => ev.descripcion));
              const evidenciasCount = adjuntosIncidencia.length + evidenciasDetalle.filter((ev) => Array.isArray(ev.files) && ev.files.length > 0).length;

              return {
                ...inc,
                evidenciaDescripcion,
                adjuntosIncidencia,
                evidenciasDetalle,
                imagenes: [...adjuntosIncidencia, ...evidenciasDetalle],
                evidencias: evidenciasCount || Number(inc.evidencias) || 0,
              };
            })
          );
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
        evidenciasCount: incidencias.reduce((acc, inc) => acc + (Number(inc.evidencias) || 0), 0) || Number(item.evidenciasCount || 0) || 0,
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
    source: "sqlite-local",
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
  })();

  REPORT_CACHE.set(cacheKey, {
    expiraEn: now + Math.max(30_000, REPORT_CACHE_TTL_MS),
    databaseRevision,
    promise,
  });
  try {
    return await promise;
  } catch (err) {
    REPORT_CACHE.delete(cacheKey);
    throw err;
  }
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const source = Array.isArray(items) ? items : [];
  if (source.length === 0) return [];

  const limit = Math.min(source.length, Math.max(1, Math.floor(Number(concurrency) || 1)));
  const results = new Array(source.length);
  let cursor = 0;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(source[index], index);
    }
  }));

  return results;
}

export async function prepararSolventacionesPdf(reporte) {
  const copia = typeof structuredClone === "function"
    ? structuredClone(reporte)
    : JSON.parse(JSON.stringify(reporte || {}));

  const grupos = Array.isArray(copia?.grupos) ? copia.grupos : [];
  const imagenes = [];
  for (const grupo of grupos) {
    for (const item of Array.isArray(grupo.items) ? grupo.items : []) {
      for (const inc of Array.isArray(item.incidencias) ? item.incidencias : []) {
        imagenes.push(...[
          ...(Array.isArray(inc.adjuntosIncidencia) ? inc.adjuntosIncidencia : []),
          ...(Array.isArray(inc.evidenciasDetalle) ? inc.evidenciasDetalle.flatMap((ev) => Array.isArray(ev.files) ? ev.files : []) : []),
        ]);
      }
    }
  }

  await mapWithConcurrency(imagenes, PDF_IMAGE_CONCURRENCY, async (img) => {
    const source = img.url_imagen || img.url || img.previewUrl || img.thumbnailUrl || "";
    try {
      img.pdfPreviewUrl = await imageUrlToPdfDataUri(source, { width: 420, height: 320, quality: 38 });
      img.pdfPreviewUnavailable = false;
    } catch {
      img.pdfPreviewUrl = "";
      img.pdfPreviewUnavailable = true;
    }
  });

  return copia;
}
