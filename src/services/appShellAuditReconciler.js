import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { reconcilePortalCaches } from "../modules/home/portalAuth.service.js";
import { prewarmFacturacionCaches } from "../modules/facturacion/services/appsheet.js";
import {
  getPersistentCacheEntry,
  primePersistentCacheNamespaces,
  setPersistentCacheEntry,
} from "./platformCache.js";

const AUDIT_CURSOR_NAMESPACE = "appsheet.audit.cursor";
const AUDIT_CURSOR_KEY = "shared";
const AUDIT_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const AUDIT_SNAPSHOT_DIR = path.resolve(
  process.env.RUNTIME_DIR || path.join(process.cwd(), "runtime"),
  "cache",
  "audit-snapshots",
);

const PORTAL_TABLES = new Set([
  "EMPRESAS",
  "SUCURSALES",
  "MUNICIPIOS",
  "ESTADOS",
  "EMPLEADOS",
  "CAPACITACIONES",
  "CALENDARIO",
  "STATUS SISTEMA PC",
]);

const FACTURACION_TABLES = new Set([
  "EMPRESAS",
  "SUCURSALES",
  "MUNICIPIOS",
  "ESTADOS",
  "COTIZACIONES_VARIOS_CT",
  "CONCEPTOS_VARIOS_CT",
  "CATALOGO",
  "PROVEEDORES",
  "ESTATALES",
  "MUNICIPALES",
]);

const PORTAL_CACHE_NAMESPACES = [
  "portal.employees",
  "portal.sucursales",
  "portal.capacitaciones",
  "portal.calendar-notes",
];

const FACTURACION_CACHE_NAMESPACES = [
  "facturacion.tables.cotizaciones_varios_ct",
  "facturacion.tables.conceptos_varios_ct",
  "facturacion.tables.empresas",
  "facturacion.tables.municipios",
  "facturacion.tables.estados",
  "facturacion.tables.sucursales",
  "facturacion.tables.catalogo",
  "facturacion.tables.proveedores",
  "facturacion.cotizacion-completa",
];

function normalizeScope(scope = "all") {
  const value = String(scope || "").trim().toLowerCase();
  if (!value) return "all";
  if (["portal", "portal-v2", "desarrolloeg", "v2"].includes(value)) return "portal";
  if (["facturacion", "finanzas", "finance", "cotizaciones"].includes(value)) return "facturacion";
  if (["all", "todo", "general", "completo"].includes(value)) return "all";
  return value;
}

function normalizeTableName(value) {
  return String(value || "").trim().toUpperCase();
}

function getAuditDbCandidates() {
  const configured = String(process.env.DESARROLLOEG_SYNC_DB_PATH || "").trim();
  const candidates = [
    configured,
    "/app/desarrolloeg-sync-data/desarrolloeg.sqlite",
    path.resolve(process.cwd(), "desarrolloeg-sync-data", "desarrolloeg.sqlite"),
    path.resolve(process.cwd(), "..", "appsheet_local_sync", "data", "desarrolloeg.sqlite"),
    path.resolve(process.cwd(), "appsheet_local_sync", "data", "desarrolloeg.sqlite"),
  ].filter(Boolean);

  return [...new Set(candidates.map((candidate) => String(candidate).trim()).filter(Boolean))];
}

function ensureAuditSnapshotDir() {
  if (!fs.existsSync(AUDIT_SNAPSHOT_DIR)) {
    fs.mkdirSync(AUDIT_SNAPSHOT_DIR, { recursive: true });
  }
}

function cleanupAuditSnapshot(files = []) {
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      fs.unlinkSync(file);
    } catch {
      // Ignoramos limpieza fallida; el siguiente snapshot puede reutilizar el directorio.
    }
  }
}

