import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = "/app/desarrolloeg-sync-data/desarrolloeg.sqlite";
const FALLBACK_DB_PATHS = [
  process.env.DESARROLLOEG_LOCAL_DB_PATH,
  path.resolve(process.cwd(), "desarrolloeg-sync-data", "desarrolloeg.sqlite"),
  path.resolve(process.cwd(), "..", "appsheet_local_sync", "data", "desarrolloeg.sqlite"),
  path.resolve(process.cwd(), "appsheet_local_sync", "data", "desarrolloeg.sqlite"),
];

let cachedDb = null;
let cachedDbPath = "";
let dbUnavailableUntil = 0;

function uniquePaths(paths) {
  return [...new Set(paths.filter((value) => String(value || "").trim()).map((value) => String(value).trim()))];
}

function resolveDbCandidates() {
  const configured = String(process.env.DESARROLLOEG_SYNC_DB_PATH || "").trim();
  const candidates = [configured || DEFAULT_DB_PATH, ...FALLBACK_DB_PATHS];
  return uniquePaths(candidates);
}

function isRetryWindowOpen() {
  if (Date.now() >= dbUnavailableUntil) {
    dbUnavailableUntil = 0;
    return true;
  }
  return dbUnavailableUntil === 0;
}

function markDbUnavailable() {
  dbUnavailableUntil = Date.now() + 15000;
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch {
      // Ignoramos errores al cerrar la BD local.
    }
    cachedDb = null;
    cachedDbPath = "";
  }
}

function openCandidateDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch {
    // Si el volumen no lo permite, seguimos.
  }
  ensureCalendarNoteAuthorsTable(db);
  ensurePortalNotesTables(db);
  migrateLegacyCapacitacionNotes(db);
  db.prepare("SELECT 1 AS ok").get();
  return db;
}

export function openDesarrolloegSyncDb() {
  if (!isRetryWindowOpen()) return null;
  if (cachedDb) return cachedDb;

  let lastError = null;
  for (const dbPath of resolveDbCandidates()) {
    if (!fs.existsSync(dbPath)) continue;
    try {
      cachedDb = openCandidateDb(dbPath);
      cachedDbPath = dbPath;
      dbUnavailableUntil = 0;
      if (dbPath !== resolveDbCandidates()[0]) {
        console.warn(`[desarrolloegLocalDb] SQLite local usando respaldo: ${dbPath}`);
      }
      return cachedDb;
    } catch (error) {
      lastError = error;
      cachedDb = null;
      cachedDbPath = "";
    }
  }

  if (lastError) {
    console.warn(`[desarrolloegLocalDb] no se pudo abrir la BD local: ${lastError.message || lastError}`);
  }
  markDbUnavailable();
  return null;
}

export function readLocalRows(sql, params = []) {
  const db = openDesarrolloegSyncDb();
  if (!db) return [];
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    console.warn(`[desarrolloegLocalDb] consulta fallida: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

export function readLocalRow(sql, params = []) {
  const db = openDesarrolloegSyncDb();
  if (!db) return null;
  try {
    return db.prepare(sql).get(...params) || null;
  } catch (error) {
    console.warn(`[desarrolloegLocalDb] consulta fallida: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

function ensureCalendarNoteAuthorsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendario_autores (
      calendario_id TEXT PRIMARY KEY,
      creado_por_id TEXT,
      creado_por_nombre TEXT,
      creado_por_correo TEXT,
      creado_en TEXT NOT NULL,
      actualizado_por_id TEXT,
      actualizado_por_nombre TEXT,
      actualizado_por_correo TEXT,
      actualizado_en TEXT NOT NULL
    );
  `);
}

function ensurePortalNotesTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_notas (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT,
      author_email TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_portal_notas_entity
      ON portal_notas(entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_portal_notas_author
      ON portal_notas(author_id, author_email, created_at);

    CREATE TABLE IF NOT EXISTS portal_nota_menciones (
      note_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      PRIMARY KEY (note_id, employee_id),
      FOREIGN KEY (note_id) REFERENCES portal_notas(id) ON DELETE CASCADE
    );
  `);
}

