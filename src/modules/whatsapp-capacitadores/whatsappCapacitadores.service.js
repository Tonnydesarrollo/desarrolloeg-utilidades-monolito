import fs from "fs";
import path from "path";
import readline from "readline";
import mime from "mime-types";
import qrcode from "qrcode-terminal";
import P from "pino";
import pkg from "whatsapp-web.js";
import { google } from "googleapis";

const { Client, LocalAuth } = pkg;
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

const serviceState = {
  enabled: false,
  status: "disabled",
  startedAt: null,
  readyAt: null,
  qrGeneratedAt: null,
  lastError: null,
  sessionDir: "",
  connected: false,
  startPromise: null,
};

const runtime = {
  config: null,
  logger: null,
  client: null,
  driveClientPromise: null,
  refreshTimer: null,
};

const menuContext = new Map();
const uploadContext = new Map();
const storePhotosContext = new Map();

const employeesCache = {
  ts: 0,
  phoneSet: new Set(),
  phoneToEmployeeKeys: new Map(),
  nameByKey: new Map(),
};

const sucursalesCache = {
  ts: 0,
  nameByKey: new Map(),
  keyByTienda: new Map(),
  driveByKey: new Map(),
};

function readEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return fallback;
}

function readBoolean(names, fallback = false) {
  const value = readEnv(names, "");
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readNumber(names, fallback) {
  const value = readEnv(names, "");
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDefaultChromePath() {
  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  return "/usr/bin/chromium";
}

function getConfig() {
  const sessionDir = readEnv(
    ["WHATSAPP_CAP_SESSION_DIR", "SESSION_DIR"],
    path.resolve(process.cwd(), "runtime", "whatsapp-capacitadores", "session")
  );
  const tmpDir = readEnv(
    ["WHATSAPP_CAP_TMP_DIR"],
    path.resolve(process.cwd(), "runtime", "whatsapp-capacitadores", "tmp")
  );
  const capacitacionesDateCol = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_DATE_COL", "CAPACITACIONES_DATE_COL"],
    "FECHA CAPACITACION"
  );
  const capacitacionesCapacitadoresCol = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_CAPACITADORES_COL", "CAPACITACIONES_CAPACITADORES_COL"],
    "CAPACITADORES"
  );
  const capacitacionesSucursalesCol = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_SUCURSALES_COL", "CAPACITACIONES_SUCURSALES_COL"],
    "SUCURSALES"
  );
  const capacitacionesCedeCol = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_CEDE_COL", "CAPACITACIONES_CEDE_COL"],
    "CEDE"
  );
  const capacitacionesFieldsRaw = readEnv(
    ["WHATSAPP_CAP_CAPACITACIONES_FIELDS", "CAPACITACIONES_FIELDS"],
    `${capacitacionesDateCol},${capacitacionesCedeCol},${capacitacionesSucursalesCol},${capacitacionesCapacitadoresCol}`
  );

  return {
    enabled: readBoolean(["WHATSAPP_CAP_ENABLED"], false),
    logLevel: readEnv(["WHATSAPP_CAP_LOG_LEVEL", "LOG_LEVEL"], "info"),
    botName: readEnv(["WHATSAPP_CAP_BOT_NAME", "BOT_NAME"], "Bot"),
    saveMedia: readBoolean(["WHATSAPP_CAP_SAVE_MEDIA", "SAVE_MEDIA"], false),
    allowedNumbers: splitList(readEnv(["WHATSAPP_CAP_ALLOWED_NUMBERS", "ALLOWED_NUMBERS"], "")).map(normalizePhone),
    sessionDir,
    tmpDir,
    chromePath: readEnv(
      ["WHATSAPP_CAP_CHROME_PATH", "CHROME_PATH"],
      getDefaultChromePath()
    ),
    keywordCapacitaciones: normalizeText(
      readEnv(["WHATSAPP_CAP_KEYWORD_CAPACITACIONES", "KEYWORD_CAPACITACIONES"], "CAPACITACIONES")
    ),
    keywordSubirImagenes: normalizeText(
      readEnv(
        ["WHATSAPP_CAP_KEYWORD_SUBIR_IMAGENES", "KEYWORD_SUBIR_IMAGENES"],
        "SUBIR IMAGENES DE CAPACITACION"
      )
    ),
    keywordReintentar: normalizeText(
      readEnv(["WHATSAPP_CAP_KEYWORD_REINTENTAR", "KEYWORD_REINTENTAR"], "REINTENTAR")
    ),
    menuWindowMinutes: readNumber(["WHATSAPP_CAP_MENU_WINDOW_MINUTES", "MENU_WINDOW_MINUTES"], 5),
    authRefreshMinutes: readNumber(["WHATSAPP_CAP_AUTH_REFRESH_MINUTES", "AUTH_REFRESH_MINUTES"], 30),
    notifyNumber: normalizePhone(readEnv(["WHATSAPP_CAP_NOTIFY_NUMBER", "NOTIFY_NUMBER"], "")),
    notifyMessage: readEnv(
      ["WHATSAPP_CAP_NOTIFY_MESSAGE", "NOTIFY_MESSAGE"],
      "Imagenes guardadas. Sucursal: {SUCURSAL}. Total: {TOTAL}"
    ),
    appsheetAppId: readEnv(["WHATSAPP_CAP_APPSHEET_APP_ID", "APPSHEET_APP_ID"], ""),
    appsheetAccessKey: readEnv(["WHATSAPP_CAP_APPSHEET_ACCESS_KEY", "APPSHEET_ACCESS_KEY"], ""),
    appsheetRegion: readEnv(["WHATSAPP_CAP_APPSHEET_REGION", "APPSHEET_REGION"], "www.appsheet.com"),
    appsheetLocale: readEnv(["WHATSAPP_CAP_APPSHEET_LOCALE", "APPSHEET_LOCALE"], "es-MX"),
    appsheetTimezone: readEnv(["WHATSAPP_CAP_APPSHEET_TIMEZONE", "APPSHEET_TIMEZONE"], "America/Mexico_City"),
    appsheetTableEmpleados: readEnv(["WHATSAPP_CAP_TABLE_EMPLEADOS", "APPSHEET_TABLE_EMPLEADOS"], "EMPLEADOS"),
    appsheetTableCapacitaciones: readEnv(
      ["WHATSAPP_CAP_TABLE_CAPACITACIONES", "APPSHEET_TABLE_CAPACITACIONES"],
      "CAPACITACIONES"
    ),
    appsheetTableSucursales: readEnv(["WHATSAPP_CAP_TABLE_SUCURSALES", "APPSHEET_TABLE_SUCURSALES"], "SUCURSALES"),
    empleadosKeyCol: readEnv(["WHATSAPP_CAP_EMPLEADOS_KEY_COL", "EMPLEADOS_KEY_COL"], "Row ID"),
    empleadosPhoneCol1: readEnv(["WHATSAPP_CAP_EMPLEADOS_PHONE_COL1", "EMPLEADOS_PHONE_COL1"], "TELEFONO"),
    empleadosPhoneCol2: readEnv(["WHATSAPP_CAP_EMPLEADOS_PHONE_COL2", "EMPLEADOS_PHONE_COL2"], "TELEFONO 2"),
    empleadosNameCol: readEnv(["WHATSAPP_CAP_EMPLEADOS_NAME_COL", "EMPLEADOS_NAME_COL"], "NOMBRE"),
    sucursalesKeyCol: readEnv(["WHATSAPP_CAP_SUCURSALES_KEY_COL", "SUCURSALES_KEY_COL"], "ID"),
    sucursalesTiendaCol: readEnv(["WHATSAPP_CAP_SUCURSALES_TIENDA_COL", "SUCURSALES_TIENDA_COL"], "TIENDA"),
    sucursalesNameCol: readEnv(["WHATSAPP_CAP_SUCURSALES_NAME_COL", "SUCURSALES_NAME_COL"], "NOMBRE"),
    sucursalesDriveCol: readEnv(["WHATSAPP_CAP_SUCURSALES_DRIVE_COL", "SUCURSALES_DRIVE_COL"], "DRIVE"),
    capacitacionesDateCol,
    capacitacionesCapacitadoresCol,
    capacitacionesSucursalesCol,
    capacitacionesCedeCol,
    capacitacionesFields: splitList(capacitacionesFieldsRaw),
    googleServiceAccountJson: readEnv(
      ["WHATSAPP_CAP_GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT_JSON"],
      ""
    ),
    googleOauthTokenPath: readEnv(
      ["WHATSAPP_CAP_GOOGLE_OAUTH_TOKEN_PATH", "GOOGLE_OAUTH_TOKEN_PATH"],
      path.resolve(process.cwd(), "runtime", "whatsapp-capacitadores", "token.json")
    ),
    driveFolderId: readEnv(["WHATSAPP_CAP_DRIVE_FOLDER_ID", "DRIVE_FOLDER_ID"], ""),
  };
}