function createAuditSnapshot(sourcePath) {
  ensureAuditSnapshotDir();
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const snapshotDbPath = path.join(AUDIT_SNAPSHOT_DIR, `desarrolloeg-audit-${stamp}.sqlite`);
  const snapshotWalPath = `${snapshotDbPath}-wal`;
  const snapshotShmPath = `${snapshotDbPath}-shm`;

  fs.copyFileSync(sourcePath, snapshotDbPath);

  const sourceWalPath = `${sourcePath}-wal`;
  if (fs.existsSync(sourceWalPath)) {
    try {
      fs.copyFileSync(sourceWalPath, snapshotWalPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const sourceShmPath = `${sourcePath}-shm`;
  if (fs.existsSync(sourceShmPath)) {
    try {
      fs.copyFileSync(sourceShmPath, snapshotShmPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return {
    snapshotDbPath,
    cleanupPaths: [snapshotDbPath, snapshotWalPath, snapshotShmPath],
  };
}

function openAuditDb() {
  for (const candidate of getAuditDbCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    let snapshot = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        snapshot = createAuditSnapshot(candidate);
        const db = new Database(snapshot.snapshotDbPath, { readonly: true, fileMustExist: true });
        return {
          db,
          cleanup: () => cleanupAuditSnapshot(snapshot.cleanupPaths),
          sourcePath: candidate,
          snapshotPath: snapshot.snapshotDbPath,
        };
      } catch (error) {
        cleanupAuditSnapshot(snapshot?.cleanupPaths || []);
        if (attempt >= 3) throw error;
      }
    }
  }
  return null;
}

function readAuditCursor() {
  const entry = getPersistentCacheEntry(AUDIT_CURSOR_NAMESPACE, AUDIT_CURSOR_KEY, { allowStale: true });
  const payload = entry?.payload || {};
  const cursor = Number(payload.lastAuditIdByScope?.all || payload.lastAuditId || payload.cursor || 0);
  return Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
}

function readAuditCursorForScope(scope = "all") {
  const normalizedScope = normalizeScope(scope);
  const entry = getPersistentCacheEntry(AUDIT_CURSOR_NAMESPACE, AUDIT_CURSOR_KEY, { allowStale: true });
  const payload = entry?.payload || {};
  const cursor = Number(payload.lastAuditIdByScope?.[normalizedScope] || 0);
  return Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
}

function writeAuditCursor(scope, lastAuditId, { tables = [], source = "appsheet-audit" } = {}) {
  const cursor = Number(lastAuditId || 0);
  if (!Number.isFinite(cursor) || cursor <= 0) return null;

  const normalizedScope = normalizeScope(scope);
  const existing = getPersistentCacheEntry(AUDIT_CURSOR_NAMESPACE, AUDIT_CURSOR_KEY, { allowStale: true })?.payload || {};
  const lastAuditIdByScope = {
    ...(existing.lastAuditIdByScope || {}),
  };
  lastAuditIdByScope[normalizedScope] = cursor;

  return setPersistentCacheEntry(
    AUDIT_CURSOR_NAMESPACE,
    AUDIT_CURSOR_KEY,
    {
      lastAuditId: cursor,
      lastAuditIdByScope,
      updatedAt: new Date().toISOString(),
      tables,
    },
    {
      ttlMs: AUDIT_CACHE_TTL_MS,
      source,
      meta: {
        lastAuditId: cursor,
        lastAuditIdByScope,
        tables,
      },
    }
  );
}

function getScopesForAuditTable(tableName) {
  const normalized = normalizeTableName(tableName);
  if (!normalized) return [];
  const scopes = [];
  if (PORTAL_TABLES.has(normalized)) scopes.push("portal");
  if (FACTURACION_TABLES.has(normalized)) scopes.push("facturacion");
  return scopes;
}

function primeAppShellCacheMemory() {
  primePersistentCacheNamespaces([
    ...PORTAL_CACHE_NAMESPACES,
    ...FACTURACION_CACHE_NAMESPACES,
    { namespace: AUDIT_CURSOR_NAMESPACE, cacheKey: AUDIT_CURSOR_KEY },
  ]);
}

async function refreshScope(scope, runAsUserEmail = "") {
  if (scope === "portal") {
    return reconcilePortalCaches({ runAsUserEmail });
  }

  if (scope === "facturacion") {
    prewarmFacturacionCaches();
    return {
      ok: true,
      scope: "facturacion",
      localSyncSkipped: true,
      source: "local-audit",
      warmed: true,
    };
  }

  return { ok: false, scope, skipped: true, reason: "unsupported_scope" };
}

export function bootstrapAppShellCaches() {
  primeAppShellCacheMemory();
  return {
    ok: true,
    primed: true,
    cursor: readAuditCursor(),
  };
}

export function getAppShellAuditState(scope = "all") {
  const normalizedScope = normalizeScope(scope);
  const entry = getPersistentCacheEntry(AUDIT_CURSOR_NAMESPACE, AUDIT_CURSOR_KEY, { allowStale: true });
  const payload = entry?.payload || {};
  const lastAuditIdByScope = payload.lastAuditIdByScope || {};
  const cursor = Number(
    normalizedScope === "all"
      ? payload.lastAuditId || payload.lastAuditIdByScope?.all || payload.cursor || 0
      : lastAuditIdByScope[normalizedScope] || 0
  );

  return {
    ok: true,
    scope: normalizedScope,
    cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : 0,
    updatedAt: payload.updatedAt || null,
    tables: Array.isArray(payload.tables) ? payload.tables : [],
    lastAuditIdByScope,
  };
}

export async function reconcileAppShellCachesFromAudit({
  scope = "all",
  runAsUserEmail = "",
} = {}) {
  const normalizedScope = normalizeScope(scope);
  const auditHandle = openAuditDb();
  if (!auditHandle) {
    return {
      ok: false,
      skipped: true,
      reason: "audit_db_not_found",
      scope: normalizedScope,
      cursor: readAuditCursor(),
    };
  }

  try {
    const currentCursor = normalizedScope === "all" ? readAuditCursor() : readAuditCursorForScope(normalizedScope);
    let nextCursor = currentCursor;
    const auditRows = auditHandle.db.prepare(`
      SELECT id, tabla_modificada, id_modificado, fecha
        FROM auditoria_cambios
       WHERE id > ?
       ORDER BY id ASC
    `).all(currentCursor);

    if (!auditRows.length) {
      primeAppShellCacheMemory();
      return {
        ok: true,
        scope: normalizedScope,
        cursor: currentCursor,
        changed: false,
        auditRows: 0,
        refreshedScopes: [],
      };
    }

    const scopes = new Set();
    const tables = [];
    const latestAuditIdByScope = new Map();
    for (const row of auditRows) {
      const tableName = normalizeTableName(row?.tabla_modificada);
      if (!tableName) continue;
      tables.push(tableName);
      const rowScopes = getScopesForAuditTable(tableName);
      if (!rowScopes.length) continue;
      for (const rowScope of rowScopes) {
        if (normalizedScope === "all" || normalizedScope === rowScope) {
          scopes.add(rowScope);
          const auditId = Number(row?.id || 0);
          if (Number.isFinite(auditId) && auditId > 0) {
            latestAuditIdByScope.set(rowScope, auditId);
          }
        }
      }
    }

    const results = [];
    for (const targetScope of scopes) {
      results.push(await refreshScope(targetScope, runAsUserEmail));
    }

    if (normalizedScope === "all") {
      const lastAuditId = Number(auditRows[auditRows.length - 1]?.id || 0);
      for (const [scopeKey, scopeAuditId] of latestAuditIdByScope.entries()) {
        if (scopeAuditId > 0) {
          writeAuditCursor(scopeKey, scopeAuditId, { tables: [...new Set(tables)] });
        }
      }
      if (lastAuditId > 0) {
        nextCursor = lastAuditId;
        writeAuditCursor("all", lastAuditId, { tables: [...new Set(tables)] });
      }
    } else {
      const lastAuditId = Number(latestAuditIdByScope.get(normalizedScope) || 0);
      if (lastAuditId > 0) {
        nextCursor = lastAuditId;
        writeAuditCursor(normalizedScope, lastAuditId, { tables: [...new Set(tables)] });
      }
    }

    primeAppShellCacheMemory();

    return {
      ok: true,
      scope: normalizedScope,
      cursor: nextCursor,
      changed: scopes.size > 0,
      auditRows: auditRows.length,
      refreshedScopes: [...scopes],
      tables: [...new Set(tables)],
      results,
    };
  } catch (error) {
    return {
      ok: false,
      scope: normalizedScope,
      cursor: readAuditCursor(),
      error: error instanceof Error ? error.message : String(error || "Error al reconciliar la auditoria"),
    };
  } finally {
    try {
      auditHandle.db.close();
    } catch {
      // Ignoramos errores al cerrar la BD de auditoria.
    }
    auditHandle.cleanup?.();
  }
}
