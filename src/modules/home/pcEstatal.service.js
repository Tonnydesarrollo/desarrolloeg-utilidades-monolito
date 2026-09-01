import { readLocalRows } from "../../services/desarrolloegLocalDb.js";

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function dateParts(value) {
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]);
    return { year, timestamp: new Date(year, Number(iso[2]) - 1, Number(iso[3])).getTime() };
  }

  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return { year, timestamp: new Date(year, month - 1, day).getTime() };
  }
  return { year: null, timestamp: 0 };
}

function parseMirroredRows(rows = []) {
  return rows.flatMap((row) => {
    try {
      return [{ ...JSON.parse(row.data_json || "{}"), row_id: text(row.row_id) }];
    } catch {
      return [];
    }
  });
}

function getRowYear(row, fallbackYear) {
  const yearEntry = Object.entries(row || {}).find(([key]) => {
    const normalized = String(key || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]/gi, "")
      .toUpperCase();
    return normalized === "ANO" || normalized === "ANIO";
  });
  const parsed = Number(yearEntry?.[1] || fallbackYear);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolvePcEstatalBySucursal({ sucursales = [], pcRows = [], year = new Date().getFullYear() } = {}) {
  const sucursalIds = new Set();
  const byTienda = new Map();
  const byIdPc = new Map();
  for (const row of sucursales) {
    const id = text(row.id || row.ID || row["Row ID"]);
    if (!id) continue;
    sucursalIds.add(id);
    const tienda = text(row.tienda || row.TIENDA);
    const idPc = text(row.id_pc || row.ID_PC || row["ID PC"]);
    if (tienda && !byTienda.has(tienda)) byTienda.set(tienda, id);
    if (idPc && !byIdPc.has(idPc)) byIdPc.set(idPc, id);
  }

  const latest = new Map();
  for (const row of pcRows) {
    const fecha = text(row.registro_fecha || row.REGISTRO_FECHA);
    const parsedDate = dateParts(fecha);
    const rowYear = getRowYear(row, parsedDate.year);
    if (rowYear !== Number(year)) continue;

    const directId = text(row.SUCURSAL || row.sucursal || row.sucursal_local_id);
    const sucursalId = (directId && sucursalIds.has(directId) ? directId : "")
      || byTienda.get(text(row.TIENDA || row.tienda))
      || byIdPc.get(text(row.sucursal_id || row.SUCURSAL_ID))
      || "";
    if (!sucursalId) continue;

    const solicitud = Number(row.solicitud_id || row.SOLICITUD_ID || 0);
    const solicitudScore = Number.isFinite(solicitud) ? solicitud : 0;
    const current = latest.get(sucursalId);
    const isNewer = !current
      || parsedDate.timestamp > current.timestamp
      || (parsedDate.timestamp === current.timestamp && solicitudScore >= current.solicitudScore);
    if (isNewer) {
      latest.set(sucursalId, {
        timestamp: parsedDate.timestamp,
        solicitudScore,
        sucursalId,
        solicitudId: text(row.solicitud_id || row.SOLICITUD_ID),
        status: text(row.estatus || row.ESTATUS) || "PENDIENTE",
        motivo: text(row.MOTIVO || row.motivo),
        registroFecha: fecha,
        vigenciaFecha: text(row.vigencia_fecha_propuesta || row.VIGENCIA_FECHA_PROPUESTA),
        pcSucursalId: text(row.sucursal_id || row.SUCURSAL_ID),
        tienda: text(row.TIENDA || row.tienda),
      });
    }
  }
  return latest;
}

export function readPcEstatalStatusBySucursal(year = new Date().getFullYear()) {
  const sucursales = readLocalRows("SELECT id, tienda, id_pc FROM sucursales");
  const mirrored = readLocalRows(`
    SELECT row_id, data_json
    FROM operational_rows
    WHERE source = 'desarrolloeg' AND table_name = 'STATUS SISTEMA PC'
  `);
  return resolvePcEstatalBySucursal({ sucursales, pcRows: parseMirroredRows(mirrored), year });
}