function getLogger() {
  return runtime.logger || console;
}

function ensureRuntimeConfig() {
  if (!runtime.config) throw new Error("WhatsApp Capacitadores no esta configurado.");
  return runtime.config;
}

async function ensureTmpDir() {
  const config = ensureRuntimeConfig();
  await fs.promises.mkdir(config.tmpDir, { recursive: true });
  return config.tmpDir;
}

function getTextMessage(msg) {
  if (!msg) return "";
  return msg.body || "";
}

function setMenuContext(jid) {
  menuContext.set(jid, Date.now());
}

function hasMenuContext(jid) {
  const config = ensureRuntimeConfig();
  const ts = menuContext.get(jid) || 0;
  if (!ts) return false;
  return Date.now() - ts <= config.menuWindowMinutes * 60 * 1000;
}

async function appsheetFind({ table, selector }) {
  const config = ensureRuntimeConfig();
  if (!config.appsheetAppId) throw new Error("WHATSAPP_CAP_APPSHEET_APP_ID no configurado");
  if (!config.appsheetAccessKey) throw new Error("WHATSAPP_CAP_APPSHEET_ACCESS_KEY no configurado");

  const url = `https://${config.appsheetRegion}/api/v2/apps/${config.appsheetAppId}/tables/${encodeURIComponent(table)}/Action`;
  const body = {
    Action: "Find",
    Properties: {
      Locale: config.appsheetLocale,
      Timezone: config.appsheetTimezone,
    },
  };
  if (selector) body.Properties.Selector = selector;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ApplicationAccessKey: config.appsheetAccessKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AppSheet API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function loadEmployeesCache() {
  const config = ensureRuntimeConfig();
  const ttlMs = config.authRefreshMinutes * 60 * 1000;
  if (Date.now() - employeesCache.ts < ttlMs) return employeesCache;

  const data = await appsheetFind({
    table: config.appsheetTableEmpleados,
    selector: `Filter(${config.appsheetTableEmpleados}, true)`,
  });

  const rows = data.Rows || data;
  const phoneSet = new Set();
  const phoneToEmployeeKeys = new Map();
  const nameByKey = new Map();

  for (const row of rows || []) {
    const key = row[config.empleadosKeyCol];
    const phone1 = normalizePhone(row[config.empleadosPhoneCol1]);
    const phone2 = normalizePhone(row[config.empleadosPhoneCol2]);
    const name = row[config.empleadosNameCol];

    if (key && name) nameByKey.set(String(key), String(name));
    for (const phone of [phone1, phone2]) {
      if (!phone) continue;
      phoneSet.add(phone);
      const list = phoneToEmployeeKeys.get(phone) || [];
      if (key && !list.includes(key)) list.push(key);
      phoneToEmployeeKeys.set(phone, list);
    }
  }

  employeesCache.ts = Date.now();
  employeesCache.phoneSet = phoneSet;
  employeesCache.phoneToEmployeeKeys = phoneToEmployeeKeys;
  employeesCache.nameByKey = nameByKey;
  return employeesCache;
}

async function loadSucursalesCache() {
  const config = ensureRuntimeConfig();
  const ttlMs = 5 * 60 * 1000;
  if (Date.now() - sucursalesCache.ts < ttlMs) return sucursalesCache;

  const data = await appsheetFind({
    table: config.appsheetTableSucursales,
    selector: `Filter(${config.appsheetTableSucursales}, true)`,
  });

  const rows = data.Rows || data;
  const nameByKey = new Map();
  const keyByTienda = new Map();
  const driveByKey = new Map();

  for (const row of rows || []) {
    const key = row[config.sucursalesKeyCol];
    const name = row[config.sucursalesNameCol];
    const tienda = row[config.sucursalesTiendaCol];
    const drive = row[config.sucursalesDriveCol];
    if (key && name) nameByKey.set(String(key), String(name));
    if (tienda && key) keyByTienda.set(String(tienda).trim(), String(key));
    if (key && drive) driveByKey.set(String(key), String(drive).trim());
  }

  sucursalesCache.ts = Date.now();
  sucursalesCache.nameByKey = nameByKey;
  sucursalesCache.keyByTienda = keyByTienda;
  sucursalesCache.driveByKey = driveByKey;
  return sucursalesCache;
}

function extractDriveId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.includes("/")) return raw;

  const match = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function splitEnumList(value) {
  return splitList(value);
}

