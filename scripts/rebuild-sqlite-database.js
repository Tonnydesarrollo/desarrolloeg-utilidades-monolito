import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [, , sourceArg, targetArg] = process.argv;
if (!sourceArg || !targetArg) {
  throw new Error("Uso: node scripts/rebuild-sqlite-database.js <origen> <destino>");
}

const sourcePath = path.resolve(sourceArg);
const targetPath = path.resolve(targetArg);
if (!fs.existsSync(sourcePath)) throw new Error(`No existe la base origen: ${sourcePath}`);
if (fs.existsSync(targetPath)) throw new Error(`La base destino ya existe: ${targetPath}`);
fs.mkdirSync(path.dirname(targetPath), { recursive: true });

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function fallbackValue(column) {
  const type = String(column.type || "").toUpperCase();
  if (type.includes("INT") || type.includes("REAL") || type.includes("NUM")) return 0;
  if (type.includes("BLOB")) return Buffer.alloc(0);
  return "";
}

function normalizeValue(value, column, targetDb) {
  if (value === null || value === undefined) {
    if (!column.notnull) return null;
    if (column.dflt_value !== null && column.dflt_value !== undefined) {
      try {
        return targetDb.prepare(`SELECT ${column.dflt_value} AS value`).get().value;
      } catch {
        // Fall through to a type-safe value when a legacy default cannot be evaluated.
      }
    }
    return fallbackValue(column);
  }

  const type = String(column.type || "").toUpperCase();
  if (type.includes("TEXT") || type.includes("CHAR") || type.includes("CLOB")) return String(value);
  if (type.includes("INT")) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : null;
  }
  if (type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB") || type.includes("NUM")) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return value;
}

const sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
const targetDb = new DatabaseSync(targetPath);
const summary = {};

try {
  targetDb.exec("PRAGMA foreign_keys = OFF; PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE;");
  const tables = sourceDb.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    ORDER BY name
  `).all();

  for (const table of tables) {
    targetDb.exec(table.sql);
    const columns = sourceDb.prepare(`PRAGMA table_info(${quoteIdentifier(table.name)})`).all();
    const columnSql = columns.map((column) => quoteIdentifier(column.name)).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const rows = sourceDb.prepare(`SELECT ${columnSql} FROM ${quoteIdentifier(table.name)} NOT INDEXED`).all();
    const insert = targetDb.prepare(`INSERT OR REPLACE INTO ${quoteIdentifier(table.name)} (${columnSql}) VALUES (${placeholders})`);
    for (const row of rows) {
      insert.run(...columns.map((column) => normalizeValue(row[column.name], column, targetDb)));
    }
    summary[table.name] = {
      source: rows.length,
      target: targetDb.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`).get().count,
    };
  }

  const schemaObjects = sourceDb.prepare(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL
    ORDER BY CASE type WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END, name
  `).all();
  for (const object of schemaObjects) targetDb.exec(object.sql);

  targetDb.exec("COMMIT;");
  const integrity = targetDb.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error(`La base reconstruida no supero integrity_check: ${JSON.stringify(integrity)}`);
  }
  console.log(JSON.stringify({ ok: true, sourcePath, targetPath, summary, integrity }, null, 2));
} catch (error) {
  try {
    targetDb.exec("ROLLBACK;");
  } catch {
    // The transaction may already be closed.
  }
  throw error;
} finally {
  sourceDb.close();
  targetDb.close();
}
