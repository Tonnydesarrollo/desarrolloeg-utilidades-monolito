import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { google } from "googleapis";
import pdfParse from "pdf-parse";
import { openDesarrolloegSyncDb } from "../../../../services/desarrolloegLocalDb.js";
import { readLocalOperationalTable } from "../../../../services/localOperationalRepository.js";
import { getDictamenesAuthClient } from "./auth.js";

const PROCESSED_LABEL = "DESARROLLOEG/DICTAMEN_ESTRUCTURAL_PROCESADO";
const ERROR_LABEL = "DESARROLLOEG/DICTAMEN_ESTRUCTURAL_ERROR";
const DEFAULT_SHEET_ID = "1p9GMdAP8Df4y5SqfAAsRULv9vUXEIqlK29rQfwCG5Rg";
const DEFAULT_SHEET_GID = 499547528;
const MONTHS = { ene: 1, enero: 1, jan: 1, january: 1, feb: 2, febrero: 2, february: 2, mar: 3, marzo: 3, march: 3, abr: 4, abril: 4, apr: 4, april: 4, may: 5, mayo: 5, jun: 6, junio: 6, june: 6, jul: 7, julio: 7, july: 7, ago: 8, agosto: 8, aug: 8, august: 8, sep: 9, septiembre: 9, sept: 9, september: 9, oct: 10, octubre: 10, october: 10, nov: 11, noviembre: 11, november: 11, dic: 12, diciembre: 12, dec: 12, december: 12 };

export function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export function isStructuralReportFilename(filename) {
  const text = normalizeText(filename);
  return /\bDICTAMEN\b/.test(text) && /\b(ESTR|ESTRUCTURAL)\b/.test(text) && /\.PDF$/i.test(String(filename || ""));
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function parseDocumentDate(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  let match = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
  if (match) return validDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = text.match(/\b(\d{1,2})(?:\s+DE\s+|[\s._-]+)([A-ZÁÉÍÓÚÑ]+)(?:\s+DE\s+|[\s._-]+)(20\d{2})\b/i);
  if (!match) return null;
  const month = MONTHS[normalizeText(match[2]).toLowerCase()];
  return month ? validDate(Number(match[3]), month, Number(match[1])) : null;
}

export function addOneYear(date) {
  const year = date.getUTCFullYear() + 1;
  const month = date.getUTCMonth();
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day));
}

function findDates(text) {
  const regex = /\d{1,2}(?:[\/.-]\d{1,2}[\/.-](?:20\d{2})|(?:\s+DE\s+|[\s._-]+)[A-ZÁÉÍÓÚÑ]+(?:\s+DE\s+|[\s._-]+)(?:20\d{2}))(?!\d)/gi;
  return [...String(text || "").matchAll(regex)].map((match) => ({ raw: match[0], date: parseDocumentDate(match[0]), index: match.index })).filter((item) => item.date);
}

export function extractDocumentDates(text, filename = "") {
  const content = String(text || "");
  const period = content.match(/VIGENCIA[\s\S]{0,180}?\bDEL\s+([^\n]{6,40}?)\s+AL\s+([^\n]{6,40})/i);
  if (period) {
    const issuanceDate = findDates(period[1])[0]?.date || null;
    const expirationDate = findDates(period[2])[0]?.date || null;
    if (expirationDate) return { issuanceDate, expirationDate };
  }
  const expiryLabel = content.match(/(?:FECHA\s+DE\s+)?(?:VENCIMIENTO|EXPIRACI[OÓ]N)[^\d]{0,50}([^\n]{6,50})/i);
  const expirationDate = expiryLabel ? findDates(expiryLabel[1])[0]?.date : null;
  const issueLabel = content.match(/(?:FECHA\s+DE\s+)?(?:EXPEDICI[OÓ]N|EMISI[OÓ]N)[^\d]{0,50}([^\n]{6,50})/i);
  const issuanceDate = (issueLabel ? findDates(issueLabel[1])[0]?.date : null) || findDates(filename)[0]?.date || null;
  return { issuanceDate, expirationDate: expirationDate || (issuanceDate ? addOneYear(issuanceDate) : null) };
}