async function resolveNames(rows) {
  const config = ensureRuntimeConfig();
  const [employees, sucursales] = await Promise.all([loadEmployeesCache(), loadSucursalesCache()]);

  return rows.map((row) => {
    const copy = { ...row };
    const cedeKey = String(row[config.capacitacionesCedeCol] ?? "");
    if (cedeKey && sucursales.nameByKey.has(cedeKey)) {
      copy[config.capacitacionesCedeCol] = sucursales.nameByKey.get(cedeKey);
    }

    const sucursalesList = splitEnumList(row[config.capacitacionesSucursalesCol]);
    if (sucursalesList.length) {
      copy[config.capacitacionesSucursalesCol] = sucursalesList
        .map((item) => sucursales.nameByKey.get(item) || item)
        .join(", ");
    }

    const capacitadoresList = splitEnumList(row[config.capacitacionesCapacitadoresCol]);
    if (capacitadoresList.length) {
      copy[config.capacitacionesCapacitadoresCol] = capacitadoresList
        .map((item) => employees.nameByKey.get(item) || item)
        .join(", ");
    }

    return copy;
  });
}

function formatCapacitaciones(rows, fields) {
  const config = ensureRuntimeConfig();
  const selectedFields = fields || config.capacitacionesFields;

  return rows.map((row) => {
    const parts = selectedFields.map((field) => {
      if (field === config.capacitacionesDateCol) {
        const dateValue = new Date(row[field] || "");
        const formatted = Number.isNaN(dateValue.getTime())
          ? (row[field] ?? "")
          : dateValue.toLocaleDateString("es-MX");
        return `Fecha: ${formatted}`;
      }
      if (field === config.capacitacionesCedeCol) return `Cede: ${row[field] ?? ""}`;
      if (field === config.capacitacionesSucursalesCol) return `Sucursales: ${row[field] ?? ""}`;
      if (field === config.capacitacionesCapacitadoresCol) return `Capacitadores: ${row[field] ?? ""}`;
      return `${field}: ${row[field] ?? ""}`;
    });
    return `- ${parts.join(" | ")}`;
  }).join("\n");
}

function sortByDate(rows) {
  const config = ensureRuntimeConfig();
  return rows.sort((a, b) => {
    const aDate = new Date(a[config.capacitacionesDateCol] || 0);
    const bDate = new Date(b[config.capacitacionesDateCol] || 0);
    return aDate - bDate;
  });
}

async function loadOAuthClient(config, jsonPath) {
  const content = await fs.promises.readFile(jsonPath, "utf8");
  const credentials = JSON.parse(content);
  const { client_id: clientId, client_secret: clientSecret, redirect_uris: redirectUris } =
    credentials.installed || credentials.web || {};

  if (!clientId || !clientSecret || !redirectUris?.length) {
    throw new Error("Invalid OAuth client JSON");
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUris[0]);

  try {
    const token = await fs.promises.readFile(config.googleOauthTokenPath, "utf8");
    client.setCredentials(JSON.parse(token));
    return client;
  } catch {
    // continue
  }

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("Authorize this app by visiting this url:\n", authUrl);
  const code = await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Enter the code from that page here: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  await fs.promises.mkdir(path.dirname(config.googleOauthTokenPath), { recursive: true });
  await fs.promises.writeFile(config.googleOauthTokenPath, JSON.stringify(tokens), "utf8");
  return client;
}

