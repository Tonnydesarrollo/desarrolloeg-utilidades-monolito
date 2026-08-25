import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_CACHE_TTL_MS = Number(process.env.PLATFORM_CACHE_TTL_MS || process.env.PORTAL_CACHE_TTL_MS || 5 * 60 * 1000);
const DEFAULT_CACHE_DB_PATH = String(
  process.env.PLATFORM_CACHE_DB_PATH ||
  path.resolve(process.cwd(), "runtime", "cache", "platform-cache.sqlite")
).trim();

let db = null;
let schemaReady = false;
const memoryEntries = new Map();
const pendingLoads = new Map();

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizePart(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildCacheId(namespace, cacheKey) {
  return `${normalizePart(namespace)}::${normalizePart(cacheKey || "shared")}`;
}

function stableClone(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => stableClone(item));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b, "es"))) {
      output[key] = stableClone(value[key]);
    }
    return output;
  }
  return value;
}

function computeHash(value) {
  return crypto.createHash("sha1").update(JSON.stringify(stableClone(value))).digest("hex");
}

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function getDb() {
  if (db) return db;

  ensureDir(DEFAULT_CACHE_DB_PATH);
  db = new DatabaseSync(DEFAULT_CACHE_DB_PATH);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    // Algunos volúmenes no aceptan WAL; seguimos con el modo disponible.
  }
  try {
    db.exec("PRAGMA synchronous = NORMAL;");
  } catch {
    // No es crítico para la caché.
  }
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch {
    // No es crítico para la caché.
  }
  return db;
}

