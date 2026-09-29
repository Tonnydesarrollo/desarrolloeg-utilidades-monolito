import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "/app/runtime/jobs/pedidos-local.sqlite";
const DB_RETRY_DELAY_MS = 15000;
const FALLBACK_DB_NAMES = [
  "pedidos-local-working.sqlite",
  "pedidos-local-copy.sqlite",
  "pedidos-local-copy2.sqlite",
];
let cachedDb = null;
let cachedDbPath = null;
let schemaInitialized = false;
let localDbUnavailable = false;
let localDbRetryAt = 0;
let localDbLastError = null;
let flagSchemaInitialized = false;
const FACTURAS_SYNC_STATE_KEY = "cfdis";

function resolveDbPath() {
  const configured = String(process.env.DESARROLLOEG_LOCAL_DB_PATH || "").trim();
  if (configured) return configured;
  return DEFAULT_DB_PATH;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function uniquePaths(paths) {
  return [...new Set(paths.filter((value) => value && String(value).trim() !== "").map((value) => String(value).trim()))];
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseLocalDateKey(value) {
  const raw = text(value);
  if (!raw) return "";
  const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) return `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`;
  const slashMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) year += 2000;
    const day = first > 12 && second <= 12 ? first : second;
    const month = first > 12 && second <= 12 ? second : first;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function deriveCapacitacionStatus(value) {
  const fechaKey = parseLocalDateKey(value);
  if (!fechaKey) return "";
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return todayKey > fechaKey ? "FINALIZADA" : "PROGRAMADA";
}

function resolveDbCandidates() {
  const configured = String(process.env.DESARROLLOEG_LOCAL_DB_PATH || "").trim();
  const projectRuntimeDir = path.resolve(process.cwd(), "runtime", "jobs");
  const projectDbPath = path.join(projectRuntimeDir, "pedidos-local.sqlite");
  const primary = configured || (process.platform === "win32" ? projectDbPath : DEFAULT_DB_PATH);
  const candidates = [primary];
  const baseDir = path.dirname(primary);
  for (const fallbackName of FALLBACK_DB_NAMES) {
    candidates.push(path.join(baseDir, fallbackName));
  }
  candidates.push(projectDbPath, DEFAULT_DB_PATH);
  for (const fallbackName of FALLBACK_DB_NAMES) {
    candidates.push(path.join(projectRuntimeDir, fallbackName));
  }
  return uniquePaths(candidates);
}

function isRetryWindowOpen() {
  if (!localDbUnavailable) return true;
  if (Date.now() >= localDbRetryAt) {
    localDbUnavailable = false;
    localDbRetryAt = 0;
    localDbLastError = null;
    return true;
  }
  return false;
}

function markDbUnavailable(error, label = "SQLite local no disponible") {
  localDbUnavailable = true;
  localDbRetryAt = Date.now() + DB_RETRY_DELAY_MS;
  localDbLastError = error || null;
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch {
      // Si el cierre falla, seguimos descartando la referencia.
    }
    cachedDb = null;
  }
  console.warn(`[localAppsheetDb] ${label}: ${error?.message || error}`);
}

function closeCachedDb() {
  if (!cachedDb) return;
  try {
    cachedDb.close();
  } catch {
    // Si el cierre falla, descartamos la referencia de todas formas.
  }
  cachedDb = null;
  cachedDbPath = null;
}

function probeDb(db) {
  db.prepare("SELECT 1 AS ok").get();
  db.prepare("PRAGMA user_version;").get();
  return true;
}

function openCandidateDb(dbPath) {
  ensureDir(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = OFF;");
  } catch {
    // No es critico para la capa de flags locales.
  }
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    // Algunos volÃºmenes montados no aceptan cambiar el modo de journal.
  }
  try {
    db.exec("PRAGMA synchronous = NORMAL;");
  } catch {
    // Si el motor no lo permite, seguimos con el valor por defecto.
  }
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch {
    // No es crÃ­tico para la capa de flags locales.
  }
  probeDb(db);
  return db;
}

function getDb() {
  if (!isRetryWindowOpen()) return null;
  if (cachedDb) return cachedDb;

  let lastError = null;
  const candidates = resolveDbCandidates();
  for (const dbPath of candidates) {
    try {
      cachedDb = openCandidateDb(dbPath);
      cachedDbPath = dbPath;
      localDbUnavailable = false;
      localDbRetryAt = 0;
      localDbLastError = null;
      if (dbPath !== candidates[0]) {
        console.warn(`[localAppsheetDb] SQLite local usando respaldo: ${dbPath}`);
      }
      return cachedDb;
    } catch (error) {
      lastError = error;
      closeCachedDb();
    }
  }

  markDbUnavailable(lastError || new Error("No hay candidatos SQLite disponibles"));
  return null;
}