async function buildDriveClient() {
  const config = ensureRuntimeConfig();
  if (!config.googleServiceAccountJson) {
    throw new Error("WHATSAPP_CAP_GOOGLE_SERVICE_ACCOUNT_JSON no configurado");
  }

  const jsonPath = path.resolve(config.googleServiceAccountJson);
  const raw = await fs.promises.readFile(jsonPath, "utf8");
  const credentials = JSON.parse(raw);

  let auth = null;
  if (credentials.client_email && credentials.private_key) {
    auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SCOPES,
    });
  } else if (credentials.installed || credentials.web) {
    auth = await loadOAuthClient(config, jsonPath);
  } else {
    throw new Error("Unsupported credentials format");
  }

  return google.drive({ version: "v3", auth });
}

async function getDriveClient() {
  if (!runtime.driveClientPromise) {
    runtime.driveClientPromise = buildDriveClient().catch((error) => {
      runtime.driveClientPromise = null;
      throw error;
    });
  }
  return runtime.driveClientPromise;
}

async function uploadToDrive(drive, filePath, fileName, folderId = "") {
  const config = ensureRuntimeConfig();
  const mimeType = mime.lookup(filePath) || "application/octet-stream";
  const requestBody = { name: fileName };
  const targetFolder = folderId || config.driveFolderId;
  if (targetFolder) requestBody.parents = [targetFolder];

  const response = await drive.files.create({
    requestBody,
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });

  return response.data;
}

async function ensureFolder(drive, name, parentId = "") {
  const safeName = name.replace(/'/g, "\\'");
  const parts = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${safeName}'`,
    "trashed=false",
  ];
  if (parentId) parts.push(`'${parentId}' in parents`);

  const list = await drive.files.list({
    q: parts.join(" and "),
    fields: "files(id,name,webViewLink)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if (list.data.files?.length) return list.data.files[0];

  const requestBody = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) requestBody.parents = [parentId];

  const response = await drive.files.create({
    requestBody,
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });
  return response.data;
}

function createFlowContext() {
  return {
    step: "store",
    storeKey: null,
    storeLabel: null,
    storeDrive: null,
    files: [],
    failedFiles: [],
    uploading: false,
    retrying: false,
    targetFolderId: "",
    targetFolderName: "",
    targetFolderLink: "",
  };
}

async function beginUploadFlow(jid, client) {
  uploadContext.set(jid, createFlowContext());
  await client.sendMessage(jid, "Escribe el numero de tienda.");
}

async function beginStorePhotosFlow(jid, client) {
  storePhotosContext.set(jid, createFlowContext());
  await client.sendMessage(jid, "Escribe el numero de tienda.");
}

async function resolveStore(map, jid, client, text) {
  const context = map.get(jid);
  if (!context || context.step !== "store") return false;

  const tienda = String(text || "").trim();
  if (!tienda) {
    await client.sendMessage(jid, "Numero de tienda invalido.");
    return true;
  }

  const sucursales = await loadSucursalesCache();
  const key = sucursales.keyByTienda.get(tienda);
  if (!key) {
    await client.sendMessage(jid, "Tienda no encontrada. Intenta de nuevo.");
    return true;
  }

  context.storeKey = key;
  context.storeLabel = sucursales.nameByKey.get(key) || key;
  context.storeDrive = sucursales.driveByKey.get(key) || "";
  context.step = "confirm";
  await client.sendMessage(jid, `Confirmas la sucursal: ${context.storeLabel}? (SI/NO)`);
  return true;
}

async function resolveFlowConfirmation(map, jid, client, text, collectMessage) {
  const context = map.get(jid);
  if (!context || context.step !== "confirm") return false;

  const normalized = normalizeText(text);
  if (normalized === "si" || normalized === "sí") {
    context.step = "collect";
    await client.sendMessage(jid, collectMessage);
    return true;
  }

  if (normalized === "no") {
    context.step = "store";
    context.storeKey = null;
    context.storeLabel = null;
    context.storeDrive = null;
    await client.sendMessage(jid, "Escribe el numero de tienda.");
    return true;
  }

  await client.sendMessage(jid, "Responde SI o NO.");
  return true;
}

async function saveIncomingMedia(msg, context) {
  if (!msg.hasMedia) return false;
  const media = await msg.downloadMedia();
  if (!media?.data) return false;

  const tmpDir = await ensureTmpDir();
  const extension = mime.extension(media.mimetype || "") || "jpg";
  const filename = `img_${Date.now()}.${extension}`;
  const localPath = path.join(tmpDir, filename);
  await fs.promises.writeFile(localPath, Buffer.from(media.data, "base64"));
  context.files.push(localPath);
  return true;
}

function clearFlowFiles(context) {
  return Promise.all(
    (context.files || []).map(async (filePath) => {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // ignore
      }
    })
  );
}

