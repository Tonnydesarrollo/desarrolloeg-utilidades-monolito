/**
 * PEDIDOS / LIBERACIONES desde Gmail -> Drive -> AppSheet
 * - Evita duplicados por contenido del PDF
 * - Busca primero por PEDIDO / LIBERACION antes de hacer upsert
 * - Usa PEDIDO / LIBERACION como llave de AppSheet
 * - Etiqueta hilos procesados
 */

const MAX_THREADS_PER_RUN = 20;
const PROCESSED_MARKER_PREFIX = "pedidos_liberaciones_processed_";
const DRIVE_FILE_MARKER_PREFIX = "pedidos_liberaciones_drive_";

const CONFIG = {
  SENDERS: [
    "SGIIREGION1@casaley.com.mx",
    "desarrolloeg@gmail.com",
    "lorenzo.osuna@casaley.com.mx",
  ],
  START_DATE: "2024/01/01",
  END_DATE: getToday_(),
  LABEL_NAME: "Procesado/PedidosLiberaciones",
  DRIVE_PEDIDOS_FOLDER_ID: "1TTe2q6bk60KtQOQOu13h1S4M6x9f8bDZ",
  DRIVE_LIBERACIONES_FOLDER_ID: "1JbFmyBwX3GBPuIYqSIVc7EdCiM70V_tP",
  APPSHEET_APP_ID: "d1bf6ffb-7f5b-4a94-8198-340d6b074f7d",
  APPSHEET_API_KEY: "V2-EaYKt-y6K6D-bDrGb-mI02u-mRduW-B0jPk-r2Sil-rHay7",
  TABLE_PEDIDOS: "PEDIDOS_LEY",
  TABLE_LIBERACIONES: "LIBERACIONES",
  KEY_PEDIDOS: "PEDIDO",
  KEY_LIBERACIONES: "LIBERACION",
};

function getToday_() {
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(new Date(), tz, "yyyy/MM/dd");
}

function buildQuery_() {
  const from = CONFIG.SENDERS.length === 1
    ? `from:${CONFIG.SENDERS[0]}`
    : `from:(${CONFIG.SENDERS.join(" OR ")})`;

  return `${from} has:attachment filename:pdf after:${CONFIG.START_DATE} before:${addOneDay_(CONFIG.END_DATE)} -label:${CONFIG.LABEL_NAME}`;
}

function addOneDay_(dateStr) {
  const parts = String(dateStr || "").split("/").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy/MM/dd");
}

function getOrCreateLabel_(name) {
  const labels = GmailApp.getUserLabels();
  const existing = labels.find((label) => label.getName() === name);
  return existing || GmailApp.createLabel(name);
}

function hasLabel_(thread, labelName) {
  return thread.getLabels().some((label) => label.getName() === labelName);
}

function normalizeText_(value) {
  return String(value || "").trim();
}

function normalizeRecipients_(value) {
  return String(value || "")
    .split(",")
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function getTipoPorNombre_(filename) {
  const name = String(filename || "").replace(/\.pdf$/i, "").trim();
  if (name.match(/6\d{9}/g)) return "PEDIDOS";
  if (name.match(/5\d{9}/g)) return "LIBERACIONES";
  return null;
}

function getKeyFromFilename_(filename, regex) {
  const name = String(filename || "").replace(/\.pdf$/i, "").trim();
  const matches = name.match(regex);
  if (!matches || !matches.length) return "";
  return String(matches[matches.length - 1] || "").trim();
}

function hashBytes_(bytes) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, "");
}

function processedMarkerKey_(digest) {
  return PROCESSED_MARKER_PREFIX + digest;
}

function driveMarkerKey_(digest) {
  return DRIVE_FILE_MARKER_PREFIX + digest;
}

function getProcessedMarker_(digest) {
  return PropertiesService.getScriptProperties().getProperty(processedMarkerKey_(digest));
}

function setProcessedMarker_(digest, payload) {
  PropertiesService.getScriptProperties().setProperty(processedMarkerKey_(digest), JSON.stringify(payload || {}));
}

function getCachedDriveFileId_(digest) {
  return PropertiesService.getScriptProperties().getProperty(driveMarkerKey_(digest));
}

function setCachedDriveFileId_(digest, fileId) {
  PropertiesService.getScriptProperties().setProperty(driveMarkerKey_(digest), String(fileId || "").trim());
}