function branchName(row) {
  return row.NOMBRE || row.SUCURSAL || row.NAME || "";
}

export function resolveBranch(filename, text, branches) {
  const sourceText = String(text || "").slice(0, 8000);
  const haystack = normalizeText(`${filename} ${sourceText}`);
  const numeric = new Set(normalizeText(filename).match(/\b\d{3,5}\b/g) || []);
  for (const match of sourceText.matchAll(/(?:TIENDA|SUCURSAL)[^\n]{0,100}?#\s*(\d{3,5})\b/gi)) {
    numeric.add(match[1]);
  }
  const exact = branches.find((row) => numeric.has(String(row.TIENDA || row.NUMERO || "").trim()));
  if (exact) return exact;
  if (/\bMAYOREO\s+(?:CLN|CULIACAN)\b/.test(haystack)) {
    const mayoreoCuliacan = branches.find((row) => String(row.TIENDA || row.NUMERO || "").trim() === "2009");
    if (mayoreoCuliacan) return mayoreoCuliacan;
  }
  const candidates = branches.map((row) => {
    const name = normalizeText(branchName(row)).replace(/^\d+\s+/, "");
    const words = name.split(" ").filter((word) => word.length >= 3 && !["LEY", "SUPER", "EXPRESS", "TIENDA"].includes(word));
    const score = words.reduce((sum, word) => sum + (haystack.includes(word) ? word.length : 0), 0);
    return { row, score, required: Math.max(4, Math.min(10, Math.floor(name.length / 3))) };
  }).filter((item) => item.score >= item.required).sort((a, b) => b.score - a.score);
  return candidates[0]?.row || null;
}

function formatDate(date) {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function formatTimestamp(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function nextUniqueTimestamp(previousTimestamp, now = new Date(), timeZone = "America/Chihuahua") {
  const formattedNow = formatTimestamp(now, timeZone);
  if (previousTimestamp) {
    const match = String(previousTimestamp).match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const previous = new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}Z`);
      const key = (value) => value.replace(/(\d{2})\/(\d{2})\/(\d{4}) (.*)/, "$3$2$1$4");
      if (key(formattedNow) <= key(previousTimestamp)) return formatTimestamp(new Date(previous.getTime() + 1000), "UTC");
    }
  }
  return formattedNow;
}

function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS dictamenes_estructurales_archivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, gmail_message_id TEXT NOT NULL, gmail_thread_id TEXT,
    gmail_attachment_id TEXT NOT NULL, attachment_key TEXT NOT NULL UNIQUE, sha256 TEXT,
    filename TEXT NOT NULL, local_path TEXT, email_date TEXT, sender TEXT, tienda TEXT,
    sucursal_id TEXT, branch_drive_url TEXT, issuance_date TEXT, expiration_date TEXT,
    drive_file_id TEXT, drive_file_url TEXT, sheet_timestamp TEXT UNIQUE, sheet_range TEXT,
    status TEXT NOT NULL DEFAULT 'DISCOVERED', processed INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_dictamenes_sha256 ON dictamenes_estructurales_archivos(sha256);`);
  db.exec(`UPDATE dictamenes_estructurales_archivos AS stale
    SET status='SUPERSEDED', processed=1, error=NULL, updated_at=datetime('now')
    WHERE processed=0 AND EXISTS (
      SELECT 1 FROM dictamenes_estructurales_archivos AS current
      WHERE current.id<>stale.id AND current.processed=1
        AND current.gmail_message_id=stale.gmail_message_id
        AND current.filename=stale.filename
    )`);
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function pdfParts(payload, output = []) {
  if (payload?.filename && /\.pdf$/i.test(payload.filename) && (payload.body?.attachmentId || payload.body?.data)) output.push(payload);
  for (const part of payload?.parts || []) pdfParts(part, output);
  return output;
}

async function ensureLabel(gmail, name) {
  const response = await gmail.users.labels.list({ userId: "me" });
  const existing = response.data.labels?.find((label) => label.name === name);
  if (existing) return existing.id;
  const created = await gmail.users.labels.create({ userId: "me", requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
  return created.data.id;
}

function folderId(url) {
  return String(url || "").match(/folders\/([\w-]+)/)?.[1] || String(url || "").match(/[?&]id=([\w-]+)/)?.[1] || "";
}

async function uploadToDrive(drive, folder, filename, buffer, sha256, messageId) {
  const escaped = filename.replace(/'/g, "\\'");
  const md5 = crypto.createHash("md5").update(buffer).digest("hex");
  const found = await drive.files.list({ q: `'${folder}' in parents and name = '${escaped}' and trashed = false`, fields: "files(id,name,webViewLink,appProperties,md5Checksum)", supportsAllDrives: true, includeItemsFromAllDrives: true });
  const existing = found.data.files?.find((file) => file.appProperties?.desarrolloegSha256 === sha256 || file.md5Checksum === md5);
  if (existing) return { id: existing.id, url: existing.webViewLink || `https://drive.google.com/file/d/${existing.id}/view` };
  const result = await drive.files.create({ requestBody: { name: filename, parents: [folder], appProperties: { desarrolloegSha256: sha256, gmailMessageId: messageId } }, media: { mimeType: "application/pdf", body: Readable.from(buffer) }, fields: "id,webViewLink", supportsAllDrives: true });
  return { id: result.data.id, url: result.data.webViewLink || `https://drive.google.com/file/d/${result.data.id}/view` };
}

async function sheetTitle(sheets, spreadsheetId, gid) {
  const response = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const sheet = response.data.sheets?.find((item) => item.properties?.sheetId === Number(gid));
  if (!sheet?.properties?.title) throw new Error(`No existe la hoja gid=${gid}`);
  return sheet.properties.title;
}

function header(message, name) {
  return message.payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function safeFilename(name) {
  return path.basename(String(name || "archivo.pdf")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

async function listCandidateMessages(gmail) {
  const messages = [];
  let pageToken;
  const limit = Math.max(1, Number(process.env.DICTAMENES_MAX_MESSAGES || 1000));
  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: `from:SGIIREGION1@casaley.com.mx has:attachment filename:pdf filename:DICTAMEN filename:ESTR after:2025/12/31 -label:"${PROCESSED_LABEL}"`,
      maxResults: Math.min(500, limit - messages.length),
      pageToken,
    });
    messages.push(...(response.data.messages || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken && messages.length < limit);
  return messages;
}

function incrementTimestamp(value) {
  const match = String(value).match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]) + 1));
  return formatTimestamp(date, "UTC");
}

export async function syncDictamenesEstructurales({ filenamePattern = null } = {}) {
  const db = openDesarrolloegSyncDb();
  if (!db) throw new Error("La base local no esta disponible");
  ensureTable(db);
  const auth = getDictamenesAuthClient();
  const gmail = google.gmail({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });
  const processedLabel = await ensureLabel(gmail, PROCESSED_LABEL);
  const errorLabel = await ensureLabel(gmail, ERROR_LABEL);
  const spreadsheetId = process.env.DICTAMENES_SHEET_ID || DEFAULT_SHEET_ID;
  const gid = Number(process.env.DICTAMENES_SHEET_GID || DEFAULT_SHEET_GID);
  let title = "";
  let sheetAccessError = null;
  try {
    title = await sheetTitle(sheets, spreadsheetId, gid);
  } catch (error) {
    sheetAccessError = error;
  }
  const branches = readLocalOperationalTable("SUCURSALES");
  const downloadDir = path.resolve(process.env.DICTAMENES_DOWNLOAD_DIR || "dictamenes-data");
  fs.mkdirSync(downloadDir, { recursive: true });
  let recovered = 0;
  if (!sheetAccessError) {
    const existingRows = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title.replace(/'/g, "''")}'!A:A` });
    const existingTimestamps = new Set((existingRows.data.values || []).map((row) => String(row[0] || "").trim()));
    const pending = db.prepare("SELECT * FROM dictamenes_estructurales_archivos WHERE processed=0 AND drive_file_url IS NOT NULL AND expiration_date IS NOT NULL AND tienda IS NOT NULL ORDER BY id").all();
    let previous = db.prepare("SELECT sheet_timestamp FROM dictamenes_estructurales_archivos WHERE sheet_timestamp IS NOT NULL ORDER BY id DESC LIMIT 1").get()?.sheet_timestamp;
    const toAppend = [];
    for (const record of pending) {
      let timestamp = record.sheet_timestamp || nextUniqueTimestamp(previous, new Date(), process.env.DICTAMENES_TIME_ZONE || "America/Chihuahua");
      while (existingTimestamps.has(timestamp) && timestamp !== record.sheet_timestamp) timestamp = incrementTimestamp(timestamp);
      db.prepare("UPDATE dictamenes_estructurales_archivos SET sheet_timestamp=? WHERE id=?").run(timestamp, record.id);
      if (!existingTimestamps.has(timestamp)) {
        toAppend.push({ record, timestamp, values: [timestamp, record.tienda, record.expiration_date, record.drive_file_url] });
        existingTimestamps.add(timestamp);
      } else {
        db.prepare("UPDATE dictamenes_estructurales_archivos SET status='COMPLETED',processed=1,error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), record.id);
        recovered += 1;
      }
      previous = timestamp;
    }
    if (toAppend.length > 0) {
      const appended = await sheets.spreadsheets.values.append({ spreadsheetId, range: `'${title.replace(/'/g, "''")}'!A:D`, valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: toAppend.map((item) => item.values) } });
      const updatedRange = appended.data.updates?.updatedRange || "";
      for (const item of toAppend) {
        db.prepare("UPDATE dictamenes_estructurales_archivos SET sheet_range=?,status='COMPLETED',processed=1,error=NULL,updated_at=? WHERE id=?").run(updatedRange, new Date().toISOString(), item.record.id);
        recovered += 1;
      }
    }
  }
  const candidates = await listCandidateMessages(gmail);
  const summary = { messages: candidates.length, recovered, completed: 0, duplicates: 0, errors: 0, ignored: 0 };
  for (const item of candidates) {
    const response = await gmail.users.messages.get({ userId: "me", id: item.id, format: "full" });
    const message = response.data;
    const parts = pdfParts(message.payload).filter((part) => {
      if (!isStructuralReportFilename(part.filename)) return false;
      return !filenamePattern || filenamePattern.test(part.filename);
    });
    if (!parts.length) { summary.ignored += 1; continue; }
    let allOk = true;
    for (const [partIndex, part] of parts.entries()) {
      const attachmentId = part.body.attachmentId || `inline-${crypto.createHash("sha1").update(part.body.data || "").digest("hex")}`;
      const key = `${message.id}:${normalizeText(part.filename)}:${partIndex}`;
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO dictamenes_estructurales_archivos (gmail_message_id,gmail_thread_id,gmail_attachment_id,attachment_key,filename,email_date,sender,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(attachment_key) DO UPDATE SET attempts=attempts+1,updated_at=excluded.updated_at`).run(message.id, message.threadId || "", attachmentId, key, part.filename, new Date(Number(message.internalDate)).toISOString(), header(message, "From"), now, now);
      const record = db.prepare("SELECT * FROM dictamenes_estructurales_archivos WHERE attachment_key=?").get(key);
      if (record.processed) { summary.duplicates += 1; continue; }
      try {
        const data = part.body.data || (await gmail.users.messages.attachments.get({ userId: "me", messageId: message.id, id: part.body.attachmentId })).data.data;
        const buffer = decodeBase64Url(data);
        const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
        const duplicate = db.prepare("SELECT id FROM dictamenes_estructurales_archivos WHERE sha256=? AND processed=1 LIMIT 1").get(sha256);
        if (duplicate) {
          db.prepare("UPDATE dictamenes_estructurales_archivos SET sha256=?,status='DUPLICATE',processed=1,error=NULL,updated_at=? WHERE id=?").run(sha256, now, record.id);
          summary.duplicates += 1; continue;
        }
        const localPath = path.join(downloadDir, `${message.id}_${safeFilename(part.filename)}`);
        fs.writeFileSync(localPath, buffer);
        const parsed = await pdfParse(buffer);
        const dates = extractDocumentDates(parsed.text, part.filename);
        if (!dates.expirationDate) throw new Error("No se encontro la fecha de vencimiento/expiracion");
        if (dates.issuanceDate && dates.issuanceDate.getUTCFullYear() < 2026) throw new Error("El dictamen es anterior a 2026");
        const branch = resolveBranch(part.filename, parsed.text, branches);
        if (!branch) throw new Error("No se pudo relacionar el dictamen con una sucursal local");
        const tienda = String(branch.TIENDA || branch.NUMERO || "").trim();
        const branchDrive = branch.DRIVE || branch.URL_DRIVE || branch.DRIVE_URL || "";
        const folder = folderId(branchDrive);
        if (!folder) throw new Error(`La sucursal ${tienda} no tiene una carpeta Drive valida`);
        const uploaded = await uploadToDrive(drive, folder, safeFilename(part.filename), buffer, sha256, message.id);
        db.prepare(`UPDATE dictamenes_estructurales_archivos SET sha256=?,local_path=?,tienda=?,sucursal_id=?,branch_drive_url=?,issuance_date=?,expiration_date=?,drive_file_id=?,drive_file_url=?,status='UPLOADED',error=NULL,updated_at=? WHERE id=?`).run(sha256, localPath, tienda, String(branch.ID || branch._ID || ""), branchDrive, dates.issuanceDate ? formatDate(dates.issuanceDate) : null, formatDate(dates.expirationDate), uploaded.id, uploaded.url, new Date().toISOString(), record.id);
        if (sheetAccessError) throw sheetAccessError;
        const existingRows = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title.replace(/'/g, "''")}'!A:A` });
        const existingTimestamps = new Set((existingRows.data.values || []).map((row) => String(row[0] || "").trim()));
        let timestamp = record.sheet_timestamp;
        if (!timestamp) {
          const previous = db.prepare("SELECT sheet_timestamp FROM dictamenes_estructurales_archivos WHERE sheet_timestamp IS NOT NULL ORDER BY id DESC LIMIT 1").get()?.sheet_timestamp;
          timestamp = nextUniqueTimestamp(previous, new Date(), process.env.DICTAMENES_TIME_ZONE || "America/Chihuahua");
          while (existingTimestamps.has(timestamp)) timestamp = incrementTimestamp(timestamp);
          db.prepare("UPDATE dictamenes_estructurales_archivos SET sheet_timestamp=? WHERE id=?").run(timestamp, record.id);
        }
        const alreadyInSheet = existingTimestamps.has(timestamp);
        let updatedRange = record.sheet_range || "";
        if (!alreadyInSheet) {
          const appended = await sheets.spreadsheets.values.append({ spreadsheetId, range: `'${title.replace(/'/g, "''")}'!A:D`, valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: [[timestamp, tienda, formatDate(dates.expirationDate), uploaded.url]] } });
          updatedRange = appended.data.updates?.updatedRange || "";
        }
        db.prepare(`UPDATE dictamenes_estructurales_archivos SET sheet_range=?,status='COMPLETED',processed=1,error=NULL,updated_at=? WHERE id=?`).run(updatedRange, new Date().toISOString(), record.id);
        summary.completed += 1;
      } catch (error) {
        allOk = false;
        summary.errors += 1;
        db.prepare("UPDATE dictamenes_estructurales_archivos SET status=CASE WHEN drive_file_id IS NOT NULL THEN 'UPLOADED_SHEET_ERROR' ELSE 'ERROR' END,error=?,updated_at=? WHERE id=?").run(error instanceof Error ? error.message : String(error), new Date().toISOString(), record.id);
      }
    }
    await gmail.users.messages.modify({ userId: "me", id: message.id, requestBody: { addLabelIds: [allOk ? processedLabel : errorLabel], removeLabelIds: allOk ? [errorLabel] : [] } });
  }
  return summary;
}