async function finalizeFlow(map, jid, client, options) {
  const config = ensureRuntimeConfig();
  const logger = getLogger();
  const context = map.get(jid);
  if (!context || context.step !== "collect") return false;

  if (context.uploading) {
    await client.sendMessage(jid, options.waitMessage);
    return true;
  }

  if (!context.files.length) {
    await client.sendMessage(jid, options.emptyMessage);
    return true;
  }

  let drive = null;
  try {
    drive = await getDriveClient();
  } catch (error) {
    logger.error(error, "Drive client error");
  }

  if (!drive) {
    await client.sendMessage(jid, "No hay credenciales de Drive configuradas.");
    return true;
  }

  const dateSafe = new Date().toISOString().slice(0, 10);
  const storeSafe = String(context.storeLabel || "").replace(/[^\w.\-]/g, "_");
  const parentFolderId = extractDriveId(context.storeDrive || "");
  const folderName = options.buildFolderName(context.storeLabel || "");

  let folder = null;
  try {
    folder = await ensureFolder(drive, folderName, parentFolderId);
  } catch (error) {
    logger.error(error, "ensure folder error");
    await client.sendMessage(jid, "No pude crear la carpeta en Drive. Revisa permisos.");
    return true;
  }

  context.uploading = true;
  const total = context.files.length;
  let uploaded = 0;
  const failed = [];

  for (const filePath of context.files) {
    if (!fs.existsSync(filePath)) {
      failed.push(filePath);
      continue;
    }

    const baseName = path.basename(filePath);
    const filename = options.buildFilename({ dateSafe, storeSafe, baseName });

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await uploadToDrive(drive, filePath, filename, folder.id);
        uploaded += 1;
        success = true;
        break;
      } catch (error) {
        logger.error({ attempt, filePath }, "Upload error");
      }
    }

    if (success) {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // ignore
      }
      continue;
    }

    failed.push(filePath);
  }

  context.files = [];
  context.uploading = false;
  context.targetFolderId = folder.id;
  context.targetFolderName = folderName;
  context.targetFolderLink = folder.webViewLink || "";

  if (failed.length) {
    context.failedFiles = failed;
    context.step = "retry";
    const names = failed.map((filePath) => path.basename(filePath)).slice(0, 10).join(", ");
    const extra = failed.length > 10 ? `, y ${failed.length - 10} mas` : "";
    await client.sendMessage(
      jid,
      `Listo. Subidas: ${uploaded}/${total}. Fallidas: ${failed.length}. ${names}${extra}\n` +
        `Puedes escribir "${config.keywordReintentar}" para reintentar las fallidas.`
    );
  } else {
    map.delete(jid);
    await client.sendMessage(jid, `Listo. Subidas: ${uploaded}/${total}`);
  }

  if (config.notifyNumber) {
    const message = config.notifyMessage
      .replace("{SUCURSAL}", String(context.storeLabel || ""))
      .replace("{CARPETA}", folderName)
      .replace("{LINK}", folder.webViewLink || "")
      .replace("{TOTAL}", String(uploaded));
    try {
      await client.sendMessage(`${config.notifyNumber}@c.us`, message);
    } catch (error) {
      logger.error(error, "notify error");
    }
  }

  return true;
}

async function retryFailedUploads(jid, client) {
  const logger = getLogger();
  const contexts = [uploadContext, storePhotosContext];
  const contextMap = contexts.find((map) => {
    const flow = map.get(jid);
    return flow && flow.step === "retry" && flow.failedFiles?.length;
  });
  if (!contextMap) return false;

  const context = contextMap.get(jid);
  if (context.retrying) return true;

  context.retrying = true;
  let drive = null;
  try {
    drive = await getDriveClient();
  } catch (error) {
    logger.error(error, "Drive client error");
  }

  if (!drive) {
    context.retrying = false;
    await client.sendMessage(jid, "No hay credenciales de Drive configuradas.");
    return true;
  }

  const total = context.failedFiles.length;
  let uploaded = 0;
  const failed = [];

  for (const filePath of context.failedFiles) {
    if (!fs.existsSync(filePath)) {
      failed.push(filePath);
      continue;
    }

    const filename = `${new Date().toISOString().slice(0, 10)}_${path.basename(filePath)}`.replace(/[^\w.\-]/g, "_");
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await uploadToDrive(drive, filePath, filename, context.targetFolderId || "");
        uploaded += 1;
        success = true;
        break;
      } catch (error) {
        logger.error({ attempt, filePath }, "Retry upload error");
      }
    }

    if (success) {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // ignore
      }
      continue;
    }

    failed.push(filePath);
  }

  context.retrying = false;
  context.failedFiles = failed;
  if (failed.length) {
    const names = failed.map((filePath) => path.basename(filePath)).slice(0, 10).join(", ");
    const extra = failed.length > 10 ? `, y ${failed.length - 10} mas` : "";
    await client.sendMessage(
      jid,
      `Reintento finalizado. Subidas: ${uploaded}/${total}. Fallidas: ${failed.length}. ${names}${extra}`
    );
  } else {
    contextMap.delete(jid);
    await client.sendMessage(jid, `Reintento finalizado. Subidas: ${uploaded}/${total}`);
  }

  return true;
}

async function handleImage(msg) {
  const config = ensureRuntimeConfig();
  const logger = getLogger();

  if (!config.saveMedia) {
    await msg.reply("Imagen recibida, pero guardar esta desactivado.");
    return;
  }

  if (!msg.hasMedia) {
    await msg.reply("No se pudo leer la imagen.");
    return;
  }

  const media = await msg.downloadMedia();
  if (!media?.data) {
    await msg.reply("No se pudo descargar la imagen.");
    return;
  }

  const tmpDir = await ensureTmpDir();
  const extension = mime.extension(media.mimetype || "") || "jpg";
  const filename = `img_${Date.now()}.${extension}`;
  const localPath = path.join(tmpDir, filename);
  await fs.promises.writeFile(localPath, Buffer.from(media.data, "base64"));

  let drive = null;
  try {
    drive = await getDriveClient();
  } catch (error) {
    logger.error(error, "Drive client error");
  }

  if (!drive) {
    await msg.reply("No hay credenciales de Drive configuradas.");
    return;
  }

  try {
    const result = await uploadToDrive(drive, localPath, filename);
    await msg.reply(`Imagen guardada en Drive. ID: ${result.id}`);
  } catch (error) {
    logger.error(error, "Upload error");
    await msg.reply("Error subiendo la imagen a Drive.");
  } finally {
    try {
      await fs.promises.unlink(localPath);
    } catch {
      // ignore
    }
  }
}

