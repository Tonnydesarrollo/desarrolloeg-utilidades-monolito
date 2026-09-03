import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { google } from "googleapis";
import { readLocalOperationalTable } from "../../services/localOperationalRepository.js";

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalize(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function readStructuredUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return text(parsed?.Url || parsed?.url || parsed?.Link || parsed?.link || parsed?.LinkText);
  } catch {
    return raw;
  }
}

export function extractDriveFolderId(value) {
  const candidate = readStructuredUrl(value);
  if (!candidate) return "";

  const folderMatch = candidate.match(/\/folders\/([a-zA-Z0-9_-]+)/i);
  if (folderMatch?.[1]) return folderMatch[1];

  try {
    const url = new URL(candidate);
    const queryId = text(url.searchParams.get("id"));
    if (queryId) return queryId;
  } catch {
    // A raw Drive folder ID is also accepted from server configuration.
  }

  return /^[a-zA-Z0-9_-]{10,}$/.test(candidate) ? candidate : "";
}

function rowId(row) {
  return text(row?.ID || row?.["Row ID"] || row?.id || row?.row_id);
}

function rowLabel(row) {
  return text(row?.LABEL2 || row?.LABEL || row?.NOMBRE || row?.label2 || row?.label);
}

function findSucursal(rows, { sucursalId = "", sucursalLabel = "" } = {}) {
  const wantedId = text(sucursalId);
  if (wantedId) {
    const byId = rows.find((row) => rowId(row) === wantedId);
    if (byId) return byId;
  }

  const wantedLabel = normalize(sucursalLabel);
  if (!wantedLabel) return null;
  return rows.find((row) => normalize(rowLabel(row)) === wantedLabel) || null;
}

export function resolveConstanciasDriveDestination({
  sucursalId = "",
  sucursalLabel = "",
  capacitacionId = "",
  sucursales = readLocalOperationalTable("SUCURSALES"),
  capacitaciones = readLocalOperationalTable("CAPACITACIONES"),
  fallbackFolder = process.env.CONSTANCIAS_DRIVE_FOLDER_ID || "",
} = {}) {
  let resolvedSucursalId = text(sucursalId);
  if (!resolvedSucursalId && capacitacionId) {
    const capacitacion = capacitaciones.find((row) => rowId(row) === text(capacitacionId));
    resolvedSucursalId = text(capacitacion?.CEDE || capacitacion?.cede_sucursal_id);
  }

  const sucursal = findSucursal(sucursales, {
    sucursalId: resolvedSucursalId,
    sucursalLabel,
  });
  const folderId = extractDriveFolderId(sucursal?.DRIVE || sucursal?.drive || fallbackFolder);

  if (!folderId) {
    const label = rowLabel(sucursal) || text(sucursalLabel) || resolvedSucursalId || "seleccionada";
    const error = new Error(`La sucursal ${label} no tiene una carpeta de Drive configurada.`);
    error.code = "CONSTANCIAS_DRIVE_FOLDER_MISSING";
    throw error;
  }

  return {
    folderId,
    sucursalId: rowId(sucursal) || resolvedSucursalId,
    sucursalLabel: rowLabel(sucursal) || text(sucursalLabel) || "SUCURSAL",
  };
}

export function sanitizePdfFileName(value, fallback = "CONSTANCIAS.pdf") {
  const cleaned = text(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 180)
    .trim();
  const base = cleaned || fallback;
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

function loadGoogleAuth() {
  const credentialsPath = text(
    process.env.CONSTANCIAS_GOOGLE_CREDENTIALS_PATH
      || process.env.FACTURACION_GOOGLE_CREDENTIALS_PATH,
  );
  const tokenPath = text(
    process.env.CONSTANCIAS_GOOGLE_TOKEN_PATH
      || process.env.FACTURACION_GOOGLE_TOKEN_PATH,
  );

  if (!credentialsPath || !tokenPath || !fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
    const error = new Error("Google Drive no esta configurado en este entorno.");
    error.code = "CONSTANCIAS_DRIVE_AUTH_MISSING";
    throw error;
  }

  const credentialsJson = JSON.parse(fs.readFileSync(path.resolve(credentialsPath), "utf8"));
  const credentials = credentialsJson.installed || credentialsJson.web;
  const token = JSON.parse(fs.readFileSync(path.resolve(tokenPath), "utf8"));
  if (!credentials?.client_id || !credentials?.client_secret) {
    const error = new Error("Las credenciales de Google Drive no son validas.");
    error.code = "CONSTANCIAS_DRIVE_AUTH_INVALID";
    throw error;
  }

  const redirectUri = Array.isArray(credentials.redirect_uris) ? credentials.redirect_uris[0] : undefined;
  const auth = new google.auth.OAuth2(credentials.client_id, credentials.client_secret, redirectUri);
  auth.setCredentials(token);
  return auth;
}

export async function uploadConstanciasPdf({ buffer, fileName, destination } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("El PDF recibido esta vacio.");
    error.code = "CONSTANCIAS_PDF_EMPTY";
    throw error;
  }

  const drive = google.drive({ version: "v3", auth: loadGoogleAuth() });
  const safeName = sanitizePdfFileName(fileName, `${destination.sucursalLabel} DIP.pdf`);
  const response = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: "application/pdf",
      parents: [destination.folderId],
      description: `Constancias generadas para ${destination.sucursalLabel}`,
    },
    media: {
      mimeType: "application/pdf",
      body: Readable.from(buffer),
    },
    fields: "id,name,webViewLink,webContentLink,createdTime",
    supportsAllDrives: true,
  });

  const file = response.data || {};
  return {
    id: text(file.id),
    name: text(file.name) || safeName,
    url: text(file.webViewLink) || (file.id ? `https://drive.google.com/file/d/${file.id}/view` : ""),
    downloadUrl: text(file.webContentLink),
    createdTime: text(file.createdTime),
  };
}
