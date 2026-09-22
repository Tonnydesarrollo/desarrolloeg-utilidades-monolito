import crypto from "node:crypto";
import { openDesarrolloegSyncDb } from "../../../services/desarrolloegLocalDb.js";

const EXTERNAL_PREFIX = "EXT-";

function text(value) {
  return String(value ?? "").trim();
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function taxRate(value, fallback = 0.16) {
  const raw = text(value);
  if (!raw) return fallback;
  const parsed = Number(raw.replace(/[%,$\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  if (raw.includes("%") || parsed > 1) return parsed <= 100 ? parsed / 100 : fallback;
  return parsed;
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function rowId(prefix) {
  return `${prefix}-${crypto.randomBytes(12).toString("base64url")}`;
}

export function isExternalQuoteId(value) {
  return text(value).startsWith(EXTERNAL_PREFIX);
}

export function ensureExternalQuoteTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cotizaciones_externas (
      id TEXT PRIMARY KEY,
      destinatario TEXT NOT NULL,
      fecha TEXT NOT NULL,
      proveedor_id TEXT NOT NULL,
      titulo TEXT NOT NULL DEFAULT 'Cotizacion',
      forma_pago TEXT NOT NULL DEFAULT '',
      creado_en TEXT NOT NULL,
      actualizado_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS centros_cotizacion_externa (
      id TEXT PRIMARY KEY,
      cotizacion_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      orden INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones_externas(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_centros_cotizacion_externa
      ON centros_cotizacion_externa(cotizacion_id, orden);
    CREATE TABLE IF NOT EXISTS conceptos_cotizacion_externa (
      id TEXT PRIMARY KEY,
      cotizacion_id TEXT NOT NULL,
      centro_id TEXT NOT NULL,
      concepto_id TEXT NOT NULL,
      cantidad REAL NOT NULL,
      precio REAL NOT NULL,
      iva REAL NOT NULL,
      orden INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones_externas(id) ON DELETE CASCADE,
      FOREIGN KEY (centro_id) REFERENCES centros_cotizacion_externa(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conceptos_cotizacion_externa
      ON conceptos_cotizacion_externa(cotizacion_id, centro_id, orden);
  `);
}

function database(db) {
  const resolved = db || openDesarrolloegSyncDb();
  if (!resolved) throw new Error("La base de datos local no esta disponible para guardar la cotizacion externa.");
  ensureExternalQuoteTables(resolved);
  return resolved;
}

export function listExternalQuotes(dbOverride) {
  const db = database(dbOverride);
  return db.prepare(`
    SELECT id AS "Row ID", destinatario AS "RAZON SOCIAL", fecha AS FECHA,
           proveedor_id AS PROVEEDOR, titulo AS TITULO, forma_pago AS "FORMA PAGO",
           1 AS ES_EXTERNA
    FROM cotizaciones_externas
    ORDER BY creado_en ASC
  `).all();
}

function readExternalRows(id, dbOverride) {
  const db = database(dbOverride);
  const quote = db.prepare("SELECT * FROM cotizaciones_externas WHERE id = ?").get(text(id));
  if (!quote) return null;
  const centers = db.prepare(`
    SELECT * FROM centros_cotizacion_externa WHERE cotizacion_id = ? ORDER BY orden, id
  `).all(quote.id);
  const lines = db.prepare(`
    SELECT * FROM conceptos_cotizacion_externa WHERE cotizacion_id = ? ORDER BY orden, id
  `).all(quote.id);
  return { quote, centers, lines };
}

export function getExternalQuote(id, dbOverride) {
  const data = readExternalRows(id, dbOverride);
  if (!data) return null;
  return {
    "Row ID": data.quote.id,
    "RAZON SOCIAL": data.quote.destinatario,
    FECHA: data.quote.fecha,
    PROVEEDOR: data.quote.proveedor_id,
    TITULO: data.quote.titulo,
    "FORMA PAGO": data.quote.forma_pago,
    CENTROS_DE_TRABAJO: data.centers.map((center) => center.id),
    ES_EXTERNA: 1,
  };
}

export function getExternalConceptRows(id, dbOverride) {
  const data = readExternalRows(id, dbOverride);
  if (!data) return [];
  return data.lines.map((line) => {
    const subtotal = number(line.cantidad) * number(line.precio);
    const rate = taxRate(line.iva, 0.16);
    const tax = subtotal * rate;
    return {
      "Row ID": line.id,
      COTIZACION: line.cotizacion_id,
      CENTRO_DE_TRABAJO: line.centro_id,
      CONCEPTO: line.concepto_id,
      CANTIDAD: line.cantidad,
      PRECIO: line.precio,
      IVA: rate,
      SUBTOTAL: subtotal,
      "TOTAL IVA": tax,
      TOTAL: subtotal + tax,
    };
  });
}

export function externalCentersMap(id, dbOverride) {
  const data = readExternalRows(id, dbOverride);
  return Object.fromEntries((data?.centers || []).map((center) => [center.id, {
    id: center.id,
    nombre: center.nombre,
    tienda: center.nombre,
    domicilio: "",
    municipio: {},
    estado: {},
  }]));
}

export function saveExternalQuote(input = {}, quoteId = "", dbOverride) {
  const db = database(dbOverride);
  const id = text(quoteId || input.id) || `${EXTERNAL_PREFIX}${crypto.randomUUID()}`;
  if (!isExternalQuoteId(id)) throw new Error("La cotizacion seleccionada no es una cotizacion externa.");
  const existing = db.prepare("SELECT id FROM cotizaciones_externas WHERE id = ?").get(id);
  const destinatario = text(input.destinatario);
  const fecha = text(input.fecha);
  const proveedorId = text(input.proveedorId);
  const centerNames = unique(input.centrosTrabajo);
  if (!destinatario) throw new Error("Escribe el nombre o razon social del destinatario.");
  if (!fecha) throw new Error("Selecciona la fecha de la cotizacion.");
  if (!proveedorId) throw new Error("Selecciona una firma autorizada.");
  if (!centerNames.length) throw new Error("Agrega al menos un centro de trabajo.");

  const oldCenters = existing
    ? db.prepare("SELECT id, nombre FROM centros_cotizacion_externa WHERE cotizacion_id = ?").all(id)
    : [];
  const oldCenterByName = new Map(oldCenters.map((center) => [center.nombre, center.id]));
  const centers = centerNames.map((name, index) => ({
    id: oldCenterByName.get(name) || rowId("EXTCT"), name, order: index,
  }));
  const centerIdByName = new Map(centers.map((center) => [center.name, center.id]));
  let lines = [];
  if (Array.isArray(input.lineas)) {
    lines = input.lineas.map((line, index) => {
      const centerName = text(line.centroTrabajoNombre || line.centroTrabajoId);
      return {
        id: text(line.id) || rowId("EXTCON"),
        centerId: centerIdByName.get(centerName) || (centers.some((center) => center.id === text(line.centroTrabajoId)) ? text(line.centroTrabajoId) : ""),
        conceptId: text(line.conceptoId), cantidad: Math.max(0, number(line.cantidad, 1)),
        precio: Math.max(0, number(line.precio)), iva: taxRate(line.iva, 0.16), order: index,
      };
    });
  } else {
    lines = centers.flatMap((center) => (Array.isArray(input.conceptos) ? input.conceptos : []).map((concept, index) => ({
      id: rowId("EXTCON"), centerId: center.id, conceptId: text(concept.id || concept.conceptoId),
      cantidad: Math.max(0, number(concept.cantidad, 1)), precio: Math.max(0, number(concept.precio)),
      iva: taxRate(concept.iva, 0.16), order: index,
    })));
  }
  lines = lines.filter((line) => line.centerId && line.conceptId);
  if (!lines.length) throw new Error("Selecciona al menos un concepto.");
  if (centers.some((center) => !lines.some((line) => line.centerId === center.id))) {
    throw new Error("Cada centro de trabajo debe tener al menos un concepto.");
  }

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO cotizaciones_externas
        (id, destinatario, fecha, proveedor_id, titulo, forma_pago, creado_en, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET destinatario=excluded.destinatario, fecha=excluded.fecha,
        proveedor_id=excluded.proveedor_id, titulo=excluded.titulo,
        forma_pago=excluded.forma_pago, actualizado_en=excluded.actualizado_en
    `).run(id, destinatario, fecha, proveedorId, text(input.titulo) || "Cotizacion", text(input.formaPago), now, now);
    db.prepare("DELETE FROM conceptos_cotizacion_externa WHERE cotizacion_id = ?").run(id);
    db.prepare("DELETE FROM centros_cotizacion_externa WHERE cotizacion_id = ?").run(id);
    const insertCenter = db.prepare("INSERT INTO centros_cotizacion_externa (id, cotizacion_id, nombre, orden) VALUES (?, ?, ?, ?)");
    centers.forEach((center) => insertCenter.run(center.id, id, center.name, center.order));
    const insertLine = db.prepare(`
      INSERT INTO conceptos_cotizacion_externa
        (id, cotizacion_id, centro_id, concepto_id, cantidad, precio, iva, orden)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    lines.forEach((line) => insertLine.run(line.id, id, line.centerId, line.conceptId, line.cantidad, line.precio, line.iva, line.order));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    id, created: !existing, conceptos: lines.length, conceptosGestionadosPor: "plataforma-local",
    lineas: lines.map((line) => {
      const center = centers.find((item) => item.id === line.centerId);
      return { id: line.id, centroTrabajoId: center?.name || line.centerId,
        centroTrabajoNombre: center?.name || line.centerId, conceptoId: line.conceptId,
        cantidad: line.cantidad, precio: line.precio, iva: line.iva };
    }),
  };
}