async function cancelFlow(jid, client) {
  for (const map of [uploadContext, storePhotosContext]) {
    const context = map.get(jid);
    if (!context) continue;
    await clearFlowFiles(context);
    map.delete(jid);
    await client.sendMessage(jid, "Proceso cancelado.");
    return true;
  }
  return false;
}

async function handleText(client, jid, text) {
  const config = ensureRuntimeConfig();
  const normalized = normalizeText(text);

  if (!normalized || normalized === "hola" || normalized === "hi" || normalized === "buenas") {
    await client.sendMessage(jid, `Hola. Soy ${config.botName}. Escribe "ayuda" para ver opciones.`);
    return;
  }

  if (normalized === "ayuda") {
    await client.sendMessage(
      jid,
      `Comandos:\n` +
        `- ayuda\n` +
        `- ${config.keywordCapacitaciones}\n` +
        `- ${config.keywordSubirImagenes}\n` +
        `- ${config.keywordReintentar}`
    );
    return;
  }

  if (normalized === config.keywordCapacitaciones) {
    setMenuContext(jid);
    await client.sendMessage(
      jid,
      "Menu:\n" +
        "1.- Mis capacitaciones\n" +
        "2.- Proximas capacitaciones\n" +
        "3.- Subir imagenes de capacitacion\n" +
        "4.- Subir fotos de la tienda"
    );
    return;
  }

  if ((normalized === "1" || normalized === "2" || normalized === "3" || normalized === "4") && !hasMenuContext(jid)) {
    await client.sendMessage(jid, `Escribe "${config.keywordCapacitaciones}" para ver el menu.`);
    return;
  }

  if (normalized === "cancelar") {
    const handled = await cancelFlow(jid, client);
    if (handled) return;
  }

  if (normalized === "listo") {
    const finalizedUpload = await finalizeFlow(uploadContext, jid, client, {
      waitMessage: "Estoy subiendo las imagenes, espera un momento.",
      emptyMessage: "No recibi imagenes. Envia imagenes o escribe \"CANCELAR\".",
      buildFolderName: (label) => `FOTOS CAPACITACION ${label}`.trim(),
      buildFilename: ({ dateSafe, storeSafe, baseName }) =>
        `${dateSafe}_${storeSafe}_capacitacion_${baseName}`.replace(/[^\w.\-]/g, "_"),
    });
    if (finalizedUpload) return;

    const finalizedStorePhotos = await finalizeFlow(storePhotosContext, jid, client, {
      waitMessage: "Estoy subiendo las fotos, espera un momento.",
      emptyMessage: "No recibi fotos. Envia fotos o escribe \"CANCELAR\".",
      buildFolderName: (label) => `FOTOS DE TIENDA ${label}`.trim(),
      buildFilename: ({ dateSafe, storeSafe, baseName }) =>
        `${dateSafe}_${storeSafe}_${baseName}`.replace(/[^\w.\-]/g, "_"),
    });
    if (finalizedStorePhotos) return;
  }

  if (normalized === config.keywordReintentar) {
    const retried = await retryFailedUploads(jid, client);
    if (retried) return;
  }

  const handledStore = await resolveStore(uploadContext, jid, client, normalized);
  if (handledStore) return;
  const handledStorePhotosStore = await resolveStore(storePhotosContext, jid, client, normalized);
  if (handledStorePhotosStore) return;

  const handledConfirm = await resolveFlowConfirmation(
    uploadContext,
    jid,
    client,
    normalized,
    "OK. Envia las imagenes de la capacitacion y escribe \"LISTO\" al terminar.\nSi quieres cancelar, escribe \"CANCELAR\"."
  );
  if (handledConfirm) return;

  const handledStorePhotosConfirm = await resolveFlowConfirmation(
    storePhotosContext,
    jid,
    client,
    normalized,
    "OK. Envia las fotos de la tienda y escribe \"LISTO\" al terminar.\nSi quieres cancelar, escribe \"CANCELAR\"."
  );
  if (handledStorePhotosConfirm) return;

  if (normalized === "1") {
    const number = normalizePhone(jid.split("@")[0]);
    const employees = await loadEmployeesCache();
    const keys = employees.phoneToEmployeeKeys.get(number) || [];
    if (!keys.length) {
      await client.sendMessage(jid, "No encontramos empleado para tu numero.");
      return;
    }

    const clauses = keys.map((key) => `IN("${key}", [${config.capacitacionesCapacitadoresCol}])`);
    const selector = `Filter(${config.appsheetTableCapacitaciones}, ${clauses.join(" OR ")})`;
    const data = await appsheetFind({
      table: config.appsheetTableCapacitaciones,
      selector,
    });

    const rows = data.Rows || data;
    if (!rows?.length) {
      await client.sendMessage(jid, "Sin capacitaciones asignadas.");
      return;
    }

    const ordered = sortByDate(await resolveNames(rows));
    const today = new Date();
    const finalizadas = ordered.filter((row) => new Date(row[config.capacitacionesDateCol] || 0) < today);
    const programadas = ordered.filter((row) => new Date(row[config.capacitacionesDateCol] || 0) >= today);

    const blocks = [];
    if (finalizadas.length) {
      blocks.push("FINALIZADAS");
      blocks.push(formatCapacitaciones(finalizadas));
    }
    if (programadas.length) {
      if (blocks.length) blocks.push("");
      blocks.push("PROGRAMADAS");
      blocks.push(formatCapacitaciones(programadas));
    }

    await client.sendMessage(jid, blocks.join("\n"));
    return;
  }

  if (normalized === "2") {
    const selector = `Filter(${config.appsheetTableCapacitaciones}, [${config.capacitacionesDateCol}] >= TODAY())`;
    const data = await appsheetFind({
      table: config.appsheetTableCapacitaciones,
      selector,
    });

    const rows = data.Rows || data;
    if (!rows?.length) {
      await client.sendMessage(jid, "Sin capacitaciones para mostrar.");
      return;
    }

    const ordered = sortByDate(await resolveNames(rows));
    const grouped = new Map();
    for (const row of ordered) {
      const names = splitEnumList(row[config.capacitacionesCapacitadoresCol]);
      if (!names.length) {
        grouped.set("SIN CAPACITADOR", [...(grouped.get("SIN CAPACITADOR") || []), row]);
        continue;
      }
      for (const name of names) {
        grouped.set(name, [...(grouped.get(name) || []), row]);
      }
    }

    const blocks = [];
    const minimalFields = [
      config.capacitacionesDateCol,
      config.capacitacionesCedeCol,
      config.capacitacionesSucursalesCol,
    ];
    for (const [name, items] of grouped.entries()) {
      if (blocks.length) blocks.push("");
      blocks.push(name.toUpperCase());
      blocks.push(formatCapacitaciones(items, minimalFields));
    }

    await client.sendMessage(jid, blocks.join("\n"));
    return;
  }

  if (normalized === "3" || normalized === config.keywordSubirImagenes) {
    await beginUploadFlow(jid, client);
    return;
  }

  if (normalized === "4") {
    await beginStorePhotosFlow(jid, client);
    return;
  }

  if (hasMenuContext(jid)) {
    await client.sendMessage(jid, `Comando no reconocido. Escribe "${config.keywordCapacitaciones}" o "ayuda".`);
  }
}