function getOrCreateDriveFile_(folderId, blob, filename, digest) {
  const cachedFileId = getCachedDriveFileId_(digest);
  if (cachedFileId) {
    try {
      return DriveApp.getFileById(cachedFileId);
    } catch (error) {
      // Si el archivo fue borrado, seguimos y recreamos.
    }
  }

  const folder = DriveApp.getFolderById(folderId);
  const existing = folder.getFilesByName(filename);
  if (existing.hasNext()) {
    const file = existing.next();
    setCachedDriveFileId_(digest, file.getId());
    return file;
  }

  const file = folder.createFile(blob).setName(filename);
  setCachedDriveFileId_(digest, file.getId());
  return file;
}

function appsheetAction_(table, action, rows) {
  const url = "https://api.appsheet.com/api/v2/apps/" +
    CONFIG.APPSHEET_APP_ID +
    "/tables/" + encodeURIComponent(table) +
    "/Action";

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      "ApplicationAccessKey": CONFIG.APPSHEET_API_KEY,
    },
    payload: JSON.stringify({
      Action: action,
      Properties: {
        Locale: "es-MX",
        Timezone: "America/Mexico_City",
      },
      Rows: rows,
    }),
    muteHttpExceptions: true,
  });

  return {
    ok: response.getResponseCode() >= 200 && response.getResponseCode() < 300,
    code: response.getResponseCode(),
    body: response.getContentText(),
  };
}

function appsheetFindRows_(table, selector) {
  const url = "https://api.appsheet.com/api/v2/apps/" +
    CONFIG.APPSHEET_APP_ID +
    "/tables/" + encodeURIComponent(table) +
    "/Action";

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      "ApplicationAccessKey": CONFIG.APPSHEET_API_KEY,
    },
    payload: JSON.stringify({
      Action: "Find",
      Properties: {
        Locale: "es-MX",
        Timezone: "America/Mexico_City",
        Selector: selector,
      },
      Rows: [],
    }),
    muteHttpExceptions: true,
  });

  const text = response.getContentText() || "";
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`AppSheet Find fallo (${table}): ${response.getResponseCode()} ${text}`);
  }

  if (!text.trim()) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.Rows || parsed.rows || []);
}

