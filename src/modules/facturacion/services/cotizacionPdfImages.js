import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_URI_CACHE = new Map();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function getCachedDataUri(key) {
  const entry = DATA_URI_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    DATA_URI_CACHE.delete(key);
    return null;
  }
  return entry.dataUri;
}

function setCachedDataUri(key, dataUri) {
  DATA_URI_CACHE.set(key, {
    dataUri,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function resolveBrandImageFallback() {
  const brandDirs = [
    process.env.PUBLICIMG_PATH,
    path.resolve(__dirname, "..", "..", "..", "..", "publicimg"),
    path.resolve(__dirname, "..", "..", "..", "public", "img"),
    "/app/publicimg",
  ].filter(Boolean);

  for (const baseDir of brandDirs) {
    const candidate = path.join(baseDir, "Logo sin fondo 3D HD.png");
    if (fs.existsSync(candidate)) {
      try {
        const bytes = fs.readFileSync(candidate);
        if (bytes.length > 0) {
          return `data:image/png;base64,${bytes.toString("base64")}`;
        }
      } catch {}
    }
  }
  return "";
}

function resolveLocalImgFile(raw) {
  const clean = String(raw || "").split("?")[0].replace(/^\/+/, "");
  const match = clean.match(/^(?:img|publicimg)\/(.+)$/i);
  if (!match) return null;
  const fileName = match[1];
  const brandDirs = [
    process.env.PUBLICIMG_PATH,
    path.resolve(__dirname, "..", "..", "..", "..", "publicimg"),
    path.resolve(__dirname, "..", "..", "..", "public", "img"),
    "/app/publicimg",
  ].filter(Boolean);

  for (const dir of brandDirs) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) {
      try {
        const ext = path.extname(candidate).toLowerCase().replace(".", "") || "png";
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : "image/png";
        const bytes = fs.readFileSync(candidate);
        if (bytes.length > 0) {
          return `data:${mime};base64,${bytes.toString("base64")}`;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Resolves any image URL (proxy, relative, absolute, google drive, appsheet) to a base64 Data URI.
 */
export async function resolveImageToDataUri(urlOrPath) {
  const raw = String(urlOrPath || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;

  const cached = getCachedDataUri(raw);
  if (cached) return cached;

  const localDataUri = resolveLocalImgFile(raw);
  if (localDataUri) {
    setCachedDataUri(raw, localDataUri);
    return localDataUri;
  }

  // Direct helper for empresa logo if matching pattern
  const empresaMatch = raw.match(/\/dashboard\/empresas\/([^/?#]+)\/logo/i);
  if (empresaMatch) {
    const empresaId = decodeURIComponent(empresaMatch[1]);
    try {
      const { getEmpresaLogoForPortal } = await import("../../home/portalAuth.service.js");
      const logo = await getEmpresaLogoForPortal(empresaId);
      if (logo?.bytes?.length) {
        const dataUri = `data:${logo.contentType || "image/png"};base64,${logo.bytes.toString("base64")}`;
        setCachedDataUri(raw, dataUri);
        return dataUri;
      }
    } catch {}
  }

  let targetUrl = raw;

  // Extract real target URL if wrapped in proxy
  if (raw.includes("/img-proxy?url=") || raw.includes("/img-proxy?")) {
    try {
      const parsed = new URL(raw, "http://127.0.0.1");
      const paramUrl = parsed.searchParams.get("url");
      if (paramUrl) {
        targetUrl = paramUrl;
        const sz = parsed.searchParams.get("sz");
        if (sz && targetUrl.includes("id=")) {
          const u = new URL(targetUrl);
          u.searchParams.set("sz", sz);
          targetUrl = u.toString();
        }
      }
    } catch {}
  }

  // If it's a relative URL without protocol, connect to localhost
  if (!/^https?:\/\//i.test(targetUrl)) {
    const port = process.env.PORT || 7000;
    targetUrl = `http://127.0.0.1:${port}${targetUrl.startsWith("/") ? "" : "/"}${targetUrl}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const resp = await fetch(targetUrl, {
      headers: { Accept: "image/*" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (resp.ok) {
      const contentType = resp.headers.get("content-type") || "image/png";
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.length > 0) {
        const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;
        setCachedDataUri(raw, dataUri);
        return dataUri;
      }
    }
  } catch (err) {
    console.warn(`[resolveImageToDataUri] No se pudo descargar imagen ${raw}:`, err?.message || err);
  }

  return "";
}

/**
 * Prepares cotizacion data for PDF by inlining all images (logoEmisor, logoCliente, firma, escudos) as data URIs.
 */
export async function prepararCotizacionDataParaPdf(data) {
  if (!data) return data;
  const copia = typeof structuredClone === "function"
    ? structuredClone(data)
    : JSON.parse(JSON.stringify(data));

  copia.isPdfExport = true;

  const tasks = [];

  // 1. Logo Emisor
  tasks.push((async () => {
    let uri = "";
    if (copia.logoEmisor) {
      uri = await resolveImageToDataUri(copia.logoEmisor);
    }
    if (uri) {
      copia.logoEmisor = uri;
    } else {
      const fallback = resolveBrandImageFallback();
      if (fallback) copia.logoEmisor = fallback;
    }
  })());

  // 2. Logo Cliente
  if (copia.logoCliente) {
    tasks.push((async () => {
      const uri = await resolveImageToDataUri(copia.logoCliente);
      if (uri) copia.logoCliente = uri;
    })());
  }

  // 3. Firma
  if (copia.firma && copia.firma.firmaUrl) {
    tasks.push((async () => {
      const uri = await resolveImageToDataUri(copia.firma.firmaUrl);
      if (uri) copia.firma.firmaUrl = uri;
    })());
  }

  // 4. Escudos en centros
  if (Array.isArray(copia.centros)) {
    for (const c of copia.centros) {
      if (c.estado?.escudo) {
        tasks.push((async () => {
          const uri = await resolveImageToDataUri(c.estado.escudo);
          if (uri) c.estado.escudo = uri;
        })());
      }
      if (c.municipio?.escudo) {
        tasks.push((async () => {
          const uri = await resolveImageToDataUri(c.municipio.escudo);
          if (uri) c.municipio.escudo = uri;
        })());
      }
    }
  }

  await Promise.allSettled(tasks);
  return copia;
}

