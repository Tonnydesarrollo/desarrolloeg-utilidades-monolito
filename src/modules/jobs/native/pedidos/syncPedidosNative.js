import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import { getAuthClient } from "./auth.js";
import { createDriveClient } from "./drive.js";
import * as pedidosExtractors from "./pedidos_extractors.js";
import { diffRowsAgainstReplica, loadReplica, saveReplicaRows } from "../../services/localReplica.js";

const CONFIG = {
  credentialsPath: process.env.PEDIDOS_GOOGLE_CLIENT_CREDENTIALS || process.env.GOOGLE_CLIENT_CREDENTIALS || "credentials.json",
  tokenPath: process.env.PEDIDOS_GOOGLE_TOKEN_PATH || process.env.GOOGLE_TOKEN_PATH || "token.json",
  appsheetAppId: process.env.PEDIDOS_APPSHEET_APP_ID || "",
  appsheetApiKey: process.env.PEDIDOS_APPSHEET_API_KEY || "",
  appsheetTablePedidos: process.env.PEDIDOS_APPSHEET_TABLE_PEDIDOS || "PEDIDOS_LEY",
  appsheetTableLiberaciones: process.env.PEDIDOS_APPSHEET_TABLE_LIBERACIONES || "LIBERACIONES",
  appsheetKeyPedidos: process.env.PEDIDOS_APPSHEET_KEY_PEDIDOS || "PEDIDO",
  appsheetKeyLiberaciones: process.env.PEDIDOS_APPSHEET_KEY_LIBERACIONES || "LIBERACION",
  usePublicPdf: String(process.env.PEDIDOS_USE_PUBLIC_PDF || "").trim() === "1",
  maxRows: Number(process.env.PEDIDOS_MAX_ROWS || "0"),
  retryMax: Number(process.env.PEDIDOS_RETRY_MAX || "4"),
  retryBaseMs: Number(process.env.PEDIDOS_RETRY_BASE_MS || "750"),
  fetchTimeoutMs: Number(process.env.PEDIDOS_FETCH_TIMEOUT_MS || "20000"),
  appsheetDelayMs: Number(process.env.PEDIDOS_APPSHEET_DELAY_MS || "600"),
  outputDir: process.env.PEDIDOS_OUTPUT_DIR || path.resolve(process.cwd(), "src", "modules", "jobs", "native", "pedidos", "data")
};

