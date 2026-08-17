import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.DESARROLLOEG_LOCAL_DB_PATH || "/app/runtime/jobs/pedidos-local.sqlite";

let db = null;
let schemaReady = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDb() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    // Si el volumen no lo permite, seguimos con el modo por defecto.
  }
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch {
    // No es critico para las banderas.
  }
  return db;
}

function ensureSchema() {
  if (schemaReady) return;
  const currentDb = getDb();
  currentDb.exec(`
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
  currentDb.exec(`
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
  schemaReady = true;
}

async function upsertState(tableName, keyField, keyValue, flags = {}) {
  if (keyValue === undefined || keyValue === null || String(keyValue).trim() === "") return;
  ensureSchema();
  const currentDb = getDb();
  const columns = [keyField, ...Object.keys(flags)];
  const placeholders = columns.map(() => "?").join(", ");
  const updateAssignments = Object.keys(flags)
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  const values = [String(keyValue).trim(), ...Object.values(flags)];

  const stmt = currentDb.prepare(`
    INSERT INTO ${tableName} (${columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(${keyField}) DO UPDATE SET ${updateAssignments}
  `);

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      stmt.run(...values);
      return;
    } catch (error) {
      lastError = error;
      const isLocked = /locked/i.test(String(error?.message || ""));
      if (!isLocked || attempt === 4) break;
      await sleep(150 * (attempt + 1));
    }
  }

  throw lastError;
}

function getState(tableName, keyField, keyValue) {
  if (keyValue === undefined || keyValue === null || String(keyValue).trim() === "") return null;
  ensureSchema();
  const currentDb = getDb();
  return currentDb.prepare(`
    SELECT
      pdf_extraido,
      pdf_extraido_fecha,
      pdf_extraido_error,
      sync_appsheet_estado,
      sync_appsheet_fecha,
      sync_origen_ultimo
    FROM ${tableName}
    WHERE ${keyField} = ?
    LIMIT 1
  `).get(String(keyValue).trim()) || null;
}

export async function markPedidoExtractionState(pedido, { extracted = true, extractedAt = new Date().toISOString(), error = null, syncState = "PENDIENTE", syncAt = null, origin = "JOB_LOCAL" } = {}) {
  await upsertState("pedidos_ley", "pedido", pedido, {
    pdf_extraido: extracted ? 1 : 0,
    pdf_extraido_fecha: extracted ? extractedAt : null,
    pdf_extraido_error: error,
    sync_appsheet_estado: syncState,
    sync_appsheet_fecha: syncAt,
    sync_origen_ultimo: origin,
  });
}

export async function markLiberacionExtractionState(liberacion, { extracted = true, extractedAt = new Date().toISOString(), error = null, syncState = "PENDIENTE", syncAt = null, origin = "JOB_LOCAL" } = {}) {
  await upsertState("liberaciones", "liberacion", liberacion, {
    pdf_extraido: extracted ? 1 : 0,
    pdf_extraido_fecha: extracted ? extractedAt : null,
    pdf_extraido_error: error,
    sync_appsheet_estado: syncState,
    sync_appsheet_fecha: syncAt,
    sync_origen_ultimo: origin,
  });
}

export function getPedidoExtractionState(pedido) {
  return getState("pedidos_ley", "pedido", pedido);
}

export function getLiberacionExtractionState(liberacion) {
  return getState("liberaciones", "liberacion", liberacion);
}