function migrateLegacyCapacitacionNotes(db) {
  const hasCapacitaciones = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'capacitaciones'").get();
  if (!hasCapacitaciones) return;

  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(row_id), ''), TRIM(id)) AS entity_id,
           TRIM(notas) AS body,
           COALESCE(NULLIF(TRIM(sync_appsheet_fecha), ''), fecha_capacitacion) AS source_date
      FROM capacitaciones
     WHERE TRIM(COALESCE(notas, '')) <> ''
       AND COALESCE(NULLIF(TRIM(row_id), ''), TRIM(id)) <> ''
  `).all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO portal_notas (
      id, entity_type, entity_id, author_id, author_name, author_email,
      body, created_at, updated_at, deleted_at
    ) VALUES (?, 'capacitacion', ?, '', 'Importada de AppSheet', '', ?, ?, ?, NULL)
  `);
  const fallbackDate = new Date(0).toISOString();
  for (const row of rows) {
    const id = `legacy-${crypto.createHash("sha1").update(`${row.entity_id}\n${row.body}`).digest("hex")}`;
    const sourceDate = String(row.source_date || "").trim();
    const parsedDate = sourceDate ? new Date(sourceDate) : null;
    const createdAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : fallbackDate;
    insert.run(id, row.entity_id, row.body, createdAt, createdAt);
  }
}