async function refreshAuthorizedNumbers() {
  const logger = getLogger();
  const employees = await loadEmployeesCache();
  logger.info({ count: employees.phoneSet.size }, "authorized numbers refreshed");
}

function scheduleAuthorizedNumbersRefresh() {
  const config = ensureRuntimeConfig();
  clearInterval(runtime.refreshTimer);
  runtime.refreshTimer = setInterval(() => {
    refreshAuthorizedNumbers().catch((error) => {
      getLogger().error(error, "authorized numbers refresh error");
    });
  }, config.authRefreshMinutes * 60 * 1000);
}

function markServiceError(error) {
  serviceState.status = "error";
  serviceState.connected = false;
  serviceState.lastError = error instanceof Error ? error.message : String(error);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeChromiumSingletonLocks(rootDir) {
  const targetNames = new Set(["SingletonCookie", "SingletonLock", "SingletonSocket"]);
  let removed = 0;

  function walk(currentDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!targetNames.has(entry.name)) continue;

      try {
        fs.rmSync(fullPath, { force: true });
        removed += 1;
      } catch {
        // Ignore stale lock cleanup errors and let Chromium report any real issue.
      }
    }
  }

  walk(rootDir);
  return removed;
}

function isRetryableInitializeError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("execution context was destroyed") ||
    normalized.includes("target closed") ||
    normalized.includes("session closed") ||
    normalized.includes("most likely because of a navigation") ||
    normalized.includes("profile appears to be in use") ||
    normalized.includes("process_singleton_posix") ||
    normalized.includes("chromium has locked the profile")
  );
}

function createWhatsAppClient(config) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.sessionDir }),
    puppeteer: {
      executablePath: config.chromePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  client.on("qr", (qr) => {
    serviceState.status = "awaiting_qr";
    serviceState.qrGeneratedAt = new Date().toISOString();
    qrcode.generate(qr, { small: true });
    runtime.logger.info("QR generado, escanear en WhatsApp");
  });

  client.on("ready", () => {
    serviceState.status = "ready";
    serviceState.connected = true;
    serviceState.readyAt = new Date().toISOString();
    runtime.logger.info("whatsapp connected");
  });

  client.on("auth_failure", (message) => {
    serviceState.status = "auth_failure";
    serviceState.connected = false;
    serviceState.lastError = String(message || "auth failure");
    runtime.logger.error({ message }, "auth failure");
  });

  client.on("disconnected", (reason) => {
    serviceState.status = "disconnected";
    serviceState.connected = false;
    serviceState.lastError = String(reason || "disconnected");
    runtime.logger.warn({ reason }, "connection closed");
  });

  client.on("message", async (msg) => {
    try {
      await handleIncomingMessage(msg);
    } catch (error) {
      runtime.logger.error(error, "incoming message error");
      markServiceError(error);
    }
  });

  return client;
}