function initSchema() {
  if (schemaInitialized) return;
  const db = getDb();
  if (!db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pedidos_ley (
        pedido TEXT PRIMARY KEY,
        tienda TEXT,
        establecimiento TEXT,
        proveedor TEXT,
        fecha TEXT,
        importe REAL,
        descripcion TEXT,
        pdf TEXT,
        enviado TEXT,
        liberacion TEXT,
        pago TEXT,
        factura_en_ley TEXT,
        folio_clubfactura TEXT,
        cheque TEXT,
        status TEXT,
        facturador TEXT,
        uuid TEXT,
        ultimo_pipc_estatal REAL,
        ultimo_municipal REAL,
        descripcion_complementaria TEXT,
        pdf_extraido INTEGER NOT NULL DEFAULT 0,
        pdf_extraido_fecha TEXT,
        pdf_extraido_error TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS liberaciones (
        liberacion TEXT PRIMARY KEY,
        num_pedido TEXT,
        fecha TEXT,
        pdf TEXT,
        pdf_extraido INTEGER NOT NULL DEFAULT 0,
        pdf_extraido_fecha TEXT,
        pdf_extraido_error TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS cfdis (
        id TEXT PRIMARY KEY,
        serie_folio TEXT,
        fecha TEXT,
        rfc TEXT,
        importe REAL,
        tipo_desc TEXT,
        estatus_pago_desc TEXT,
        fecha_pago_cobro TEXT,
        xml TEXT,
        pdf TEXT,
        proveedor TEXT,
        pedido TEXT,
        uuid TEXT,
        pdf_extraido INTEGER NOT NULL DEFAULT 0,
        pdf_extraido_fecha TEXT,
        pdf_extraido_error TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS cheques_ley (
        referencia_pago TEXT PRIMARY KEY,
        documento_pago TEXT,
        forma_pago TEXT,
        fecha_pago TEXT,
        fecha_cobro TEXT,
        fecha_de_carga TEXT,
        operacion TEXT,
        moneda TEXT,
        tipo_de_cambio REAL,
        importe REAL,
        emisor TEXT,
        cuenta_banco TEXT,
        receptor TEXT,
        proveedor TEXT,
        cuenta_receptora TEXT,
        uuid_de_pago TEXT,
        doctos_relacionados TEXT,
        cobrado TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS pagados_ley (
        referencia TEXT PRIMARY KEY,
        referencia_pago TEXT NOT NULL,
        clase_docto TEXT,
        uuid TEXT,
        imp_pagado REAL,
        tipo_docto TEXT,
        factura TEXT,
        asignacion TEXT,
        tienda TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS facturas_en_ley (
        folio_uuid TEXT PRIMARY KEY,
        emisor TEXT,
        receptor TEXT,
        serie TEXT,
        folio TEXT,
        fecha_factura TEXT,
        fecha_registro TEXT,
        importe REAL,
        iva REAL,
        total REAL,
        estatus TEXT,
        proveedor_sec TEXT,
        num_ent TEXT,
        tienda TEXT,
        no_remision TEXT,
        razon_social TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS empresas (
        id TEXT PRIMARY KEY,
        row_id TEXT,
        razon_social TEXT,
        nombre_comercial TEXT,
        logo TEXT,
        logo_url TEXT,
        rfc TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS municipios (
        id TEXT PRIMARY KEY,
        nombre TEXT,
        escudo TEXT,
        encargado_pc TEXT,
        puesto TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS estados (
        id TEXT PRIMARY KEY,
        nombre TEXT,
        escudo TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sucursales (
        id TEXT PRIMARY KEY,
        row_id TEXT,
        tienda TEXT,
        label TEXT,
        label2 TEXT,
        nombre TEXT,
        domicilio TEXT,
        address TEXT,
        street TEXT,
        municipio_id TEXT,
        municipio_nombre TEXT,
        estado_id TEXT,
        estado_nombre TEXT,
        empresa_id TEXT,
        empresa_nombre TEXT,
        lat REAL,
        lng REAL,
        id_pc TEXT,
        mes_planeacion INTEGER,
        capacitadores TEXT,
        assigned_month INTEGER,
        vencimiento_estatal TEXT,
        vencimiento_municipal TEXT,
        trabajos TEXT,
        tipo TEXT,
        nivel_riesgo TEXT,
        precio_estatal REAL,
        precio_municipal REAL,
        ultimo_pipc_estatal TEXT,
        ultimo_municipal TEXT,
        pedido TEXT,
        planeacion_status TEXT,
        planeacion_tone TEXT,
        drive TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS empleados (
        row_id TEXT PRIMARY KEY,
        id TEXT,
        nombre TEXT,
        iniciales TEXT,
        color TEXT,
        puesto TEXT,
        correo TEXT,
        capacita TEXT,
        permiso TEXT,
        firma TEXT,
        cumpleanos TEXT,
        telefono TEXT,
        telefono_2 TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS capacitaciones (
        row_id TEXT PRIMARY KEY,
        id TEXT,
        fecha_capacitacion TEXT,
        hora_inicio TEXT,
        hora_fin TEXT,
        cede_sucursal_id TEXT,
        cede TEXT,
        sucursales TEXT,
        capacitadores TEXT,
        status TEXT,
        diplomas TEXT,
        notas TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS capacitacion_sucursales (
        id TEXT PRIMARY KEY,
        capacitacion_id TEXT,
        sucursal_id TEXT,
        orden INTEGER NOT NULL DEFAULT 0,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS capacitacion_capacitadores (
        id TEXT PRIMARY KEY,
        capacitacion_id TEXT,
        empleado_id TEXT,
        orden INTEGER NOT NULL DEFAULT 0,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendario (
        id TEXT PRIMARY KEY,
        row_id TEXT,
        fecha TEXT,
        icono TEXT,
        titulo TEXT,
        notas TEXT,
        color TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendario_empleados (
        id TEXT PRIMARY KEY,
        calendario_id TEXT,
        empleado_id TEXT,
        orden INTEGER NOT NULL DEFAULT 0,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS catalogo (
        id TEXT PRIMARY KEY,
        row_id TEXT,
        codigo TEXT,
        nombre TEXT,
        precio_sugerido REAL,
        tipo TEXT,
        iva REAL,
        descripcion TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS proveedores (
        id TEXT PRIMARY KEY,
        row_id TEXT,
        nombre TEXT,
        banco TEXT,
        cuenta_bancaria TEXT,
        clabe TEXT,
        pie_de_firma TEXT,
        puesto TEXT,
        firma TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS cotizaciones (
        id TEXT PRIMARY KEY,
        row_id TEXT,
        empresa_id TEXT,
        fecha TEXT,
        proveedor_id TEXT,
        titulo TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS cotizacion_centros_trabajo (
        id TEXT PRIMARY KEY,
        cotizacion_id TEXT,
        sucursal_id TEXT,
        orden INTEGER NOT NULL DEFAULT 0,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS conceptos_cotizacion (
        id TEXT PRIMARY KEY,
        row_id TEXT,
        cotizacion_id TEXT,
        centro_trabajo_id TEXT,
        concepto_id TEXT,
        cantidad REAL,
        precio REAL,
        iva REAL,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS estatales (
        row_id TEXT PRIMARY KEY,
        fecha TEXT,
        anio INTEGER,
        sucursal_id TEXT,
        pipc TEXT,
        documentacion TEXT,
        anexos_impresos TEXT,
        notas TEXT,
        data_json TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS municipales (
        row_id TEXT PRIMARY KEY,
        fecha TEXT,
        anio INTEGER,
        sucursal_id TEXT,
        plan_de_contingencia TEXT,
        documentacion TEXT,
        anexos_impresos TEXT,
        notas TEXT,
        data_json TEXT,
        sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
        sync_appsheet_fecha TEXT,
        sync_appsheet_operacion TEXT,
        sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS operational_rows (
        source TEXT NOT NULL DEFAULT 'desarrolloeg',
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        appsheet_synced_hash TEXT,
        appsheet_synced_at TEXT,
        PRIMARY KEY (source, table_name, row_id)
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_operational_rows_table
      ON operational_rows(source, table_name, updated_at);
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS appsheet_sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('Add', 'Edit', 'Delete')),
        payload_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source, table_name, row_id, content_hash)
      );
    `);
  } catch (error) {
    markDbUnavailable(error, "No se pudo inicializar la SQLite local");
    return;
  }

  const ensureColumns = (tableName, columns) => {
    const existing = new Set(
      db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => String(column.name)),
    );
    for (const [columnName, definition] of columns) {
      if (existing.has(columnName)) continue;
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  };

  ensureColumns("cfdis", [
    ["pdf_extraido", "INTEGER NOT NULL DEFAULT 0"],
    ["pdf_extraido_fecha", "TEXT"],
    ["pdf_extraido_error", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("pedidos_ley", [
    ["pdf_extraido", "INTEGER NOT NULL DEFAULT 0"],
    ["pdf_extraido_fecha", "TEXT"],
    ["pdf_extraido_error", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("liberaciones", [
    ["pdf_extraido", "INTEGER NOT NULL DEFAULT 0"],
    ["pdf_extraido_fecha", "TEXT"],
    ["pdf_extraido_error", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  const casaLeySyncColumns = [
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ];
  ensureColumns("cheques_ley", casaLeySyncColumns);
  ensureColumns("pagados_ley", casaLeySyncColumns);
  ensureColumns("facturas_en_ley", casaLeySyncColumns);
  ensureColumns("empresas", [
    ["row_id", "TEXT"],
    ["razon_social", "TEXT"],
    ["nombre_comercial", "TEXT"],
    ["logo", "TEXT"],
    ["logo_url", "TEXT"],
    ["rfc", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("municipios", [
    ["nombre", "TEXT"],
    ["escudo", "TEXT"],
    ["encargado_pc", "TEXT"],
    ["puesto", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("estados", [
    ["nombre", "TEXT"],
    ["escudo", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("sucursales", [
    ["row_id", "TEXT"],
    ["tienda", "TEXT"],
    ["label", "TEXT"],
    ["label2", "TEXT"],
    ["nombre", "TEXT"],
    ["domicilio", "TEXT"],
    ["address", "TEXT"],
    ["street", "TEXT"],
    ["municipio_id", "TEXT"],
    ["municipio_nombre", "TEXT"],
    ["estado_id", "TEXT"],
    ["estado_nombre", "TEXT"],
    ["empresa_id", "TEXT"],
    ["empresa_nombre", "TEXT"],
    ["lat", "REAL"],
    ["lng", "REAL"],
    ["id_pc", "TEXT"],
    ["mes_planeacion", "INTEGER"],
    ["capacitadores", "TEXT"],
    ["assigned_month", "INTEGER"],
    ["vencimiento_estatal", "TEXT"],
    ["vencimiento_municipal", "TEXT"],
    ["trabajos", "TEXT"],
    ["tipo", "TEXT"],
    ["nivel_riesgo", "TEXT"],
    ["precio_estatal", "REAL"],
    ["precio_municipal", "REAL"],
    ["ultimo_pipc_estatal", "TEXT"],
    ["ultimo_municipal", "TEXT"],
    ["pedido", "TEXT"],
    ["planeacion_status", "TEXT"],
    ["planeacion_tone", "TEXT"],
    ["drive", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("empleados", [
    ["id", "TEXT"],
    ["nombre", "TEXT"],
    ["iniciales", "TEXT"],
    ["color", "TEXT"],
    ["puesto", "TEXT"],
    ["correo", "TEXT"],
    ["capacita", "TEXT"],
    ["permiso", "TEXT"],
    ["firma", "TEXT"],
    ["cumpleanos", "TEXT"],
    ["telefono", "TEXT"],
    ["telefono_2", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("capacitaciones", [
    ["id", "TEXT"],
    ["row_id", "TEXT"],
    ["fecha_capacitacion", "TEXT"],
    ["hora_inicio", "TEXT"],
    ["hora_fin", "TEXT"],
    ["cede_sucursal_id", "TEXT"],
    ["cede", "TEXT"],
    ["sucursales", "TEXT"],
    ["capacitadores", "TEXT"],
    ["status", "TEXT"],
    ["diplomas", "TEXT"],
    ["notas", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("capacitacion_sucursales", [
    ["id", "TEXT"],
    ["capacitacion_id", "TEXT"],
    ["sucursal_id", "TEXT"],
    ["orden", "INTEGER NOT NULL DEFAULT 0"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("capacitacion_capacitadores", [
    ["id", "TEXT"],
    ["capacitacion_id", "TEXT"],
    ["empleado_id", "TEXT"],
    ["orden", "INTEGER NOT NULL DEFAULT 0"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  const trabajoSucursalColumns = [
    ["fecha", "TEXT"],
    ["anio", "INTEGER"],
    ["sucursal_id", "TEXT"],
    ["documentacion", "TEXT"],
    ["anexos_impresos", "TEXT"],
    ["notas", "TEXT"],
    ["data_json", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ];
  ensureColumns("estatales", [
    ...trabajoSucursalColumns,
    ["pipc", "TEXT"],
  ]);
  ensureColumns("municipales", [
    ...trabajoSucursalColumns,
    ["plan_de_contingencia", "TEXT"],
  ]);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_capacitaciones_id ON capacitaciones(id);`);
  ensureColumns("calendario_empleados", [
    ["id", "TEXT"],
    ["calendario_id", "TEXT"],
    ["empleado_id", "TEXT"],
    ["orden", "INTEGER NOT NULL DEFAULT 0"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("calendario", [
    ["row_id", "TEXT"],
    ["fecha", "TEXT"],
    ["icono", "TEXT"],
    ["titulo", "TEXT"],
    ["notas", "TEXT"],
    ["color", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("calendario_empleados", [
    ["calendario_id", "TEXT"],
    ["empleado_id", "TEXT"],
    ["orden", "INTEGER NOT NULL DEFAULT 0"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("catalogo", [
    ["row_id", "TEXT"],
    ["codigo", "TEXT"],
    ["nombre", "TEXT"],
    ["precio_sugerido", "REAL"],
    ["tipo", "TEXT"],
    ["iva", "REAL"],
    ["descripcion", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("proveedores", [
    ["row_id", "TEXT"],
    ["nombre", "TEXT"],
    ["banco", "TEXT"],
    ["cuenta_bancaria", "TEXT"],
    ["clabe", "TEXT"],
    ["pie_de_firma", "TEXT"],
    ["puesto", "TEXT"],
    ["firma", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("cotizaciones", [
    ["row_id", "TEXT"],
    ["empresa_id", "TEXT"],
    ["fecha", "TEXT"],
    ["proveedor_id", "TEXT"],
    ["titulo", "TEXT"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("cotizacion_centros_trabajo", [
    ["cotizacion_id", "TEXT"],
    ["sucursal_id", "TEXT"],
    ["orden", "INTEGER NOT NULL DEFAULT 0"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);
  ensureColumns("conceptos_cotizacion", [
    ["row_id", "TEXT"],
    ["cotizacion_id", "TEXT"],
    ["centro_trabajo_id", "TEXT"],
    ["concepto_id", "TEXT"],
    ["cantidad", "REAL"],
    ["precio", "REAL"],
    ["iva", "REAL"],
    ["sync_appsheet_estado", "TEXT NOT NULL DEFAULT 'PENDIENTE'"],
    ["sync_appsheet_fecha", "TEXT"],
    ["sync_appsheet_operacion", "TEXT"],
    ["sync_origen_ultimo", "TEXT NOT NULL DEFAULT 'APPSHEET'"],
  ]);

  migrateCfdiIds(db);

  schemaInitialized = true;
}

function ensureFlagSchema() {
  if (flagSchemaInitialized) return;
  const db = getDb();
  if (!db) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS pedidos_ley (
      pedido TEXT PRIMARY KEY,
      pdf_extraido INTEGER NOT NULL DEFAULT 0,
      pdf_extraido_fecha TEXT,
      pdf_extraido_error TEXT,
      sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
      sync_appsheet_fecha TEXT,
      sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS liberaciones (
      liberacion TEXT PRIMARY KEY,
      pdf_extraido INTEGER NOT NULL DEFAULT 0,
      pdf_extraido_fecha TEXT,
      pdf_extraido_error TEXT,
      sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
      sync_appsheet_fecha TEXT,
      sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS facturas_sync_state (
      state_key TEXT PRIMARY KEY,
      dirty INTEGER NOT NULL DEFAULT 0,
      local_revision INTEGER NOT NULL DEFAULT 0,
      last_local_change_at TEXT,
      last_local_change_reason TEXT,
      last_local_change_count INTEGER NOT NULL DEFAULT 0,
      last_mirror_at TEXT,
      last_mirror_revision INTEGER NOT NULL DEFAULT 0,
      last_mirror_rows INTEGER NOT NULL DEFAULT 0,
      last_mirror_result TEXT
    );
  `);
  flagSchemaInitialized = true;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  return value;
}

function pickFirst(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

export function closeLocalAppsheetDb() {
  closeCachedDb();
  schemaInitialized = false;
  flagSchemaInitialized = false;
  localDbUnavailable = false;
  localDbRetryAt = 0;
  localDbLastError = null;
}

function extractYearValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getFullYear();
  const text = String(value ?? "").trim();
  if (!text) return null;

  const explicitYear = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (explicitYear) {
    const year = Number(explicitYear[1]);
    return Number.isFinite(year) ? year : null;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.getFullYear();
  return null;
}

function stringifyRawRow(row) {
  try {
    return JSON.stringify(row || {});
  } catch {
    return "{}";
  }
}

function normalizePedidoValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = /\b(6\d{9})\b/.exec(text);
  return match?.[1] || null;
}

function normalizeCfdiIdValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

function migrateCfdiIds(db) {
  const rowsWithDecimalIds = db.prepare(`SELECT id FROM cfdis WHERE id LIKE '%.0'`).all();
  if (!rowsWithDecimalIds.length) return;

  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of rowsWithDecimalIds) {
      const currentId = String(row.id ?? "").trim();
      const normalizedId = normalizeCfdiIdValue(currentId);
      if (!normalizedId || normalizedId === currentId) continue;

      const collision = db.prepare(`SELECT 1 FROM cfdis WHERE id = ? LIMIT 1`).get(normalizedId);
      if (collision) continue;

      db.prepare(`UPDATE cfdis SET id = ? WHERE id = ?`).run(normalizedId, currentId);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function isManualCfdiPedido(localRow) {
  const origin = String(localRow?.sync_origen_ultimo || "").trim().toUpperCase();
  const existingPedido = normalizePedidoValue(localRow?.pedido);
  return origin === "APPSHEET" && Boolean(existingPedido);
}

function isPendingPedidoValue(value) {
  const text = String(value ?? "").trim().toUpperCase();
  return text === "" || text === "PENDIENTE";
}

function mapCfdiRow(row) {
  return {
    id: normalizeCfdiIdValue(pickFirst(row, ["id", "ID", "Row ID", "row_id"])),
    serie_folio: pickFirst(row, ["serie_folio", "serieFolio", "SERIE FOLIO"]),
    fecha: pickFirst(row, ["fecha", "FECHA"]),
    rfc: pickFirst(row, ["rfc", "RFC"]),
    importe: normalizeValue(row?.importe ?? row?.IMPORTE),
    tipo_desc: pickFirst(row, ["tipo_desc", "tipoDesc"]),
    estatus_pago_desc: pickFirst(row, ["estatus_pago_desc", "estatusPagoDesc"]),
    fecha_pago_cobro: pickFirst(row, ["fecha_pago_cobro", "fechaPagoCobro"]),
    xml: pickFirst(row, ["xml", "XML"]),
    pdf: pickFirst(row, ["pdf", "PDF"]),
    proveedor: pickFirst(row, ["proveedor", "PROVEEDOR"]),
    pedido: pickFirst(row, ["pedido", "PEDIDO"]),
    uuid: pickFirst(row, ["uuid", "UUID", "Uuid"]),
  };
}

function mergeCfdiRow(remoteRow, localRow) {
  const incoming = mapCfdiRow(remoteRow);
  const incomingPedido = String(incoming.pedido ?? "").trim();
  const existingPedido = String(localRow?.pedido ?? "").trim();
  const shouldKeepExistingPedido = existingPedido && !isPendingPedidoValue(existingPedido);
  const pedido = shouldKeepExistingPedido ? existingPedido : (incomingPedido || existingPedido || null);

  return {
    ...incoming,
    pedido,
    sync_appsheet_estado: incoming.sync_appsheet_estado ?? localRow?.sync_appsheet_estado ?? "PENDIENTE",
    sync_appsheet_fecha: incoming.sync_appsheet_fecha ?? localRow?.sync_appsheet_fecha ?? null,
    sync_appsheet_operacion: incoming.sync_appsheet_operacion ?? localRow?.sync_appsheet_operacion ?? null,
    sync_origen_ultimo: localRow?.sync_origen_ultimo ?? incoming.sync_origen_ultimo ?? "JOB_LOCAL",
    pdf_extraido: incoming.pdf_extraido ?? localRow?.pdf_extraido ?? 0,
    pdf_extraido_fecha: incoming.pdf_extraido_fecha ?? localRow?.pdf_extraido_fecha ?? null,
    pdf_extraido_error: incoming.pdf_extraido_error ?? localRow?.pdf_extraido_error ?? null,
  };
}

function cfdiComparableRow(row) {
  return {
    id: normalizeCfdiIdValue(row?.id),
    serie_folio: pickFirst(row, ["serie_folio", "serieFolio"]),
    fecha: pickFirst(row, ["fecha", "FECHA"]),
    rfc: pickFirst(row, ["rfc", "RFC"]),
    importe: normalizeValue(row?.importe ?? row?.IMPORTE),
    tipo_desc: pickFirst(row, ["tipo_desc", "tipoDesc"]),
    estatus_pago_desc: pickFirst(row, ["estatus_pago_desc", "estatusPagoDesc"]),
    fecha_pago_cobro: pickFirst(row, ["fecha_pago_cobro", "fechaPagoCobro"]),
    xml: pickFirst(row, ["xml", "XML"]),
    pdf: pickFirst(row, ["pdf", "PDF"]),
    proveedor: pickFirst(row, ["proveedor", "PROVEEDOR"]),
    pedido: pickFirst(row, ["pedido", "PEDIDO"]),
    uuid: pickFirst(row, ["uuid", "UUID"]),
  };
}

function cfdiRowsDiffer(existingRow, nextRow) {
  return JSON.stringify(cfdiComparableRow(existingRow)) !== JSON.stringify(cfdiComparableRow(nextRow));
}

function mapChequeRow(row) {
  return {
    referencia_pago: pickFirst(row, ["referencia_pago", "Referencia de pago", "Referencia"]),
    documento_pago: pickFirst(row, ["documento_pago", "Documento pago"]),
    forma_pago: pickFirst(row, ["forma_pago", "Forma pago"]),
    fecha_pago: pickFirst(row, ["fecha_pago", "Fecha pago"]),
    fecha_cobro: pickFirst(row, ["fecha_cobro", "Fecha cobro"]),
    fecha_de_carga: pickFirst(row, ["fecha_de_carga", "Fecha de carga"]),
    operacion: pickFirst(row, ["operacion", "# Operacion", "Operacion"]),
    moneda: pickFirst(row, ["moneda", "Moneda"]),
    tipo_de_cambio: normalizeValue(row?.tipo_de_cambio ?? row?.["Tipo de cambio"]),
    importe: normalizeValue(row?.importe ?? row?.Importe),
    emisor: pickFirst(row, ["emisor", "Emisor"]),
    cuenta_banco: pickFirst(row, ["cuenta_banco", "Cuenta banco"]),
    receptor: pickFirst(row, ["receptor", "Receptor"]),
    proveedor: pickFirst(row, ["proveedor", "Proveedor"]),
    cuenta_receptora: pickFirst(row, ["cuenta_receptora", "Cuenta receptora"]),
    uuid_de_pago: pickFirst(row, ["uuid_de_pago", "UUID de pago"]),
    doctos_relacionados: pickFirst(row, ["doctos_relacionados", "Doctos relacionados"]),
    cobrado: pickFirst(row, ["cobrado", "COBRADO"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapRelacionadoRow(row) {
  return {
    referencia: pickFirst(row, ["referencia", "Referencia"]),
    referencia_pago: pickFirst(row, ["referencia_pago", "Referencia de pago"]),
    clase_docto: pickFirst(row, ["clase_docto", "ClaseDocto"]),
    uuid: pickFirst(row, ["uuid", "Uuid", "UUID"]),
    imp_pagado: normalizeValue(row?.imp_pagado ?? row?.ImpPagado),
    tipo_docto: pickFirst(row, ["tipo_docto", "Tipodocto"]),
    factura: pickFirst(row, ["factura", "Factura"]),
    asignacion: pickFirst(row, ["asignacion", "Asignacion"]),
    tienda: pickFirst(row, ["tienda", "Tienda"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapFacturaLeyRow(row) {
  return {
    folio_uuid: pickFirst(row, ["folio_uuid", "Folio Uuid"]),
    emisor: pickFirst(row, ["emisor", "Emisor"]),
    receptor: pickFirst(row, ["receptor", "Receptor"]),
    serie: pickFirst(row, ["serie", "Serie"]),
    folio: pickFirst(row, ["folio", "Folio"]),
    fecha_factura: pickFirst(row, ["fecha_factura", "Fecha factura"]),
    fecha_registro: pickFirst(row, ["fecha_registro", "Fecha registro"]),
    importe: normalizeValue(row?.importe ?? row?.Importe),
    iva: normalizeValue(row?.iva ?? row?.Iva),
    total: normalizeValue(row?.total ?? row?.Total),
    estatus: pickFirst(row, ["estatus", "Estatus"]),
    proveedor_sec: pickFirst(row, ["proveedor_sec", "Proveedor Sec"]),
    num_ent: pickFirst(row, ["num_ent", "Num ent"]),
    tienda: pickFirst(row, ["tienda", "Tienda"]),
    no_remision: pickFirst(row, ["no_remision", "No Remision"]),
    razon_social: pickFirst(row, ["razon_social", "Razón social", "RazÃ³n social"]),
  };
}

function mapPedidoLeyRow(row) {
  return {
    pedido: pickFirst(row, ["pedido", "PEDIDO"]),
    tienda: pickFirst(row, ["tienda", "TIENDA", "Tienda"]),
    establecimiento: pickFirst(row, ["establecimiento", "ESTABLECIMIENTO"]),
    proveedor: pickFirst(row, ["proveedor", "PROVEEDOR"]),
    fecha: pickFirst(row, ["fecha", "FECHA"]),
    importe: normalizeValue(row?.importe ?? row?.IMPORTE),
    descripcion: pickFirst(row, ["descripcion", "DESCRIPCION", "DESCRIPTION"]),
    pdf: pickFirst(row, ["pdf", "PDF"]),
    enviado: pickFirst(row, ["enviado", "ENVIADO", "Enviado"]),
    liberacion: pickFirst(row, ["liberacion", "LIBERACION", "LIBERADO"]),
    pago: pickFirst(row, ["pago", "PAGO", "PAGADO"]),
    factura_en_ley: pickFirst(row, ["factura_en_ley", "FACTURA EN LEY", "FACTURAENLEY", "FACTURA_EN_LEY"]),
    folio_clubfactura: pickFirst(row, ["folio_clubfactura", "FOLIO CLUBFACTURA", "FOLIO_CLUBFACTURA"]),
    cheque: pickFirst(row, ["cheque", "CHEQUE"]),
    status: pickFirst(row, ["status", "STATUS", "ESTATUS"]),
    facturador: pickFirst(row, ["facturador", "FACTURADOR", "Facturador"]),
    uuid: pickFirst(row, ["uuid", "UUID"]),
    ultimo_pipc_estatal: normalizeValue(row?.ultimo_pipc_estatal ?? row?.ULTIMO_PIPC_ESTATAL),
    ultimo_municipal: normalizeValue(row?.ultimo_municipal ?? row?.ULTIMO_MUNICIPAL),
    descripcion_complementaria: pickFirst(row, ["descripcion_complementaria", "DESCRIPCION COMPLEMENTARIA"]),
    pdf_extraido: normalizeValue(row?.pdf_extraido ?? row?.PDF_EXTRAIDO),
    pdf_extraido_fecha: pickFirst(row, ["pdf_extraido_fecha", "PDF_EXTRAIDO_FECHA"]),
    pdf_extraido_error: pickFirst(row, ["pdf_extraido_error", "PDF_EXTRAIDO_ERROR"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapLiberacionRow(row) {
  return {
    liberacion: pickFirst(row, ["liberacion", "LIBERACION"]),
    num_pedido: pickFirst(row, ["num_pedido", "NUM. DE PEDIDO", "NUM PEDIDO", "PEDIDO"]),
    fecha: pickFirst(row, ["fecha", "FECHA"]),
    pdf: pickFirst(row, ["pdf", "PDF"]),
    pdf_extraido: normalizeValue(row?.pdf_extraido ?? row?.PDF_EXTRAIDO),
    pdf_extraido_fecha: pickFirst(row, ["pdf_extraido_fecha", "PDF_EXTRAIDO_FECHA"]),
    pdf_extraido_error: pickFirst(row, ["pdf_extraido_error", "PDF_EXTRAIDO_ERROR"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapEmpresaRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "row_id", "ROW ID"]),
    row_id: pickFirst(row, ["Row ID", "ROW ID", "row_id"]),
    razon_social: pickFirst(row, ["razon_social", "RAZON SOCIAL", "Razón Social", "Razon Social"]),
    nombre_comercial: pickFirst(row, ["nombre_comercial", "NOMBRE COMERCIAL", "Nombre Comercial"]),
    logo: pickFirst(row, ["logo", "LOGO"]),
    logo_url: pickFirst(row, ["logo_url", "LOGOURL", "LOGO URL", "Logo URL"]),
    rfc: pickFirst(row, ["rfc", "RFC", "Rfc"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapMunicipioRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "row_id", "ROW ID"]),
    nombre: pickFirst(row, ["nombre", "NOMBRE", "Nombre"]),
    escudo: pickFirst(row, ["escudo", "ESCUDO"]),
    encargado_pc: pickFirst(row, ["encargado_pc", "ENCARGADO PC", "Encargado PC"]),
    puesto: pickFirst(row, ["puesto", "PUESTO", "Puesto"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapEstadoRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "row_id", "ROW ID"]),
    nombre: pickFirst(row, ["nombre", "NOMBRE", "Nombre"]),
    escudo: pickFirst(row, ["escudo", "ESCUDO"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapSucursalRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "row_id", "ROW ID"]),
    row_id: pickFirst(row, ["Row ID", "ROW ID", "row_id"]),
    tienda: pickFirst(row, ["tienda", "TIENDA", "Tienda"]),
    label: pickFirst(row, ["label", "LABEL", "Label"]),
    label2: pickFirst(row, ["label2", "LABEL2", "Label2"]),
    nombre: pickFirst(row, ["nombre", "NOMBRE", "Nombre"]),
    domicilio: pickFirst(row, ["domicilio", "DOMICILIO"]),
    address: pickFirst(row, ["address", "ADDRESS", "Direccion", "DIRECCION", "DIRECCION GOOGLE"]),
    street: pickFirst(row, ["street", "STREET"]),
    municipio_id: pickFirst(row, ["municipio_id", "MUNICIPIO", "Municipio", "municipio"]),
    municipio_nombre: pickFirst(row, ["municipio_nombre", "MUNICIPIO NOMBRE"]),
    estado_id: pickFirst(row, ["estado_id", "ESTADO", "Estado", "estado"]),
    estado_nombre: pickFirst(row, ["estado_nombre", "ESTADO NOMBRE"]),
    empresa_id: pickFirst(row, ["empresa_id", "EMPRESA", "Empresa", "ID EMPRESA"]),
    empresa_nombre: pickFirst(row, ["empresa_nombre", "EMPRESA NOMBRE"]),
    lat: normalizeValue(row?.lat ?? row?.LAT),
    lng: normalizeValue(row?.lng ?? row?.LNG),
    id_pc: pickFirst(row, ["id_pc", "ID_PC", "ID PC"]),
    assigned_month: normalizeValue(row?.assigned_month ?? row?.ASSIGNED_MONTH),
    vencimiento_estatal: pickFirst(row, ["vencimiento_estatal", "VENCIMIENTO ESTATAL", "VENCIMIENTOESTATAL", "VencimientoEstatal", "ULTIMO PIPC ESTATAL", "ultimo_pipc_estatal"]),
    vencimiento_municipal: pickFirst(row, ["vencimiento_municipal", "VENCIMIENTO MUNICIPAL", "VENCIMIENTOMUNICIPAL", "VencimientoMunicipal", "ULTIMO MUNICIPAL", "ultimo_municipal"]),
    trabajos: pickFirst(row, ["trabajos", "TRABAJOS", "Trabajos"]),
    tipo: pickFirst(row, ["tipo", "TIPO", "Tipo"]),
    nivel_riesgo: pickFirst(row, ["nivel_riesgo", "NIVEL DE RIESGO", "Nivel de Riesgo"]),
    precio_estatal: normalizeValue(row?.precio_estatal ?? row?.["PRECIO ESTATAL"] ?? row?.PrecioEstatal),
    precio_municipal: normalizeValue(row?.precio_municipal ?? row?.["PRECIO MUNICIPAL"] ?? row?.PrecioMunicipal),
    ultimo_pipc_estatal: pickFirst(row, ["ultimo_pipc_estatal", "ULTIMO PIPC ESTATAL", "Ultimo PIPC Estatal"]),
    ultimo_municipal: pickFirst(row, ["ultimo_municipal", "ULTIMO MUNICIPAL", "Ultimo Municipal"]),
    pedido: pickFirst(row, ["pedido", "PEDIDO", "Pedido"]),
    planeacion_status: pickFirst(row, ["planeacion_status", "ESTATUS CAPACITACION", "STATUS", "status"]),
    planeacion_tone: pickFirst(row, ["planeacion_tone", "PLANEACION_TONE"]),
    drive: pickFirst(row, ["drive", "DRIVE"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapEstatalRow(row) {
  const fecha = pickFirst(row, ["fecha", "FECHA", "Fecha"]);
  const anio = pickFirst(row, ["anio", "AÑO", "ANO", "AÃ‘O", "year", "YEAR"]) ?? extractYearValue(fecha);
  return {
    row_id: pickFirst(row, ["row_id", "Row ID", "ROW ID", "Row Id", "_RowNumber", "_ROWNUMBER", "id", "ID"]),
    fecha,
    anio,
    sucursal_id: pickFirst(row, ["sucursal_id", "SUCURSAL", "Sucursal", "sucursal", "TIENDA", "Tienda", "tienda"]),
    pipc: pickFirst(row, ["pipc", "PIPC", "Ultimo PIPC", "ULTIMO PIPC", "ULTIMO PIPC ESTATAL"]),
    documentacion: pickFirst(row, ["documentacion", "DOCUMENTACION", "Documentacion"]),
    anexos_impresos: pickFirst(row, ["anexos_impresos", "ANEXOS IMPRESOS", "ANEXOS_IMPRESOS"]),
    notas: pickFirst(row, ["notas", "NOTAS", "Notas"]),
    data_json: stringifyRawRow(row),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapMunicipalRow(row) {
  const fecha = pickFirst(row, ["fecha", "FECHA", "Fecha"]);
  const anio = pickFirst(row, ["anio", "AÑO", "ANO", "AÃ‘O", "year", "YEAR"]) ?? extractYearValue(fecha);
  return {
    row_id: pickFirst(row, ["row_id", "Row ID", "ROW ID", "Row Id", "_RowNumber", "_ROWNUMBER", "id", "ID"]),
    fecha,
    anio,
    sucursal_id: pickFirst(row, ["sucursal_id", "SUCURSAL", "Sucursal", "sucursal", "TIENDA", "Tienda", "tienda"]),
    plan_de_contingencia: pickFirst(row, ["plan_de_contingencia", "PLAN DE CONTINGENCIA", "PLAN_DE_CONTINGENCIA", "Ultimo Municipal", "ULTIMO MUNICIPAL"]),
    documentacion: pickFirst(row, ["documentacion", "DOCUMENTACION", "Documentacion"]),
    anexos_impresos: pickFirst(row, ["anexos_impresos", "ANEXOS IMPRESOS", "ANEXOS_IMPRESOS"]),
    notas: pickFirst(row, ["notas", "NOTAS", "Notas"]),
    data_json: stringifyRawRow(row),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapEmpleadoRow(row) {
  return {
    row_id: pickFirst(row, ["Row ID", "ROW ID", "row_id"]),
    id: pickFirst(row, ["id", "ID"]),
    nombre: pickFirst(row, ["nombre", "NOMBRE", "Nombre"]),
    iniciales: pickFirst(row, ["iniciales", "INICIALES"]),
    color: pickFirst(row, ["color", "COLOR"]),
    puesto: pickFirst(row, ["puesto", "PUESTO"]),
    correo: pickFirst(row, ["correo", "CORREO"]),
    capacita: pickFirst(row, ["capacita", "CAPACITA"]),
    permiso: pickFirst(row, ["permiso", "PERMISO"]),
    firma: pickFirst(row, ["firma", "FIRMA"]),
    cumpleanos: pickFirst(row, ["cumpleanos", "CUMPLEAÑOS", "CUMPLEANOS"]),
    telefono: pickFirst(row, ["telefono", "TELEFONO"]),
    telefono_2: pickFirst(row, ["telefono_2", "TELEFONO 2", "TELEFONO_2"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCapacitacionRow(row) {
  const cedeSucursalId = pickFirst(row, ["cede_sucursal_id", "cede", "CEDE"]);
  const fechaCapacitacion = pickFirst(row, ["fecha_capacitacion", "FECHA CAPACITACION"]);
  const status = deriveCapacitacionStatus(fechaCapacitacion) || pickFirst(row, ["status", "STATUS", "Estatus", "ESTATUS"]);
  return {
    row_id: pickFirst(row, ["Row ID", "ROW ID", "Row Id", "row_id"]),
    id: pickFirst(row, ["id", "ID"]),
    fecha_capacitacion: fechaCapacitacion,
    hora_inicio: pickFirst(row, ["hora_inicio", "HORA INICIO"]),
    hora_fin: pickFirst(row, ["hora_fin", "HORA FIN"]),
    cede_sucursal_id: cedeSucursalId,
    cede: cedeSucursalId,
    sucursales: pickFirst(row, ["sucursales", "SUCURSALES"]),
    capacitadores: pickFirst(row, ["capacitadores", "CAPACITADORES"]),
    status,
    diplomas: pickFirst(row, ["diplomas", "DIPLOMAS"]),
    notas: pickFirst(row, ["notas", "NOTAS"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCalendarioRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "Row Id", "row_id"]),
    fecha: pickFirst(row, ["fecha", "FECHA"]),
    icono: pickFirst(row, ["icono", "ICONO"]),
    titulo: pickFirst(row, ["titulo", "TITULO"]),
    notas: pickFirst(row, ["notas", "NOTAS"]),
    color: pickFirst(row, ["color", "COLOR"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCalendarioEmpleadoRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    calendario_id: pickFirst(row, ["calendario_id", "CALENDARIO", "CALENDARIO_ID"]),
    empleado_id: pickFirst(row, ["empleado_id", "EMPLEADO", "EMPLEADO_ID"]),
    orden: normalizeValue(row?.orden ?? row?.ORDEN),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCatalogoRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    codigo: pickFirst(row, ["codigo", "CODIGO", "CLAVE"]),
    nombre: pickFirst(row, ["nombre", "NOMBRE"]),
    precio_sugerido: normalizeValue(row?.precio_sugerido ?? row?.PRECIO_SUGERIDO),
    tipo: pickFirst(row, ["tipo", "TIPO"]),
    iva: normalizeValue(row?.iva ?? row?.IVA),
    descripcion: pickFirst(row, ["descripcion", "DESCRIPCION"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapProveedorRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    nombre: pickFirst(row, ["nombre", "NOMBRE"]),
    banco: pickFirst(row, ["banco", "BANCO"]),
    cuenta_bancaria: pickFirst(row, ["cuenta_bancaria", "CUENTA BANCARIA"]),
    clabe: pickFirst(row, ["clabe", "CLABE"]),
    pie_de_firma: pickFirst(row, ["pie_de_firma", "PIE DE FIRMA"]),
    puesto: pickFirst(row, ["puesto", "PUESTO"]),
    firma: pickFirst(row, ["firma", "FIRMA"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCotizacionRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    empresa_id: pickFirst(row, ["empresa_id", "EMPRESA", "RAZON SOCIAL"]),
    fecha: pickFirst(row, ["fecha", "FECHA"]),
    proveedor_id: pickFirst(row, ["proveedor_id", "PROVEEDOR"]),
    titulo: pickFirst(row, ["titulo", "TITULO"]),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCotizacionCentroTrabajoRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    cotizacion_id: pickFirst(row, ["cotizacion_id", "COTIZACION"]),
    sucursal_id: pickFirst(row, ["sucursal_id", "SUCURSAL", "CENTRO_DE_TRABAJO", "CENTRO DE TRABAJO"]),
    orden: normalizeValue(row?.orden ?? row?.ORDEN),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapConceptoCotizacionRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    cotizacion_id: pickFirst(row, ["cotizacion_id", "COTIZACION"]),
    centro_trabajo_id: pickFirst(row, ["centro_trabajo_id", "CENTRO_DE_TRABAJO", "CENTRO TRABAJO"]),
    concepto_id: pickFirst(row, ["concepto_id", "CONCEPTO"]),
    cantidad: normalizeValue(row?.cantidad ?? row?.CANTIDAD),
    precio: normalizeValue(row?.precio ?? row?.PRECIO),
    iva: normalizeValue(row?.iva ?? row?.IVA),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCalendarioEmpleadoBridgeRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    calendario_id: pickFirst(row, ["calendario_id", "CALENDARIO"]),
    empleado_id: pickFirst(row, ["empleado_id", "EMPLEADO"]),
    orden: normalizeValue(row?.orden ?? row?.ORDEN),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCapacitacionSucursalBridgeRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    capacitacion_id: pickFirst(row, ["capacitacion_id", "CAPACITACION"]),
    sucursal_id: pickFirst(row, ["sucursal_id", "SUCURSAL"]),
    orden: normalizeValue(row?.orden ?? row?.ORDEN),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCapacitacionCapacitadorBridgeRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    capacitacion_id: pickFirst(row, ["capacitacion_id", "CAPACITACION"]),
    empleado_id: pickFirst(row, ["empleado_id", "EMPLEADO"]),
    orden: normalizeValue(row?.orden ?? row?.ORDEN),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function mapCotizacionCentroTrabajoBridgeRow(row) {
  return {
    id: pickFirst(row, ["id", "ID", "Row ID", "ROW ID", "row_id"]),
    cotizacion_id: pickFirst(row, ["cotizacion_id", "COTIZACION"]),
    sucursal_id: pickFirst(row, ["sucursal_id", "SUCURSAL"]),
    orden: normalizeValue(row?.orden ?? row?.ORDEN),
    sync_appsheet_estado: pickFirst(row, ["sync_appsheet_estado", "SYNC_APPSHEET_ESTADO"]),
    sync_appsheet_fecha: pickFirst(row, ["sync_appsheet_fecha", "SYNC_APPSHEET_FECHA"]),
    sync_appsheet_operacion: pickFirst(row, ["sync_appsheet_operacion", "SYNC_APPSHEET_OPERACION"]),
    sync_origen_ultimo: pickFirst(row, ["sync_origen_ultimo", "SYNC_ORIGEN_ULTIMO"]),
  };
}

function upsertMany(tableName, rows, keyField, mapper) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const db = getDb();
  if (!db) return;
  initSchema();
  if (!isRetryWindowOpen()) return;

  const mappedRows = rows.map((row) => mapper(row)).filter((row) => row?.[keyField] !== null && row?.[keyField] !== undefined && String(row?.[keyField]).trim() !== "");
  if (!mappedRows.length) return;

  const columns = Array.from(new Set(mappedRows.flatMap((row) => Object.keys(row))))
    .filter((column) => mappedRows.some((row) => row[column] !== undefined && row[column] !== null));
  if (!columns.length) return;
  const insertColumns = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns.filter((column) => column !== keyField).map((column) => `${quoteIdentifier(column)}=excluded.${quoteIdentifier(column)}`).join(", ");
  const sql = `INSERT INTO ${quoteIdentifier(tableName)} (${insertColumns}) VALUES (${placeholders}) ON CONFLICT(${quoteIdentifier(keyField)}) DO UPDATE SET ${updates}`;
  const stmt = db.prepare(sql);

  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of mappedRows) {
      const values = columns.map((column) => normalizeValue(row[column]));
      stmt.run(...values);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function replaceMany(tableName, rows, keyField, mapper) {
  const db = getDb();
  if (!db) return;
  initSchema();
  if (!isRetryWindowOpen()) return;

  const mappedRows = Array.isArray(rows)
    ? rows
        .map((row) => mapper(row))
        .filter((row) => row?.[keyField] !== null && row?.[keyField] !== undefined && String(row?.[keyField]).trim() !== "")
    : [];

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`DELETE FROM ${quoteIdentifier(tableName)}`).run();

    if (mappedRows.length > 0) {
      const columns = Array.from(new Set(mappedRows.flatMap((row) => Object.keys(row))))
        .filter((column) => mappedRows.some((row) => row[column] !== undefined && row[column] !== null));
      if (columns.length > 0) {
        const insertColumns = columns.map(quoteIdentifier).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const stmt = db.prepare(`INSERT INTO ${quoteIdentifier(tableName)} (${insertColumns}) VALUES (${placeholders})`);
        for (const row of mappedRows) {
          const values = columns.map((column) => normalizeValue(row[column]));
          stmt.run(...values);
        }
      }
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function deleteByKeys(tableName, keyField, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return 0;
  const db = getDb();
  if (!db) return 0;
  initSchema();
  if (!isRetryWindowOpen()) return 0;

  const cleanKeys = [...new Set(keys.map((key) => String(key ?? "").trim()).filter(Boolean))];
  if (!cleanKeys.length) return 0;

  const placeholders = cleanKeys.map(() => "?").join(", ");
  const stmt = db.prepare(`DELETE FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(keyField)} IN (${placeholders})`);

  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = stmt.run(...cleanKeys);
    db.exec("COMMIT;");
    return Number(result?.changes || 0);
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

const CASA_LEY_TABLES = {
  pagos: { tableName: "cheques_ley", keyField: "referencia_pago", mapper: mapChequeRow },
  relacionados: { tableName: "pagados_ley", keyField: "referencia", mapper: mapRelacionadoRow },
  facturas: { tableName: "facturas_en_ley", keyField: "folio_uuid", mapper: mapFacturaLeyRow },
};

const CASA_LEY_SYNC_COLUMNS = new Set([
  "sync_appsheet_estado",
  "sync_appsheet_fecha",
  "sync_appsheet_operacion",
  "sync_origen_ultimo",
]);

function getCasaLeyTableConfig(scope) {
  return CASA_LEY_TABLES[String(scope || "").trim().toLowerCase()] || null;
}

function casaLeyComparableRow(row = {}) {
  const comparable = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (CASA_LEY_SYNC_COLUMNS.has(key)) continue;
    comparable[key] = normalizeValue(value);
  }
  return comparable;
}

function casaLeyRowsDiffer(existingRow, nextRow) {
  return JSON.stringify(casaLeyComparableRow(existingRow)) !== JSON.stringify(casaLeyComparableRow(nextRow));
}

function persistCasaLeyScopeRows(scope, rows = []) {
  const config = getCasaLeyTableConfig(scope);
  if (!config || !Array.isArray(rows)) return { changed: false, changedCount: 0, upsertedCount: 0 };

  const db = getDb();
  if (!db) return { changed: false, changedCount: 0, upsertedCount: 0 };
  initSchema();
  if (!isRetryWindowOpen()) return { changed: false, changedCount: 0, upsertedCount: 0 };

  const mappedRows = rows
    .map((row) => config.mapper(row))
    .filter((row) => row?.[config.keyField] !== null && row?.[config.keyField] !== undefined && String(row?.[config.keyField]).trim() !== "");

  if (!mappedRows.length) return { changed: false, changedCount: 0, upsertedCount: 0 };

  const keys = [...new Set(mappedRows.map((row) => String(row[config.keyField]).trim()).filter(Boolean))];
  const existingByKey = new Map();
  if (keys.length > 0) {
    const placeholders = keys.map(() => "?").join(", ");
    const existingRows = db.prepare(`SELECT * FROM ${quoteIdentifier(config.tableName)} WHERE ${quoteIdentifier(config.keyField)} IN (${placeholders})`).all(...keys);
    for (const row of existingRows) {
      existingByKey.set(String(row[config.keyField]).trim(), row);
    }
  }

  let changedCount = 0;
  const mergedRows = mappedRows.map((row) => {
    const key = String(row[config.keyField]).trim();
    const existing = existingByKey.get(key) || null;
    const changed = !existing || casaLeyRowsDiffer(existing, row);
    if (!changed) {
      return {
        ...existing,
        ...row,
        sync_appsheet_estado: existing.sync_appsheet_estado || "SINCRONIZADO",
        sync_appsheet_fecha: existing.sync_appsheet_fecha || null,
        sync_appsheet_operacion: existing.sync_appsheet_operacion || null,
        sync_origen_ultimo: existing.sync_origen_ultimo || "JOB_LOCAL",
      };
    }

    changedCount += 1;
    return {
      ...row,
      sync_appsheet_estado: "PENDIENTE",
      sync_appsheet_fecha: null,
      sync_appsheet_operacion: existing ? "EDIT" : "ADD",
      sync_origen_ultimo: "JOB_LOCAL",
    };
  });

  upsertMany(config.tableName, mergedRows, config.keyField, (row) => row);
  return {
    changed: changedCount > 0,
    changedCount,
    upsertedCount: mergedRows.length,
  };
}

function normalizeCfdiSyncValue(value) {
  if (value === undefined || value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function getFacturasSyncState() {
  const db = getDb();
  if (!db) return null;
  ensureFlagSchema();
  if (!isRetryWindowOpen()) return null;
  return db.prepare(`
    SELECT
      state_key,
      dirty,
      local_revision,
      last_local_change_at,
      last_local_change_reason,
      last_local_change_count,
      last_mirror_at,
      last_mirror_revision,
      last_mirror_rows,
      last_mirror_result
    FROM facturas_sync_state
    WHERE state_key = ?
    LIMIT 1
  `).get(FACTURAS_SYNC_STATE_KEY) || null;
}

function upsertFacturasSyncState(patch = {}) {
  const db = getDb();
  if (!db) return null;
  ensureFlagSchema();
  if (!isRetryWindowOpen()) return null;

  const current = getFacturasSyncState() || {
    state_key: FACTURAS_SYNC_STATE_KEY,
    dirty: 0,
    local_revision: 0,
    last_local_change_at: null,
    last_local_change_reason: null,
    last_local_change_count: 0,
    last_mirror_at: null,
    last_mirror_revision: 0,
    last_mirror_rows: 0,
    last_mirror_result: null,
  };

  const next = {
    ...current,
    ...patch,
    state_key: FACTURAS_SYNC_STATE_KEY,
  };

  db.prepare(`
    INSERT INTO facturas_sync_state (
      state_key,
      dirty,
      local_revision,
      last_local_change_at,
      last_local_change_reason,
      last_local_change_count,
      last_mirror_at,
      last_mirror_revision,
      last_mirror_rows,
      last_mirror_result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(state_key) DO UPDATE SET
      dirty = excluded.dirty,
      local_revision = excluded.local_revision,
      last_local_change_at = excluded.last_local_change_at,
      last_local_change_reason = excluded.last_local_change_reason,
      last_local_change_count = excluded.last_local_change_count,
      last_mirror_at = excluded.last_mirror_at,
      last_mirror_revision = excluded.last_mirror_revision,
      last_mirror_rows = excluded.last_mirror_rows,
      last_mirror_result = excluded.last_mirror_result
  `).run(
    next.state_key,
    Number(next.dirty || 0),
    Number(next.local_revision || 0),
    normalizeCfdiSyncValue(next.last_local_change_at),
    normalizeCfdiSyncValue(next.last_local_change_reason),
    Number(next.last_local_change_count || 0),
    normalizeCfdiSyncValue(next.last_mirror_at),
    Number(next.last_mirror_revision || 0),
    Number(next.last_mirror_rows || 0),
    normalizeCfdiSyncValue(next.last_mirror_result),
  );

  return next;
}

export function getFacturasLocalSyncState() {
  return getFacturasSyncState();
}

export function markFacturasLocalDirty({ reason = "local_update", changeCount = 0 } = {}) {
  const current = getFacturasSyncState() || { local_revision: 0 };
  const localRevision = Number(current.local_revision || 0) + 1;
  return upsertFacturasSyncState({
    dirty: 1,
    local_revision: localRevision,
    last_local_change_at: new Date().toISOString(),
    last_local_change_reason: reason,
    last_local_change_count: Number(changeCount || 0),
  });
}

export function clearFacturasLocalDirty({ rows = 0, result = "success" } = {}) {
  const current = getFacturasSyncState() || { local_revision: 0 };
  return upsertFacturasSyncState({
    dirty: 0,
    last_mirror_at: new Date().toISOString(),
    last_mirror_revision: Number(current.local_revision || 0),
    last_mirror_rows: Number(rows || 0),
    last_mirror_result: result,
  });
}

function syncTableRows(tableName, rows, keyField, mapper) {
  if (!Array.isArray(rows)) return;
  const db = getDb();
  if (!db) return;
  initSchema();
  if (!isRetryWindowOpen()) return;

  const controlColumns = new Set([
    "pdf_extraido",
    "pdf_extraido_fecha",
    "pdf_extraido_error",
    "sync_appsheet_estado",
    "sync_appsheet_fecha",
    "sync_origen_ultimo",
  ]);

  const mappedRows = rows
    .map((row) => mapper(row))
    .filter((row) => row?.[keyField] !== null && row?.[keyField] !== undefined && String(row?.[keyField]).trim() !== "");

  if (mappedRows.length > 0) {
    const remoteRows = mappedRows.map((row) => {
      const copy = { ...row };
      for (const column of controlColumns) {
        if (copy[column] === null || copy[column] === undefined) {
          delete copy[column];
        }
      }
      return copy;
    });
    upsertMany(tableName, remoteRows, keyField, (row) => row);
  }

  const localIds = db
    .prepare(`SELECT ${quoteIdentifier(keyField)} AS id FROM ${quoteIdentifier(tableName)}`)
    .all()
    .map((row) => String(row.id).trim())
    .filter(Boolean);
  const remoteIds = new Set(mappedRows.map((row) => String(row?.[keyField]).trim()).filter(Boolean));
  const toDelete = localIds.filter((id) => !remoteIds.has(id));
  if (toDelete.length > 0) {
    deleteByKeys(tableName, keyField, toDelete);
  }
}

function updateExtractionFlags(tableName, keyField, keyValue, flags = {}) {
  if (keyValue === undefined || keyValue === null || String(keyValue).trim() === "") return;
  const db = getDb();
  if (!db) return;
  ensureFlagSchema();
  if (!isRetryWindowOpen()) return;

  const keyText = String(keyValue).trim();
  const columns = [keyField, ...Object.keys(flags)];
  const placeholders = columns.map(() => "?").join(", ");
  const assignments = [];
  const values = [];
  for (const [column, value] of Object.entries(flags)) {
    assignments.push(`${quoteIdentifier(column)} = ?`);
    values.push(normalizeValue(value));
  }

  if (!assignments.length) return;

  const updateAssignments = Object.keys(flags).map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(", ");
  db.prepare(`
    INSERT INTO ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(${quoteIdentifier(keyField)}) DO UPDATE SET ${updateAssignments}
  `).run(keyText, ...values);
}

function getExtractionFlags(tableName, keyField, keyValue) {
  if (keyValue === undefined || keyValue === null || String(keyValue).trim() === "") return null;
  const db = getDb();
  if (!db) return null;
  ensureFlagSchema();
  if (!isRetryWindowOpen()) return null;
  return db.prepare(`
    SELECT
      pdf_extraido,
      pdf_extraido_fecha,
      pdf_extraido_error,
      sync_appsheet_estado,
      sync_appsheet_fecha,
      sync_origen_ultimo
    FROM ${quoteIdentifier(tableName)}
    WHERE ${quoteIdentifier(keyField)} = ?
    LIMIT 1
  `).get(String(keyValue).trim()) || null;
}

export function persistFacturasLocalRows(activeRows = [], cancelledRows = []) {
  const db = getDb();
  let localChanged = false;
  let changedCount = 0;
  let upsertedCount = 0;
  let deletedRows = [];
  if (db) {
    initSchema();
    if (!localDbUnavailable) {
      const ids = [...new Set(activeRows.map((row) => normalizeCfdiIdValue(row?.id ?? row?.ID ?? row?.["Row ID"] ?? row?.row_id ?? "")).filter(Boolean))];
      const existingById = new Map();
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(", ");
        const existingRows = db.prepare(`SELECT * FROM cfdis WHERE id IN (${placeholders})`).all(...ids);
        for (const row of existingRows) {
          existingById.set(String(row.id).trim(), row);
        }
      }

      const mergedRows = activeRows.map((row) => {
        const mapped = mapCfdiRow(row);
        const existing = mapped.id ? existingById.get(String(mapped.id).trim()) || null : null;
        const merged = mergeCfdiRow(mapped, existing);
        const changed = !existing || cfdiRowsDiffer(existing, merged);
        if (changed) {
          localChanged = true;
          changedCount += 1;
          return {
            ...merged,
            sync_appsheet_estado: "PENDIENTE",
            sync_appsheet_fecha: null,
            sync_appsheet_operacion: existing ? "EDIT" : "ADD",
            sync_origen_ultimo: "JOB_LOCAL",
          };
        }
        return merged;
      });
      upsertedCount = mergedRows.length;
      upsertMany("cfdis", mergedRows, "id", (row) => row);

      const cancelledIds = [...new Set(cancelledRows.map((row) => normalizeCfdiIdValue(row?.id)).filter(Boolean))];
      if (cancelledIds.length > 0) {
        const placeholders = cancelledIds.map(() => "?").join(", ");
        deletedRows = db.prepare(`SELECT * FROM cfdis WHERE id IN (${placeholders})`).all(...cancelledIds);
      }
    }
  }
  const deletedCount = deleteByKeys("cfdis", "id", cancelledRows.map((row) => normalizeCfdiIdValue(row?.id)));
  if (deletedCount > 0) {
    localChanged = true;
  }
  if (localChanged) {
    markFacturasLocalDirty({ reason: "cfdis_local_update", changeCount: changedCount + deletedCount });
  }
  return {
    changed: localChanged,
    changedCount,
    upsertedCount,
    deletedCount,
    deletedRows,
  };
}

export function deleteFacturasLocalRows(ids = []) {
  const normalizedIds = ids
    .map((id) => normalizeCfdiIdValue(id))
    .filter(Boolean);
  const deletedCount = deleteByKeys("cfdis", "id", normalizedIds);
  if (deletedCount > 0) {
    markFacturasLocalDirty({ reason: "cfdis_local_delete", changeCount: deletedCount });
  }
}

export function getFacturasLocalRows({ proveedor = null, period = null } = {}) {
  const db = getDb();
  if (!db) return [];
  initSchema();
  if (!isRetryWindowOpen()) return [];

  const where = [];
  const params = [];

  if (proveedor !== null && proveedor !== undefined && String(proveedor).trim() !== "") {
    where.push("UPPER(COALESCE(proveedor, '')) = UPPER(?)");
    params.push(String(proveedor).trim());
  }

  if (period !== null && period !== undefined && String(period).trim() !== "") {
    where.push("substr(fecha, 1, 7) = ?");
    params.push(String(period).trim());
  }

  const sql = `SELECT * FROM cfdis${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return db.prepare(sql).all(...params);
}

export function getFacturasPendingSyncRows() {
  const db = getDb();
  if (!db) return [];
  initSchema();
  if (!isRetryWindowOpen()) return [];

  return db.prepare(`
    SELECT * FROM cfdis
    WHERE UPPER(COALESCE(sync_appsheet_estado, 'PENDIENTE')) <> 'SINCRONIZADO'
    ORDER BY fecha ASC, id ASC
  `).all();
}

export function markFacturasRowsSyncState(ids = [], { syncState = "SINCRONIZADO", syncAt = new Date().toISOString(), origin = "APPSHEET" } = {}) {
  const normalizedIds = [...new Set(ids.map((id) => normalizeCfdiIdValue(id)).filter(Boolean))];
  if (!normalizedIds.length) return 0;
  const db = getDb();
  if (!db) return 0;
  initSchema();
  if (!isRetryWindowOpen()) return 0;

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const result = db.prepare(`
    UPDATE cfdis
    SET sync_appsheet_estado = ?,
        sync_appsheet_fecha = ?,
        sync_appsheet_operacion = CASE WHEN UPPER(?) = 'SINCRONIZADO' THEN NULL ELSE sync_appsheet_operacion END,
        sync_origen_ultimo = ?
    WHERE id IN (${placeholders})
  `).run(String(syncState || "PENDIENTE"), normalizeCfdiSyncValue(syncAt), String(syncState || "PENDIENTE"), String(origin || "APPSHEET"), ...normalizedIds);
  return Number(result?.changes || 0);
}

export function persistCasaLeyLocalRows({ pagosRows = [], relacionadosRows = [], facturasRows = [] } = {}) {
  return {
    pagos: persistCasaLeyScopeRows("pagos", pagosRows),
    relacionados: persistCasaLeyScopeRows("relacionados", relacionadosRows),
    facturas: persistCasaLeyScopeRows("facturas", facturasRows),
  };
}

export function replaceCasaLeyLocalRows({ pagosRows = [], relacionadosRows = [], facturasRows = [] } = {}) {
  replaceMany("cheques_ley", pagosRows, "referencia_pago", mapChequeRow);
  replaceMany("pagados_ley", relacionadosRows, "referencia", mapRelacionadoRow);
  replaceMany("facturas_en_ley", facturasRows, "folio_uuid", mapFacturaLeyRow);
  return {
    pagos: Array.isArray(pagosRows) ? pagosRows.length : 0,
    relacionados: Array.isArray(relacionadosRows) ? relacionadosRows.length : 0,
    facturas: Array.isArray(facturasRows) ? facturasRows.length : 0,
  };
}

export function mirrorCasaLeyTablesToSyncDb({ targetPath = process.env.DESARROLLOEG_SYNC_DB_PATH } = {}) {
  const sourceDb = getDb();
  const sourcePath = cachedDbPath ? path.resolve(cachedDbPath) : "";
  const resolvedTargetPath = String(targetPath || "").trim();
  if (!sourceDb || !resolvedTargetPath) {
    return { mirrored: false, reason: "missing_database", tables: {} };
  }

  const absoluteTargetPath = path.resolve(resolvedTargetPath);
  if (sourcePath && sourcePath === absoluteTargetPath) {
    return { mirrored: false, reason: "same_database", tables: {} };
  }

  ensureDir(absoluteTargetPath);
  const targetDb = new DatabaseSync(absoluteTargetPath);
  const insertOrder = ["cheques_ley", "facturas_en_ley", "pagados_ley"];
  const deleteOrder = [...insertOrder].reverse();
  const summary = {};
  try {
    targetDb.exec("PRAGMA busy_timeout = 10000;");
    // Pagados puede conservar relaciones historicas cuyo cheque queda fuera del rango consultado.
    targetDb.exec("PRAGMA foreign_keys = OFF;");
    targetDb.exec("BEGIN IMMEDIATE;");
    const preparedTables = new Map();
    for (const tableName of insertOrder) {
      const targetExists = targetDb.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
      if (!targetExists) {
        throw new Error(`La tabla destino ${tableName} no existe en la replica DesarrolloEG`);
      }

      const sourceColumns = sourceDb.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((column) => String(column.name));
      const targetColumns = new Set(targetDb.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((column) => String(column.name)));
      const columns = sourceColumns.filter((column) => targetColumns.has(column));
      if (!columns.length) {
        throw new Error(`No hay columnas compatibles para replicar ${tableName}`);
      }

      const columnSql = columns.map(quoteIdentifier).join(", ");
      const rows = sourceDb.prepare(`SELECT ${columnSql} FROM ${quoteIdentifier(tableName)}`).all();
      preparedTables.set(tableName, { columns, columnSql, rows });
    }

    for (const tableName of deleteOrder) {
      targetDb.prepare(`DELETE FROM ${quoteIdentifier(tableName)}`).run();
    }

    for (const tableName of insertOrder) {
      const { columns, columnSql, rows } = preparedTables.get(tableName);
      if (rows.length) {
        const placeholders = columns.map(() => "?").join(", ");
        const insert = targetDb.prepare(`INSERT INTO ${quoteIdentifier(tableName)} (${columnSql}) VALUES (${placeholders})`);
        for (const row of rows) {
          insert.run(...columns.map((column) => normalizeValue(row[column])));
        }
      }
      summary[tableName] = rows.length;
    }
    targetDb.exec("COMMIT;");
    targetDb.exec("PRAGMA foreign_keys = ON;");
    return { mirrored: true, sourcePath, targetPath: absoluteTargetPath, tables: summary };
  } catch (error) {
    try {
      targetDb.exec("ROLLBACK;");
    } catch {
      // La transaccion pudo fallar antes de iniciar.
    }
    try {
      targetDb.exec("PRAGMA foreign_keys = ON;");
    } catch {
      // La conexion se cerrara de todas formas.
    }
    throw error;
  } finally {
    targetDb.close();
  }
}

export function getCasaLeyPendingSyncRows(scope) {
  const config = getCasaLeyTableConfig(scope);
  if (!config) return [];
  const db = getDb();
  if (!db) return [];
  initSchema();
  if (!isRetryWindowOpen()) return [];

  return db.prepare(`
    SELECT * FROM ${quoteIdentifier(config.tableName)}
    WHERE UPPER(COALESCE(sync_appsheet_estado, 'PENDIENTE')) <> 'SINCRONIZADO'
    ORDER BY rowid ASC
  `).all();
}

export function markCasaLeyRowsSyncState(scope, keys = [], { syncState = "SINCRONIZADO", syncAt = new Date().toISOString(), origin = "APPSHEET" } = {}) {
  const config = getCasaLeyTableConfig(scope);
  if (!config) return 0;
  const cleanKeys = [...new Set(keys.map((key) => String(key ?? "").trim()).filter(Boolean))];
  if (!cleanKeys.length) return 0;
  const db = getDb();
  if (!db) return 0;
  initSchema();
  if (!isRetryWindowOpen()) return 0;

  const placeholders = cleanKeys.map(() => "?").join(", ");
  const result = db.prepare(`
    UPDATE ${quoteIdentifier(config.tableName)}
    SET sync_appsheet_estado = ?,
        sync_appsheet_fecha = ?,
        sync_appsheet_operacion = CASE WHEN UPPER(?) = 'SINCRONIZADO' THEN NULL ELSE sync_appsheet_operacion END,
        sync_origen_ultimo = ?
    WHERE ${quoteIdentifier(config.keyField)} IN (${placeholders})
  `).run(String(syncState || "PENDIENTE"), normalizeCfdiSyncValue(syncAt), String(syncState || "PENDIENTE"), String(origin || "APPSHEET"), ...cleanKeys);
  return Number(result?.changes || 0);
}

export function syncPedidosLeyLocalRows(rows = []) {
  syncTableRows("pedidos_ley", rows, "pedido", mapPedidoLeyRow);
}

export function syncLiberacionesLocalRows(rows = []) {
  syncTableRows("liberaciones", rows, "liberacion", mapLiberacionRow);
}

export function upsertPedidoLeyLocalRow(row) {
  upsertMany("pedidos_ley", [row], "pedido", mapPedidoLeyRow);
}

export function markPedidoLeySentLocal(
  pedido,
  enviado = true,
  {
    syncState = "PENDIENTE",
    syncAt = null,
    origin = "PLATAFORMA",
  } = {},
) {
  const pedidoValue = String(pedido ?? "").trim();
  if (!pedidoValue) return 0;
  const db = getDb();
  if (!db) return 0;
  initSchema();
  if (!isRetryWindowOpen()) return 0;

  const normalizedSyncState = String(syncState || "PENDIENTE").trim().toUpperCase();
  const result = db.prepare(`
    UPDATE pedidos_ley
    SET enviado = ?,
        sync_appsheet_estado = ?,
        sync_appsheet_fecha = ?,
        sync_appsheet_operacion = CASE
          WHEN ? = 'SINCRONIZADO' THEN NULL
          ELSE 'EDIT'
        END,
        sync_origen_ultimo = ?
    WHERE pedido = ?
  `).run(
    enviado === false ? null : "SI",
    normalizedSyncState,
    syncAt ? normalizeCfdiSyncValue(syncAt) : null,
    normalizedSyncState,
    String(origin || "PLATAFORMA"),
    pedidoValue,
  );
  return Number(result?.changes || 0);
}

export function upsertLiberacionLocalRow(row) {
  upsertMany("liberaciones", [row], "liberacion", mapLiberacionRow);
}

export function getPedidosLeyLocalRows() {
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM pedidos_ley ORDER BY rowid`).all() || [];
}

export function getLiberacionesLocalRows() {
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM liberaciones ORDER BY rowid`).all() || [];
}

export function getCfdisLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM cfdis ORDER BY rowid`).all() || [];
}

export function getFacturasEnLeyLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM facturas_en_ley ORDER BY rowid`).all() || [];
}

export function getPagadosLeyLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM pagados_ley ORDER BY rowid`).all() || [];
}

export function markPedidoExtractionState(pedido, { extracted = true, extractedAt = new Date().toISOString(), error = null, syncState = "PENDIENTE", syncAt = null, origin = "JOB_LOCAL" } = {}) {
  updateExtractionFlags("pedidos_ley", "pedido", pedido, {
    pdf_extraido: extracted ? 1 : 0,
    pdf_extraido_fecha: extracted ? extractedAt : null,
    pdf_extraido_error: error,
    sync_appsheet_estado: syncState,
    sync_appsheet_fecha: syncAt,
    sync_origen_ultimo: origin,
  });
}

export function markLiberacionExtractionState(liberacion, { extracted = true, extractedAt = new Date().toISOString(), error = null, syncState = "PENDIENTE", syncAt = null, origin = "JOB_LOCAL" } = {}) {
  updateExtractionFlags("liberaciones", "liberacion", liberacion, {
    pdf_extraido: extracted ? 1 : 0,
    pdf_extraido_fecha: extracted ? extractedAt : null,
    pdf_extraido_error: error,
    sync_appsheet_estado: syncState,
    sync_appsheet_fecha: syncAt,
    sync_origen_ultimo: origin,
  });
}

export function getPedidoExtractionState(pedido) {
  return getExtractionFlags("pedidos_ley", "pedido", pedido);
}

export function getLiberacionExtractionState(liberacion) {
  return getExtractionFlags("liberaciones", "liberacion", liberacion);
}

export function upsertEmpresasLocalRows(rows = []) {
  upsertMany("empresas", rows, "id", mapEmpresaRow);
}

export function upsertMunicipiosLocalRows(rows = []) {
  upsertMany("municipios", rows, "id", mapMunicipioRow);
}

export function upsertEstadosLocalRows(rows = []) {
  upsertMany("estados", rows, "id", mapEstadoRow);
}

export function upsertSucursalesLocalRows(rows = []) {
  upsertMany("sucursales", rows, "id", mapSucursalRow);
}

export function upsertEstatalesLocalRows(rows = []) {
  upsertMany("estatales", rows, "row_id", mapEstatalRow);
}

export function upsertMunicipalesLocalRows(rows = []) {
  upsertMany("municipales", rows, "row_id", mapMunicipalRow);
}

export function upsertEmpleadosLocalRows(rows = []) {
  upsertMany("empleados", rows, "row_id", mapEmpleadoRow);
}

export function upsertCapacitacionesLocalRows(rows = []) {
  upsertMany("capacitaciones", rows, "id", mapCapacitacionRow);
}

export function upsertCalendarioLocalRows(rows = []) {
  upsertMany("calendario", rows, "id", mapCalendarioRow);
}

export function upsertCalendarioEmpleadosLocalRows(rows = []) {
  upsertMany("calendario_empleados", rows, "id", mapCalendarioEmpleadoRow);
}

export function upsertCatalogoLocalRows(rows = []) {
  upsertMany("catalogo", rows, "id", mapCatalogoRow);
}

export function upsertProveedoresLocalRows(rows = []) {
  upsertMany("proveedores", rows, "id", mapProveedorRow);
}

export function upsertCotizacionesLocalRows(rows = []) {
  upsertMany("cotizaciones", rows, "id", mapCotizacionRow);
}

export function upsertCotizacionCentrosTrabajoLocalRows(rows = []) {
  upsertMany("cotizacion_centros_trabajo", rows, "id", mapCotizacionCentroTrabajoBridgeRow);
}

export function upsertConceptosCotizacionLocalRows(rows = []) {
  upsertMany("conceptos_cotizacion", rows, "id", mapConceptoCotizacionRow);
}

export function upsertCapacitacionSucursalesLocalRows(rows = []) {
  upsertMany("capacitacion_sucursales", rows, "id", mapCapacitacionSucursalBridgeRow);
}

export function upsertCapacitacionCapacitadoresLocalRows(rows = []) {
  upsertMany("capacitacion_capacitadores", rows, "id", mapCapacitacionCapacitadorBridgeRow);
}

export function upsertCapacitacionSucursalesBridgeRows(rows = []) {
  upsertMany("capacitacion_sucursales", rows, "id", mapCapacitacionSucursalBridgeRow);
}

export function replaceCalendarioEmpleadosLocalRows(rows = []) {
  replaceMany("calendario_empleados", rows, "id", mapCalendarioEmpleadoBridgeRow);
}

export function replaceCapacitacionSucursalesLocalRows(rows = []) {
  replaceMany("capacitacion_sucursales", rows, "id", mapCapacitacionSucursalBridgeRow);
}

export function replaceCapacitacionCapacitadoresLocalRows(rows = []) {
  replaceMany("capacitacion_capacitadores", rows, "id", mapCapacitacionCapacitadorBridgeRow);
}

export function replaceCotizacionCentrosTrabajoLocalRows(rows = []) {
  replaceMany("cotizacion_centros_trabajo", rows, "id", mapCotizacionCentroTrabajoBridgeRow);
}

export function replaceEstatalesLocalRows(rows = []) {
  replaceMany("estatales", rows, "row_id", mapEstatalRow);
}

export function replaceMunicipalesLocalRows(rows = []) {
  replaceMany("municipales", rows, "row_id", mapMunicipalRow);
}

export function deleteEstatalesLocalRows(keys = []) {
  return deleteByKeys("estatales", "row_id", keys);
}

export function deleteMunicipalesLocalRows(keys = []) {
  return deleteByKeys("municipales", "row_id", keys);
}

export function getCapacitacionSucursalesLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM capacitacion_sucursales ORDER BY capacitacion_id, orden, sucursal_id`).all() || [];
}

export function getCapacitacionCapacitadoresLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM capacitacion_capacitadores ORDER BY capacitacion_id, orden, empleado_id`).all() || [];
}

export function getEmpresasLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM empresas ORDER BY id`).all() || [];
}

export function getMunicipiosLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM municipios ORDER BY id`).all() || [];
}

export function getEstadosLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM estados ORDER BY id`).all() || [];
}

export function getSucursalesLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM sucursales ORDER BY id`).all() || [];
}

export function getEstatalesLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM estatales ORDER BY anio DESC, fecha DESC, row_id`).all() || [];
}

export function getMunicipalesLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM municipales ORDER BY anio DESC, fecha DESC, row_id`).all() || [];
}

export function getEmpleadosLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM empleados ORDER BY row_id`).all() || [];
}

export function getCapacitacionesLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM capacitaciones ORDER BY id`).all() || [];
}

export function getCalendarioLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM calendario ORDER BY id`).all() || [];
}

export function getCalendarioEmpleadosLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM calendario_empleados ORDER BY id`).all() || [];
}

export function getCatalogoLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM catalogo ORDER BY id`).all() || [];
}

export function getProveedoresLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM proveedores ORDER BY id`).all() || [];
}

export function getCotizacionesLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM cotizaciones ORDER BY id`).all() || [];
}

export function getCotizacionCentrosTrabajoLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM cotizacion_centros_trabajo ORDER BY cotizacion_id, orden, sucursal_id`).all() || [];
}

export function getConceptosCotizacionLocalRows() {
  initSchema();
  if (!isRetryWindowOpen()) return [];
  return getDb()?.prepare(`SELECT * FROM conceptos_cotizacion ORDER BY id`).all() || [];
}