function ensureSchema() {
  if (schemaReady) return;
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS platform_cache_entries (
      namespace TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      meta_json TEXT,
      source TEXT,
      loaded_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (namespace, cache_key)
    );
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_platform_cache_entries_expires_at
    ON platform_cache_entries (expires_at);
  `);
  schemaReady = true;
}

function normalizeEntryRow(row) {
  if (!row) return null;
  const payload = parseJson(row.payload_json, null);
  if (payload === null) return null;
  return {
    namespace: String(row.namespace || "").trim(),
    cacheKey: String(row.cache_key || "shared").trim() || "shared",
    payload,
    payloadHash: String(row.payload_hash || "").trim(),
    meta: parseJson(row.meta_json, null),
    source: String(row.source || "").trim(),
    loadedAt: Number(row.loaded_at || 0),
    expiresAt: Number(row.expires_at || 0),
  };
}

function isEntryFresh(entry, ttlMs = DEFAULT_CACHE_TTL_MS) {
  if (!entry) return false;
  const loadedAt = Number(entry.loadedAt || 0);
  return loadedAt > 0 && (Date.now() - loadedAt) < ttlMs;
}

function readEntryFromDb(namespace, cacheKey) {
  ensureSchema();
  const row = getDb().prepare(
    `SELECT namespace, cache_key, payload_json, payload_hash, meta_json, source, loaded_at, expires_at
       FROM platform_cache_entries
      WHERE namespace = ? AND cache_key = ?
      LIMIT 1`
  ).get(normalizePart(namespace), normalizePart(cacheKey || "shared"));
  return normalizeEntryRow(row);
}

export function getPersistentCacheEntry(namespace, cacheKey = "shared", { allowStale = false } = {}) {
  const id = buildCacheId(namespace, cacheKey);
  const memory = memoryEntries.get(id);
  if (memory && (allowStale || isEntryFresh(memory))) {
    return memory;
  }

  const entry = readEntryFromDb(namespace, cacheKey);
  if (!entry) return null;
  memoryEntries.set(id, entry);
  if (allowStale || isEntryFresh(entry)) {
    return entry;
  }
  return null;
}

export function setPersistentCacheEntry(namespace, cacheKey = "shared", payload, { ttlMs = DEFAULT_CACHE_TTL_MS, meta = null, source = "appsheet" } = {}) {
  ensureSchema();
  const normalizedNamespace = normalizePart(namespace);
  const normalizedKey = normalizePart(cacheKey || "shared") || "shared";
  const loadedAt = Date.now();
  const expiresAt = loadedAt + Math.max(1, Number(ttlMs) || DEFAULT_CACHE_TTL_MS);
  const normalizedPayload = stableClone(payload);
  const payloadJson = JSON.stringify(normalizedPayload);
  const entry = {
    namespace: normalizedNamespace,
    cacheKey: normalizedKey,
    payload: normalizedPayload,
    payloadHash: computeHash(normalizedPayload),
    meta: stableClone(meta),
    source: String(source || "").trim(),
    loadedAt,
    expiresAt,
  };

  memoryEntries.set(buildCacheId(namespace, cacheKey), entry);
  getDb().prepare(`
    INSERT INTO platform_cache_entries (
      namespace, cache_key, payload_json, payload_hash, meta_json, source, loaded_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(namespace, cache_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      payload_hash = excluded.payload_hash,
      meta_json = excluded.meta_json,
      source = excluded.source,
      loaded_at = excluded.loaded_at,
      expires_at = excluded.expires_at
  `).run(
    normalizedNamespace,
    normalizedKey,
    payloadJson,
    entry.payloadHash,
    entry.meta === undefined ? null : JSON.stringify(entry.meta),
    entry.source || null,
    loadedAt,
    expiresAt
  );

  return entry;
}

export function comparePersistentCacheEntry(namespace, cacheKey = "shared", payload) {
  const existing = getPersistentCacheEntry(namespace, cacheKey, { allowStale: true });
  const nextPayload = stableClone(payload);
  const nextHash = computeHash(nextPayload);
  return {
    existing,
    nextPayload,
    nextHash,
    matched: Boolean(existing?.payloadHash && existing.payloadHash === nextHash),
  };
}

export function primePersistentCacheNamespaces(entries = []) {
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  for (const entry of normalizedEntries) {
    if (!entry) continue;
    if (typeof entry === "string") {
      getPersistentCacheEntry(entry, "shared", { allowStale: true });
      continue;
    }

    const namespace = String(entry.namespace || "").trim();
    const cacheKey = String(entry.cacheKey || "shared").trim() || "shared";
    if (!namespace) continue;
    getPersistentCacheEntry(namespace, cacheKey, { allowStale: true });
  }
}

export function deletePersistentCacheEntry(namespace, cacheKey = "shared") {
  const normalizedNamespace = normalizePart(namespace);
  const normalizedKey = normalizePart(cacheKey || "shared") || "shared";
  memoryEntries.delete(buildCacheId(namespace, cacheKey));
  if (!schemaReady) return;
  getDb().prepare(
    "DELETE FROM platform_cache_entries WHERE namespace = ? AND cache_key = ?"
  ).run(normalizedNamespace, normalizedKey);
}

export function deletePersistentCacheNamespace(namespace) {
  const normalizedNamespace = normalizePart(namespace);
  if (!normalizedNamespace) return;
  for (const key of memoryEntries.keys()) {
    if (key.startsWith(`${normalizedNamespace}::`)) {
      memoryEntries.delete(key);
    }
  }
  if (!schemaReady) return;
  getDb().prepare(
    "DELETE FROM platform_cache_entries WHERE namespace = ?"
  ).run(normalizedNamespace);
}

export function listPersistentCacheEntries(namespace = "") {
  ensureSchema();
  const normalizedNamespace = normalizePart(namespace);
  const query = normalizedNamespace
    ? `SELECT namespace, cache_key, payload_json, payload_hash, meta_json, source, loaded_at, expires_at
         FROM platform_cache_entries
        WHERE namespace = ?
        ORDER BY loaded_at DESC`
    : `SELECT namespace, cache_key, payload_json, payload_hash, meta_json, source, loaded_at, expires_at
         FROM platform_cache_entries
        ORDER BY loaded_at DESC`;
  const rows = normalizedNamespace
    ? getDb().prepare(query).all(normalizedNamespace)
    : getDb().prepare(query).all();
  return rows.map(normalizeEntryRow).filter(Boolean);
}

export async function refreshPersistentCacheEntry({
  namespace,
  cacheKey = "shared",
  loader,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  source = "appsheet",
  metaFactory = null,
  allowStaleFallback = true,
  force = false,
} = {}) {
  if (typeof loader !== "function") {
    throw new Error("Se requiere un loader para refrescar la caché.");
  }

  const normalizedNamespace = normalizePart(namespace);
  const normalizedKey = normalizePart(cacheKey || "shared") || "shared";
  const cacheId = buildCacheId(normalizedNamespace, normalizedKey);
  const existing = getPersistentCacheEntry(normalizedNamespace, normalizedKey, { allowStale: true });
  if (!force && isEntryFresh(existing, ttlMs)) {
    return {
      entry: existing,
      changed: false,
      matched: true,
      existing,
      nextHash: existing.payloadHash,
      reused: true,
    };
  }

  if (!force && pendingLoads.has(cacheId)) {
    return pendingLoads.get(cacheId);
  }

  const pending = (async () => {
    try {
      const payload = await loader({ existing, force });
      const comparison = comparePersistentCacheEntry(normalizedNamespace, normalizedKey, payload);
      const entry = comparison.matched && existing
        ? existing
        : setPersistentCacheEntry(normalizedNamespace, normalizedKey, payload, {
            ttlMs,
            source,
            meta: typeof metaFactory === "function" ? metaFactory(payload, existing, comparison) : metaFactory,
          });

      return {
        entry,
        changed: !comparison.matched,
        matched: comparison.matched,
        existing,
        nextHash: comparison.nextHash,
        reused: false,
      };
    } catch (error) {
      if (allowStaleFallback && existing) {
        return {
          entry: existing,
          changed: false,
          matched: true,
          existing,
          nextHash: existing.payloadHash,
          reused: true,
          error,
        };
      }
      throw error;
    } finally {
      pendingLoads.delete(cacheId);
    }
  })();

  pendingLoads.set(cacheId, pending);
  return pending;
}

export function getPersistentCacheSummary(namespace = "") {
  const entries = listPersistentCacheEntries(namespace);
  const latest = entries[0] || null;
  return {
    dbPath: DEFAULT_CACHE_DB_PATH,
    count: entries.length,
    latestLoadedAt: latest?.loadedAt || null,
    latestExpiresAt: latest?.expiresAt || null,
    latestNamespace: latest?.namespace || null,
    latestKey: latest?.cacheKey || null,
    entries: entries.map((entry) => ({
      namespace: entry.namespace,
      cacheKey: entry.cacheKey,
      loadedAt: entry.loadedAt,
      expiresAt: entry.expiresAt,
      payloadHash: entry.payloadHash,
      source: entry.source,
      meta: entry.meta,
    })),
  };
}