function escapeSelectorValue_(value) {
  return String(value || "").replace(/"/g, '\\"');
}

function findExistingRowByBusinessKey_(table, businessKeyField, businessKeyValue) {
  const selector = `Filter(${table}, [${businessKeyField}]="${escapeSelectorValue_(businessKeyValue)}")`;
  const rows = appsheetFindRows_(table, selector);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function buildUpsertRow_(businessKeyField, businessKeyValue, pdfUrl) {
  return {
    [businessKeyField]: businessKeyValue,
    PDF: pdfUrl,
  };
}

function upsertAppSheetRow_(table, row, existingRow, lookupField, lookupValue) {
  if (existingRow) {
    const edit = appsheetAction_(table, "Edit", [row]);
    if (edit.ok) {
      return { action: "Edit", result: edit };
    }
    throw new Error(`No se pudo actualizar ${table} (${lookupField}=${lookupValue}). Edit(${edit.code}): ${edit.body}`);
  }

  const add = appsheetAction_(table, "Add", [row]);
  if (add.ok) {
    return { action: "Add", result: add };
  }

  throw new Error(`No se pudo crear en ${table} (${lookupField}=${lookupValue}). Add(${add.code}): ${add.body}`);
}

function recordProcessed_({ digest, kind, businessKey, threadId, messageId, filename, pdfUrl, rowId }) {
  setProcessedMarker_(digest, {
    kind: kind,
    businessKey: businessKey,
    threadId: threadId,
    messageId: messageId,
    filename: filename,
    pdfUrl: pdfUrl,
    rowId: rowId,
    processedAt: new Date().toISOString(),
  });
}

function processAttachment_(threadId, messageId, attachment, pdfIndex, resumeState) {
  const filename = String(attachment.getName() || "").trim();
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return { done: false, reason: "not_pdf" };
  }

  const bytes = attachment.copyBlob().getBytes();
  const digest = hashBytes_(bytes);
  const processed = getProcessedMarker_(digest);
  if (processed) {
    return { done: true, skipped: true, reason: "already_processed", digest: digest };
  }

  const tipo = getTipoPorNombre_(filename);
  if (!tipo) {
    return { done: false, reason: "tipo_no_reconocido" };
  }

  const folderId = tipo === "PEDIDOS"
    ? CONFIG.DRIVE_PEDIDOS_FOLDER_ID
    : CONFIG.DRIVE_LIBERACIONES_FOLDER_ID;

  const driveFile = getOrCreateDriveFile_(folderId, attachment.copyBlob(), filename, digest);
  const pdfUrl = driveFile.getUrl();

  if (tipo === "PEDIDOS") {
    const pedido = getKeyFromFilename_(filename, /6\d{9}/g);
    if (!pedido) {
      return { done: false, reason: "sin_pedido" };
    }

    const existing = findExistingRowByBusinessKey_(CONFIG.TABLE_PEDIDOS, CONFIG.KEY_PEDIDOS, pedido);
    const row = buildUpsertRow_(CONFIG.KEY_PEDIDOS, pedido, pdfUrl);
    const result = upsertAppSheetRow_(CONFIG.TABLE_PEDIDOS, row, existing, CONFIG.KEY_PEDIDOS, pedido);
    recordProcessed_({
      digest: digest,
      kind: "PEDIDOS",
      businessKey: pedido,
      threadId: threadId,
      messageId: messageId,
      filename: filename,
      pdfUrl: pdfUrl,
      rowId: pedido,
    });
    return { done: true, kind: "PEDIDOS", businessKey: pedido, action: result.action };
  }

  if (tipo === "LIBERACIONES") {
    const liberacion = getKeyFromFilename_(filename, /5\d{9}/g);
    if (!liberacion) {
      return { done: false, reason: "sin_liberacion" };
    }

    const existing = findExistingRowByBusinessKey_(CONFIG.TABLE_LIBERACIONES, CONFIG.KEY_LIBERACIONES, liberacion);
    const row = buildUpsertRow_(CONFIG.KEY_LIBERACIONES, liberacion, pdfUrl);
    const result = upsertAppSheetRow_(CONFIG.TABLE_LIBERACIONES, row, existing, CONFIG.KEY_LIBERACIONES, liberacion);
    recordProcessed_({
      digest: digest,
      kind: "LIBERACIONES",
      businessKey: liberacion,
      threadId: threadId,
      messageId: messageId,
      filename: filename,
      pdfUrl: pdfUrl,
      rowId: liberacion,
    });
    return { done: true, kind: "LIBERACIONES", businessKey: liberacion, action: result.action };
  }

  return { done: false, reason: "tipo_desconocido" };
}

function runPedidosLiberaciones() {
  const label = getOrCreateLabel_(CONFIG.LABEL_NAME);
  const query = buildQuery_();
  const threads = GmailApp.search(query, 0, MAX_THREADS_PER_RUN);

  Logger.log("Threads encontrados: %s", threads.length);

  threads.forEach((thread) => {
    if (hasLabel_(thread, CONFIG.LABEL_NAME)) return;

    const threadId = thread.getId();
    const messages = thread.getMessages();
    const checkpoint = getCheckpoint_(threadId);
    let resume = !checkpoint;
    let completedAll = true;

    messagesLoop:
    for (let mi = 0; mi < messages.length; mi += 1) {
      const msg = messages[mi];
      const msgId = msg.getId();
      const attachments = msg.getAttachments({ includeInlineImages: false });
      const pdfs = attachments.filter((attachment) => String(attachment.getName() || "").toLowerCase().endsWith(".pdf"));

      if (!pdfs.length) continue;

      for (let pi = 0; pi < pdfs.length; pi += 1) {
        if (!resume) {
          if (checkpoint && checkpoint.messageId === msgId && checkpoint.pdfIndex === pi) {
            resume = true;
          } else {
            continue;
          }
        }

        const file = pdfs[pi];
        try {
          const result = processAttachment_(threadId, msgId, file, pi, checkpoint);
          if (result.done && !result.skipped) {
            Logger.log("Procesado %s (%s) -> %s:%s", file.getName(), result.kind, result.businessKey, result.action);
          } else {
            Logger.log("Omitido %s -> %s", file.getName(), result.reason || "sin_cambio");
          }
        } catch (error) {
          Logger.log("Error procesando %s: %s", file.getName(), error && error.message ? error.message : error);
          // Conserva el PDF fallido para reintentarlo en la siguiente ejecución.
          setCheckpoint_(threadId, msgId, pi);
          completedAll = false;
          break messagesLoop;
        }

        setCheckpoint_(threadId, msgId, pi + 1);
      }
    }

    if (completedAll) {
      thread.addLabel(label);
      clearCheckpoint_(threadId);
      Logger.log("Thread completado y etiquetado: %s", threadId);
    } else {
      Logger.log("Thread no completado, checkpoint guardado: %s", threadId);
    }
  });
}

function getCheckpoint_(threadId) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("checkpoint_" + threadId);
  return raw ? JSON.parse(raw) : null;
}

function setCheckpoint_(threadId, messageId, pdfIndex) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("checkpoint_" + threadId, JSON.stringify({
    messageId: messageId,
    pdfIndex: pdfIndex,
  }));
}

function clearCheckpoint_(threadId) {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("checkpoint_" + threadId);
}