function requireConfig() {
  const missing = [];
  if (!CONFIG.appsheetAppId) missing.push("PEDIDOS_APPSHEET_APP_ID");
  if (!CONFIG.appsheetApiKey) missing.push("PEDIDOS_APPSHEET_API_KEY");
  if (!CONFIG.usePublicPdf) {
    if (!CONFIG.credentialsPath) missing.push("PEDIDOS_GOOGLE_CLIENT_CREDENTIALS");
    if (!CONFIG.tokenPath) missing.push("PEDIDOS_GOOGLE_TOKEN_PATH");
  }
  if (missing.length) throw new Error(`Faltan variables en .env: ${missing.join(", ")}`);
}
function isEmpty(v) { return v === null || v === undefined || String(v).trim() === ""; }
function isBadProveedor(v) {
  const s = String(v || "").trim().toUpperCase();
  return s === "DOMICILIO" || s === "DOMICILIO:" || s.startsWith("DOMICILIO ");
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function ensureOutputDir() { fs.mkdirSync(CONFIG.outputDir, { recursive: true }); }
function writeJson(name, data) { ensureOutputDir(); fs.writeFileSync(path.join(CONFIG.outputDir, name), JSON.stringify(data, null, 2), "utf8"); }
function resolveReplicaPath(name) { return path.join(CONFIG.outputDir, `${name}_replica.json`); }
function isTrackedRowUnchanged(row, keyField, replicaRows) {
  return diffRowsAgainstReplica([row], keyField, replicaRows).changedRows.length === 0;
}
function buildPedidoReplicaRow(row, pedido, overrides = {}) {
  return {
    [CONFIG.appsheetKeyPedidos]: pedido,
    PDF: row.PDF || row.Pdf || row.pdf || "",
    PROVEEDOR: row.PROVEEDOR ?? "",
    ESTABLECIMIENTO: row.ESTABLECIMIENTO ?? "",
    FECHA: row.FECHA ?? "",
    IMPORTE: row.IMPORTE ?? "",
    DESCRIPCION: row.DESCRIPCION ?? "",
    ...overrides,
  };
}
function buildLiberacionReplicaRow(row, liberacion, overrides = {}) {
  return {
    [CONFIG.appsheetKeyLiberaciones]: liberacion,
    PDF: row.PDF || row.Pdf || row.pdf || "",
    "NUM. DE PEDIDO": row["NUM. DE PEDIDO"] ?? "",
    FECHA: row.FECHA ?? "",
    ...overrides,
  };
}

async function fetchWithRetry(url, options = {}, meta = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= CONFIG.retryMax; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.fetchTimeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (res.ok) return res;
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        const retryAfter = Number(res.headers.get("retry-after") || "0") * 1000;
        const backoff = retryAfter || CONFIG.retryBaseMs * Math.pow(2, attempt);
        await sleep(backoff + Math.floor(Math.random() * 250));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= CONFIG.retryMax) break;
      await sleep(CONFIG.retryBaseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`fetch failed${meta?.label ? ` (${meta.label})` : ""}${lastErr?.message ? `: ${lastErr.message}` : ""}`);
}

function extractDriveFileId(url) {
  if (!url) return null;
  const patterns = [/\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/, /\/uc\?id=([a-zA-Z0-9_-]+)/];
  for (const re of patterns) {
    const m = String(url).match(re);
    if (m) return m[1];
  }
  return null;
}
async function downloadDriveFile(drive, fileId) {
  const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}