async function destroyWhatsAppClient(client) {
  if (!client) return;

  try {
    await client.destroy();
  } catch (error) {
    getLogger().warn({ error }, "client destroy failed");
  }

  try {
    if (client.pupBrowser?.connected) {
      await client.pupBrowser.close();
    }
  } catch (error) {
    getLogger().warn({ error }, "browser close failed");
  }
}

async function handleIncomingMessage(msg) {
  const config = ensureRuntimeConfig();
  const logger = getLogger();

  if (!msg || msg.fromMe) return;
  const jid = msg.from;
  if (!jid || jid.includes("@g.us")) return;

  let resolvedNumber = jid.split("@")[0];
  if (jid.endsWith("@lid")) {
    try {
      const contact = await msg.getContact();
      if (contact?.number) resolvedNumber = contact.number;
      else if (contact?.id?._serialized) resolvedNumber = contact.id._serialized.split("@")[0];
    } catch (error) {
      logger.warn({ error, from: jid }, "failed to resolve @lid contact");
    }
  }

  const normalizedNumber = normalizePhone(resolvedNumber);
  const employees = await loadEmployeesCache().catch((error) => {
    logger.error(error, "employees cache error");
    return null;
  });

  const allowedByConfig = config.allowedNumbers.length === 0 || config.allowedNumbers.includes(normalizedNumber);
  const allowedByEmployees = employees ? employees.phoneSet.has(normalizedNumber) : false;
  if (!allowedByConfig || (!allowedByEmployees && config.allowedNumbers.length === 0)) {
    logger.warn({ from: jid, normalizedNumber }, "number not allowed");
    return;
  }

  if (msg.type === "image" || msg.hasMedia) {
    const uploadFlow = uploadContext.get(jid);
    if (uploadFlow?.step === "collect") {
      await saveIncomingMedia(msg, uploadFlow);
      return;
    }

    const storeFlow = storePhotosContext.get(jid);
    if (storeFlow?.step === "collect") {
      await saveIncomingMedia(msg, storeFlow);
      return;
    }

    await handleImage(msg);
    return;
  }

  const text = getTextMessage(msg);
  if (text) await handleText(runtime.client, jid, text);
}

async function bootWhatsAppService(config) {
  runtime.config = config;
  runtime.logger = P({ level: config.logLevel });

  fs.mkdirSync(config.sessionDir, { recursive: true });
  fs.mkdirSync(config.tmpDir, { recursive: true });

  serviceState.enabled = true;
  serviceState.status = "starting";
  serviceState.startedAt = new Date().toISOString();
  serviceState.readyAt = null;
  serviceState.qrGeneratedAt = null;
  serviceState.connected = false;
  serviceState.sessionDir = config.sessionDir;
  serviceState.lastError = null;

  try {
    await getDriveClient();
    runtime.logger.info("drive auth ready");
  } catch (error) {
    runtime.logger.error(error, "drive auth error");
  }

  await refreshAuthorizedNumbers();
  scheduleAuthorizedNumbersRefresh();

  const maxInitializeAttempts = 3;

  for (let attempt = 1; attempt <= maxInitializeAttempts; attempt += 1) {
    const removedLocks = removeChromiumSingletonLocks(config.sessionDir);
    if (removedLocks > 0) {
      runtime.logger.warn({ attempt, removedLocks }, "removed stale chromium singleton locks");
    }

    const client = createWhatsAppClient(config);
    runtime.client = client;

    try {
      await client.initialize();
      return serviceState;
    } catch (error) {
      const retryable = attempt < maxInitializeAttempts && isRetryableInitializeError(error);
      runtime.logger.error(
        {
          attempt,
          retryable,
          error: error instanceof Error ? error.message : String(error),
        },
        "whatsapp initialize failed"
      );
      await destroyWhatsAppClient(client);
      runtime.client = null;

      if (!retryable) {
        throw error;
      }

      serviceState.status = "restarting";
      serviceState.connected = false;
      serviceState.lastError = error instanceof Error ? error.message : String(error);
      await wait(1500 * attempt);
    }
  }

  return serviceState;
}

export function getWhatsAppCapacitadoresStatus() {
  const config = runtime.config || getConfig();
  const enabled = config.enabled;
  const sessionDir = serviceState.sessionDir || config.sessionDir;
  const status =
    enabled && !serviceState.startedAt && !serviceState.startPromise && serviceState.status === "disabled"
      ? "idle"
      : serviceState.status;

  return {
    enabled,
    status,
    startedAt: serviceState.startedAt,
    readyAt: serviceState.readyAt,
    qrGeneratedAt: serviceState.qrGeneratedAt,
    lastError: serviceState.lastError,
    sessionDir,
    connected: serviceState.connected,
  };
}

export async function getWhatsAppCapacitadoresQrScreenshot() {
  if (serviceState.status !== "awaiting_qr") return null;

  const page = runtime.client?.pupPage;
  if (!page) return null;

  try {
    return await page.screenshot({ type: "png", fullPage: true });
  } catch (error) {
    getLogger().warn({ error }, "qr screenshot failed");
    return null;
  }
}

export async function startWhatsAppCapacitadoresService() {
  const config = getConfig();
  serviceState.enabled = config.enabled;
  serviceState.sessionDir = config.sessionDir;

  if (!config.enabled) {
    serviceState.status = "disabled";
    return getWhatsAppCapacitadoresStatus();
  }

  if (serviceState.startPromise) return serviceState.startPromise;

  serviceState.startPromise = bootWhatsAppService(config).catch((error) => {
    markServiceError(error);
    serviceState.startPromise = null;
    throw error;
  });

  return serviceState.startPromise;
}