function normalizePortalNoteRow(row = {}) {
  return {
    id: String(row.id || ""),
    entityType: String(row.entity_type || ""),
    entityId: String(row.entity_id || ""),
    authorId: String(row.author_id || ""),
    authorName: String(row.author_name || ""),
    authorEmail: String(row.author_email || ""),
    body: String(row.body || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    mentions: String(row.mention_ids || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

export function listPortalNoteEntries({ entityType = "", entityIds = [] } = {}) {
  const db = openDesarrolloegSyncDb();
  if (!db) return [];
  const normalizedType = String(entityType || "").trim().toLowerCase();
  const ids = [...new Set((Array.isArray(entityIds) ? entityIds : [entityIds])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  const clauses = ["n.deleted_at IS NULL"];
  const params = [];
  if (normalizedType) {
    clauses.push("n.entity_type = ?");
    params.push(normalizedType);
  }
  if (ids.length) {
    clauses.push(`n.entity_id IN (${ids.map(() => "?").join(", ")})`);
    params.push(...ids);
  }
  try {
    ensurePortalNotesTables(db);
    return db.prepare(`
      SELECT n.*, group_concat(m.employee_id, ',') AS mention_ids
        FROM portal_notas n
        LEFT JOIN portal_nota_menciones m ON m.note_id = n.id
       WHERE ${clauses.join(" AND ")}
       GROUP BY n.id
       ORDER BY n.created_at ASC, n.id ASC
    `).all(...params).map(normalizePortalNoteRow);
  } catch (error) {
    console.warn(`[desarrolloegLocalDb] no se pudieron leer los hilos de notas: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

export function createPortalNoteEntry({ entityType, entityId, body, author = {}, mentions = [] } = {}) {
  const db = openDesarrolloegSyncDb();
  if (!db) throw new Error("La base local no esta disponible para guardar la nota.");
  const normalizedType = String(entityType || "").trim().toLowerCase();
  const normalizedId = String(entityId || "").trim();
  const normalizedBody = String(body || "").trim();
  if (!normalizedType || !normalizedId || !normalizedBody) {
    throw new Error("La nota requiere entidad, registro y contenido.");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const mentionIds = [...new Set((Array.isArray(mentions) ? mentions : [mentions])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  ensurePortalNotesTables(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO portal_notas (
        id, entity_type, entity_id, author_id, author_name, author_email,
        body, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      normalizedType,
      normalizedId,
      String(author?.rowId || author?.id || "").trim(),
      String(author?.nombre || author?.name || "").trim(),
      String(author?.correo || author?.email || "").trim().toLowerCase(),
      normalizedBody,
      now,
      now,
    );
    const insertMention = db.prepare("INSERT OR IGNORE INTO portal_nota_menciones (note_id, employee_id) VALUES (?, ?)");
    mentionIds.forEach((employeeId) => insertMention.run(id, employeeId));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listPortalNoteEntries({ entityType: normalizedType, entityIds: [normalizedId] }).find((note) => note.id === id);
}

export function updatePortalNoteEntry(noteId, body) {
  const db = openDesarrolloegSyncDb();
  if (!db) throw new Error("La base local no esta disponible para actualizar la nota.");
  const id = String(noteId || "").trim();
  const normalizedBody = String(body || "").trim();
  if (!id || !normalizedBody) throw new Error("La nota requiere identificador y contenido.");
  ensurePortalNotesTables(db);
  const result = db.prepare(`
    UPDATE portal_notas
       SET body = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL
  `).run(normalizedBody, new Date().toISOString(), id);
  if (!result.changes) throw new Error("La nota no existe o ya fue eliminada.");
  return readLocalRow("SELECT * FROM portal_notas WHERE id = ?", [id]);
}

export function deletePortalNoteEntry(noteId) {
  const db = openDesarrolloegSyncDb();
  if (!db) throw new Error("La base local no esta disponible para eliminar la nota.");
  const id = String(noteId || "").trim();
  if (!id) throw new Error("No se pudo identificar la nota.");
  ensurePortalNotesTables(db);
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE portal_notas
       SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL
  `).run(now, now, id);
  if (!result.changes) throw new Error("La nota no existe o ya fue eliminada.");
  return true;
}

export function upsertCalendarNoteAuthor(calendarId, author = {}, { isNew = false } = {}) {
  const id = String(calendarId || "").trim();
  if (!id) return;

  const db = openDesarrolloegSyncDb();
  if (!db) return;
  const now = new Date().toISOString();
  const authorId = String(author?.rowId || author?.id || "").trim();
  const authorName = String(author?.nombre || author?.name || "").trim();
  const authorEmail = String(author?.correo || author?.email || "").trim().toLowerCase();

  try {
    ensureCalendarNoteAuthorsTable(db);
    if (isNew) {
      db.prepare(`
        INSERT INTO calendario_autores (
          calendario_id, creado_por_id, creado_por_nombre, creado_por_correo, creado_en,
          actualizado_por_id, actualizado_por_nombre, actualizado_por_correo, actualizado_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(calendario_id) DO UPDATE SET
          actualizado_por_id = excluded.actualizado_por_id,
          actualizado_por_nombre = excluded.actualizado_por_nombre,
          actualizado_por_correo = excluded.actualizado_por_correo,
          actualizado_en = excluded.actualizado_en
      `).run(id, authorId, authorName, authorEmail, now, authorId, authorName, authorEmail, now);
      return;
    }

    db.prepare(`
      UPDATE calendario_autores
         SET actualizado_por_id = ?,
             actualizado_por_nombre = ?,
             actualizado_por_correo = ?,
             actualizado_en = ?
       WHERE calendario_id = ?
    `).run(authorId, authorName, authorEmail, now, id);
  } catch (error) {
    console.warn(`[desarrolloegLocalDb] no se pudo guardar el autor de la nota: ${error instanceof Error ? error.message : error}`);
  }
}

export function deleteCalendarNoteAuthor(calendarId) {
  const id = String(calendarId || "").trim();
  if (!id) return;

  const db = openDesarrolloegSyncDb();
  if (!db) return;
  try {
    ensureCalendarNoteAuthorsTable(db);
    db.prepare("DELETE FROM calendario_autores WHERE calendario_id = ?").run(id);
  } catch (error) {
    console.warn(`[desarrolloegLocalDb] no se pudo eliminar el autor de la nota: ${error instanceof Error ? error.message : error}`);
  }
}

export function getLocalDbPath() {
  return cachedDbPath || resolveDbCandidates()[0] || DEFAULT_DB_PATH;
}

export function closeDesarrolloegSyncDb() {
  if (cachedDb) cachedDb.close();
  cachedDb = null;
  cachedDbPath = "";
  dbUnavailableUntil = 0;
}