async function downloadPublicPdf(pdfUrl) {
  const fileId = extractDriveFileId(pdfUrl);
  const url = fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : pdfUrl;
  const res = await fetchWithRetry(url, {}, { label: "downloadPublicPdf" });
  if (!res.ok) throw new Error(`No pude descargar PDF publico (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
function looksLikePdf(buffer) { return buffer.slice(0, 5).toString("utf8") === "%PDF-"; }
async function parsePdf(buffer) {
  if (!looksLikePdf(buffer)) throw new Error("El archivo no parece PDF");
  const data = await pdfParse(buffer);
  return data.text || "";
}
async function fetchFromAppSheet(tableName) {
  const url = `https://api.appsheet.com/api/v2/apps/${CONFIG.appsheetAppId}/tables/${encodeURIComponent(tableName)}/Action`;
  const body = { Action: "Find", Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" }, Rows: [] };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "ApplicationAccessKey": CONFIG.appsheetApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, { label: `fetchFromAppSheet:${tableName}` });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`AppSheet respondio no-JSON (${res.status})`); }
  return Array.isArray(data) ? data : (data?.Rows || data?.rows || []);
}
async function updateAppSheet(tableName, row) {
  const url = `https://api.appsheet.com/api/v2/apps/${CONFIG.appsheetAppId}/tables/${encodeURIComponent(tableName)}/Action`;
  const body = { Action: "Edit", Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" }, Rows: [row] };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "ApplicationAccessKey": CONFIG.appsheetApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, { label: `updateAppSheet:${tableName}` });
  if (!res.ok) throw new Error(`AppSheet error (${res.status}): ${await res.text()}`);
}
async function getPdfText(row, drive) {
  const pdfUrl = row.PDF || row.Pdf || row.pdf;
  if (!pdfUrl) throw new Error("Fila sin PDF");
  const fileId = extractDriveFileId(pdfUrl);
  if (!fileId) throw new Error("No pude extraer ID del PDF");
  if (CONFIG.usePublicPdf) {
    try {
      const buffer = await downloadPublicPdf(pdfUrl);
      if (looksLikePdf(buffer)) return await parsePdf(buffer);
    } catch (err) {
      if (!drive) throw new Error(`PDF publico fallo y no hay Drive: ${err?.message || err}`);
    }
  }
  if (!drive) throw new Error("No hay cliente de Drive para descargar el PDF");
  return await parsePdf(await downloadDriveFile(drive, fileId));
}

async function processPedidos(drive) {
  const rows = await fetchFromAppSheet(CONFIG.appsheetTablePedidos);
  const replicaPath = resolveReplicaPath("pedidos");
  const replica = loadReplica(replicaPath);
  const nextReplicaRows = [];
  const limit = CONFIG.maxRows > 0 ? Math.min(CONFIG.maxRows, rows.length) : rows.length;
  let updated = 0, skipped = 0, skippedUnchanged = 0; const skippedRows = [];
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    const pedido = row.PEDIDO || row[CONFIG.appsheetKeyPedidos];
    if (isEmpty(pedido)) { skippedRows.push({ row: i + 1, pedido: "", reason: "sin_pedido" }); skipped++; continue; }
    const trackedRow = buildPedidoReplicaRow(row, pedido);
    const needs = { PROVEEDOR: isEmpty(row.PROVEEDOR) || isBadProveedor(row.PROVEEDOR), ESTABLECIMIENTO: isEmpty(row.ESTABLECIMIENTO), FECHA: isEmpty(row.FECHA), IMPORTE: isEmpty(row.IMPORTE), DESCRIPCION: isEmpty(row.DESCRIPCION) };
    if (!Object.values(needs).some(Boolean)) {
      nextReplicaRows.push(trackedRow);
      skippedRows.push({ row: i + 1, pedido, reason: "sin_campos_faltantes" });
      continue;
    }
    if (isTrackedRowUnchanged(trackedRow, CONFIG.appsheetKeyPedidos, replica.rows)) {
      nextReplicaRows.push(trackedRow);
      skippedRows.push({ row: i + 1, pedido, reason: "sin_cambios_desde_snapshot" });
      skippedUnchanged++;
      continue;
    }
    let text;
    try { text = await getPdfText(row, drive); } catch (err) { skippedRows.push({ row: i + 1, pedido, reason: `pdf_error: ${err?.message || err}` }); skipped++; continue; }
    const updates = {};
    if (needs.PROVEEDOR) { const prov = pedidosExtractors.extractProveedor(text); if (!isEmpty(prov)) updates.PROVEEDOR = prov; }
    if (needs.ESTABLECIMIENTO) { const est = pedidosExtractors.extractEstablecimiento(text); if (!isEmpty(est)) updates.ESTABLECIMIENTO = est; }
    if (needs.FECHA) { const fecha = pedidosExtractors.extractFecha(text); if (!isEmpty(fecha)) updates.FECHA = fecha; }
    if (needs.IMPORTE) { const importe = pedidosExtractors.extractImporte(text); if (!isEmpty(importe)) updates.IMPORTE = importe; }
    if (needs.DESCRIPCION) { const desc = pedidosExtractors.extractDescripcion(text); if (!isEmpty(desc)) updates.DESCRIPCION = desc; }
    if (!Object.values(updates).some(v => !isEmpty(v))) {
      nextReplicaRows.push(trackedRow);
      skippedRows.push({ row: i + 1, pedido, reason: "sin_actualizaciones" });
      skipped++;
      continue;
    }
    updates[CONFIG.appsheetKeyPedidos] = pedido;
    await updateAppSheet(CONFIG.appsheetTablePedidos, updates);
    nextReplicaRows.push(buildPedidoReplicaRow(row, pedido, updates));
    updated++;
    if (CONFIG.appsheetDelayMs > 0) await sleep(CONFIG.appsheetDelayMs);
  }
  saveReplicaRows(replicaPath, nextReplicaRows, CONFIG.appsheetKeyPedidos);
  return { updated, skipped, skippedUnchanged, skippedRows };
}

async function processLiberaciones(drive) {
  const rows = await fetchFromAppSheet(CONFIG.appsheetTableLiberaciones);
  const replicaPath = resolveReplicaPath("liberaciones");
  const replica = loadReplica(replicaPath);
  const nextReplicaRows = [];
  const limit = CONFIG.maxRows > 0 ? Math.min(CONFIG.maxRows, rows.length) : rows.length;
  let updated = 0, skipped = 0, skippedUnchanged = 0; const skippedRows = [];
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    const liberacion = row.LIBERACION || row[CONFIG.appsheetKeyLiberaciones];
    if (isEmpty(liberacion)) { skippedRows.push({ row: i + 1, liberacion: "", reason: "sin_liberacion" }); skipped++; continue; }
    const trackedRow = buildLiberacionReplicaRow(row, liberacion);
    const needs = { "NUM. DE PEDIDO": isEmpty(row["NUM. DE PEDIDO"]), FECHA: isEmpty(row.FECHA) };
    if (!Object.values(needs).some(Boolean)) {
      nextReplicaRows.push(trackedRow);
      skippedRows.push({ row: i + 1, liberacion, reason: "sin_campos_faltantes" });
      continue;
    }
    if (isTrackedRowUnchanged(trackedRow, CONFIG.appsheetKeyLiberaciones, replica.rows)) {
      nextReplicaRows.push(trackedRow);
      skippedRows.push({ row: i + 1, liberacion, reason: "sin_cambios_desde_snapshot" });
      skippedUnchanged++;
      continue;
    }
    let text;
    try { text = await getPdfText(row, drive); } catch (err) { skippedRows.push({ row: i + 1, liberacion, reason: `pdf_error: ${err?.message || err}` }); skipped++; continue; }
    const updates = {};
    if (needs["NUM. DE PEDIDO"]) updates["NUM. DE PEDIDO"] = pedidosExtractors.extractPedidoNumber(text);
    if (needs.FECHA) updates.FECHA = pedidosExtractors.extractFecha(text);
    if (!Object.values(updates).some(v => !isEmpty(v))) {
      nextReplicaRows.push(trackedRow);
      skippedRows.push({ row: i + 1, liberacion, reason: "sin_actualizaciones" });
      skipped++;
      continue;
    }
    updates[CONFIG.appsheetKeyLiberaciones] = liberacion;
    await updateAppSheet(CONFIG.appsheetTableLiberaciones, updates);
    nextReplicaRows.push(buildLiberacionReplicaRow(row, liberacion, updates));
    updated++;
    if (CONFIG.appsheetDelayMs > 0) await sleep(CONFIG.appsheetDelayMs);
  }
  saveReplicaRows(replicaPath, nextReplicaRows, CONFIG.appsheetKeyLiberaciones);
  return { updated, skipped, skippedUnchanged, skippedRows };
}

export async function syncPedidosNative() {
  requireConfig();
  let drive = null;
  if (!CONFIG.usePublicPdf || (CONFIG.usePublicPdf && fs.existsSync(CONFIG.credentialsPath))) {
    try {
      const auth = await getAuthClient({ credentialsPath: CONFIG.credentialsPath, tokenPath: CONFIG.tokenPath });
      drive = createDriveClient(auth);
    } catch (err) {
      if (!CONFIG.usePublicPdf) throw err;
    }
  }
  const pedidos = await processPedidos(drive);
  const liberaciones = await processLiberaciones(drive);
  if (pedidos.skippedRows.length) writeJson("omitidos_pedidos.json", pedidos.skippedRows);
  if (liberaciones.skippedRows.length) writeJson("omitidos_liberaciones.json", liberaciones.skippedRows);
  return { ok: true, pedidos, liberaciones };
}
