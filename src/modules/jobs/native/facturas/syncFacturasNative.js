import fs from 'fs';
import path from 'path';
import { iniciarSesionWeb } from './services/clubfactura.session.js';
import { loginClubFactura } from './services/clubfactura.auth.js';
import { obtenerFacturasEmitidas } from './services/clubfactura.facturas.js';
import { descargarXml } from './services/clubfactura.download.js';
import { eliminarDeAppSheet, enviarAAppSheet } from './services/appsheet.service.js';
import {
  getFacturasLocalRows,
  getFacturasLocalSyncState,
  getFacturasPendingSyncRows,
  markFacturasRowsSyncState,
  persistFacturasLocalRows,
} from '../../services/localAppsheetDb.js';
import { saveReplicaRows } from '../../services/localReplica.js';
import { loadJobState, saveJobState } from '../../services/jobState.js';

const MAX_EMPRESAS = Math.max(0, Number(process.env.FACTURAS_MAX_EMPRESAS || '0'));
const MAX_PAGES = Math.max(0, Number(process.env.FACTURAS_MAX_PAGES || '0'));
const MAX_ROWS = Math.max(0, Number(process.env.FACTURAS_MAX_ROWS || '0'));
const FORCE_RESYNC = String(process.env.FACTURAS_FORCE_RESYNC || '').trim() === '1';
const INCREMENTAL_SYNC = String(process.env.FACTURAS_INCREMENTAL_SYNC || '1').trim() !== '0';
const SYNC_LOOKBACK_DAYS = Math.max(0, Number(process.env.FACTURAS_SYNC_LOOKBACK_DAYS || '2'));
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const SYNC_YEAR_START = Math.max(2024, Number(process.env.FACTURAS_SYNC_YEAR_START || process.env.FACTURAS_SYNC_YEAR || '2025'));
const SYNC_YEAR_END = Math.max(SYNC_YEAR_START, Number(process.env.FACTURAS_SYNC_YEAR_END || String(CURRENT_YEAR)));
const SYNC_MONTH_START = Math.min(12, Math.max(1, Number(process.env.FACTURAS_SYNC_MONTH_START || '1')));
const SYNC_MONTH_END = Math.min(12, Math.max(SYNC_MONTH_START, Number(process.env.FACTURAS_SYNC_MONTH_END || String(CURRENT_MONTH))));
const APPSHEET_KEY_COLUMN = process.env.FACTURAS_APPSHEET_KEY_COLUMN || 'id';
const PEDIDO_PENDIENTE = 'PENDIENTE';
const JOB_ID = 'facturas-native-sync';
const LOGS_DIR = path.resolve(process.env.RUNTIME_LOGS_DIR || path.join(process.cwd(), 'runtime', 'logs'));
const JOB_LOG_PATH = path.join(LOGS_DIR, `${JOB_ID}.log`);

function logFacturas(message, details = null) {
  const line = `[${new Date().toISOString()}] ${message}${details ? ` ${JSON.stringify(details)}` : ''}`;
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(JOB_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error(`[${JOB_ID}] error escribiendo log:`, error?.message || error);
  }
  console.log(`[${JOB_ID}] ${message}`, details || '');
}

function toDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isRowNewerThanCursor(row, cursor) {
  if (!cursor) return true;
  const rowDate = toDateValue(row?.fecha);
  if (!rowDate) return false;
  if (rowDate.getTime() > cursor.lastSeenAt) return true;
  if (rowDate.getTime() < cursor.lastSeenAt) return false;
  return Number(row?.id || 0) > Number(cursor.lastSeenId || 0);
}

function normalizeCursor(row) {
  const rowDate = toDateValue(row?.fecha);
  if (!rowDate) return null;
  return {
    lastSeenAt: rowDate.getTime(),
    lastSeenId: Number(row?.id || 0),
    lastSeenFecha: row?.fecha || null,
  };
}

function normalizeTextValue(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizePedidoForStorage(value) {
  return normalizeTextValue(value) || PEDIDO_PENDIENTE;
}

function normalizeCfdiIdValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}

function needsXmlProcessing(pedido) {
  return !normalizeTextValue(pedido);
}

export function resolveFacturaPedidoValue(remotePedido, xmlText = "") {
  const normalizedRemotePedido = normalizeFacturaPedidoValue(remotePedido);
  if (!needsXmlProcessing(normalizedRemotePedido)) {
    return normalizePedidoForStorage(normalizedRemotePedido);
  }

  const xmlPedido = extractPedidoFromXmlText(xmlText);
  return normalizePedidoForStorage(xmlPedido || normalizedRemotePedido);
}

function extractPedidoNumberFromText(text) {
  const normalized = normalizeTextValue(text);
  if (!normalized) return null;

  const exactPedido = /\b(6\d{9})\b/.exec(normalized);
  if (exactPedido?.[1]) return exactPedido[1];

  const patterns = [
    /\bPEDIDO(?:\s*(?:NUM(?:ERO)?\.?|NO\.?|NRO\.?))?\s*[:=#-]?\s*(6\d{9})\b/i,
    /\bNO\.?\s*DE\s*PEDIDO\s*[:=#-]?\s*(6\d{9})\b/i,
    /\bPEDIDO\s*#?\s*(6\d{9})\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match?.[1]) return match[1];
  }

  return null;
}

export function extractPedidoFromXmlText(xmlText) {
  const normalized = normalizeTextValue(xmlText);
  if (!normalized) return null;

  const direct = extractPedidoNumberFromText(normalized);
  if (direct) return direct;

  const descRegex = /(?:\bDescripcion\b|\bdescription\b)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = descRegex.exec(normalized))) {
    const desc = match[1] || match[2] || "";
    const pedidoMatch = extractPedidoNumberFromText(desc);
    if (pedidoMatch) return pedidoMatch;
  }
  return null;
}

function extractUuidFromXmlText(xmlText) {
  if (!xmlText) return null;
  const match = /UUID\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match?.[1] || null;
}

function normalizeCancelacionValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatusText(value) {
  return String(value ?? '').trim().toUpperCase();
}

function getFacturasTextCandidates(row = {}) {
  return Object.entries(row || {})
    .filter(([, value]) => value !== null && value !== undefined)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .map(([key, value]) => ({
      keyText: String(key).toUpperCase(),
      valueText: normalizeStatusText(value),
    }))
    .filter(({ valueText }) => Boolean(valueText));
}

function rowTextMatches(row, patterns) {
  const candidates = getFacturasTextCandidates(row);
  return candidates.some(({ keyText, valueText }) => {
    const keyMatches = (patterns.key || []).some((pattern) => pattern.test(keyText));
    if (!keyMatches) return false;
    return (patterns.value || []).some((pattern) => pattern.test(valueText));
  });
}

function isFacturaDePago(factura = {}) {
  const tipoText = normalizeStatusText(factura?.tipoDesc || factura?.tipo_desc || factura?.tipo || factura?.tipoCFDI);
  if (/CFDI\s*DE\s*PAGOS|PAGOS/.test(tipoText)) {
    return true;
  }

  return rowTextMatches(factura, {
    key: [/TIPO/, /CFDI/],
    value: [/CFDI\s*DE\s*PAGOS/, /\bPAGOS?\b/],
  });
}

export function isFacturaCancelada(factura = {}) {
  const estatusCancelacion = normalizeCancelacionValue(factura?.estatusCancelacion);
  if (estatusCancelacion === 1) {
    return true;
  }

  const estatus = normalizeNumericValue(factura?.estatus);
  const esCancelable = normalizeNumericValue(factura?.esCancelable);
  if (estatus === 2 && esCancelable === 3) {
    return true;
  }

  const statusText = normalizeStatusText(factura?.estatusPagoDesc || factura?.estatusDesc || factura?.status);
  if (/CANCEL/.test(statusText)) {
    return true;
  }

  return rowTextMatches(factura, {
    key: [/CANCEL/, /ESTATUS/, /STATUS/],
    value: [/CANCEL/, /CANCELAD/, /ANULAD/, /REVOCAD/, /SUSPENDID/],
  });
}

export function isFacturaEnProcesoCancelacion(factura = {}) {
  const estatusCancelacion = normalizeCancelacionValue(factura?.estatusCancelacion);
  if (estatusCancelacion === 2 || estatusCancelacion === 3) {
    return true;
  }

  const statusText = normalizeStatusText(factura?.estatusPagoDesc || factura?.estatusDesc || factura?.status);
  if (/PROCES|PENDIENTE\s+DE\s+CANCEL|EN\s+TRAMITE\s+DE\s+CANCEL|SOLICITUD\s+DE\s+CANCEL/.test(statusText)) {
    return true;
  }

  return rowTextMatches(factura, {
    key: [/CANCEL/, /ESTATUS/, /STATUS/],
    value: [
      /PROCES.*CANCEL|CANCEL.*PROCES/,
      /PENDIENTE.*CANCEL|CANCEL.*PENDIENTE/,
      /TRAMITE.*CANCEL|CANCEL.*TRAMITE/,
      /SOLICITUD.*CANCEL|CANCEL.*SOLICITUD/,
      /EN\s+CURSO.*CANCEL|CANCEL.*EN\s+CURSO/,
    ],
  });
}

function writeCancelledCsv(path, rows) {
  const header = ['id', 'serieFolio', 'RFC', 'estatusCancelacion', 'estatusPagoDesc'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const values = [
      r.id,
      r.serieFolio,
      r.RFC,
      r.estatusCancelacion,
      r.estatusPagoDesc,
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`);
    lines.push(values.join(','));
  }
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
}

function writeCancelledCleanupCsv(path, rows) {
  const header = ['id', 'serieFolio', 'RFC', 'estatusCancelacion', 'estatusPagoDesc', 'accion'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const values = [
      r.id,
      r.serieFolio,
      r.RFC,
      r.estatusCancelacion,
      r.estatusPagoDesc,
      'DELETE',
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`);
    lines.push(values.join(','));
  }
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
}

function getDumpDir() {
  return process.env.FACTURAS_NATIVE_DUMP_DIR || new URL('./data/', import.meta.url);
}

function resolveDumpFile(name) {
  const dir = getDumpDir();
  const pathValue = dir instanceof URL ? dir.pathname : dir;
  if (!fs.existsSync(pathValue)) fs.mkdirSync(pathValue, { recursive: true });
  return `${pathValue.replace(/[\\/]$/, '')}/${name}`;
}

function writeCsv(path, rows) {
  const header = ['id', 'PEDIDO', 'UUID'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const id = String(r.id ?? '').replace(/"/g, '""');
    const pedido = String(r.PEDIDO ?? '').replace(/"/g, '""');
    const uuid = String(r.UUID ?? '').replace(/"/g, '""');
    lines.push(`"${id}","${pedido}","${uuid}"`);
  }
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
}
function writeUuidMissingCsv(path, rows) {
  const header = ['id', 'serieFolio', 'RFC', 'PEDIDO', 'UUID'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const values = [r.id, r.serieFolio, r.RFC, r.PEDIDO, r.UUID].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`);
    lines.push(values.join(','));
  }
  fs.writeFileSync(path, lines.join('\n'), 'utf8');
}

function isLegacyFacturasReplicaMatch(entry, row) {
  const legacyRow = entry?.row;
  if (!legacyRow || entry?.hash) return false;

  const keys = Object.keys(legacyRow);
  if (!keys.length || !keys.every((key) => key === 'PEDIDO' || key === 'UUID')) return false;

  return String(legacyRow.PEDIDO ?? '') === String(row.PEDIDO ?? '')
    && String(legacyRow.UUID ?? '') === String(row.UUID ?? '');
}

function formatearFechaAppSheet(fecha) {
  if (!fecha) return null;
  const d = new Date(fecha);
  const pad = n => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function periodLabel(period) {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

function getFacturasSyncPeriods() {
  const periods = [];
  for (let year = SYNC_YEAR_START; year <= SYNC_YEAR_END; year += 1) {
    const monthStart = year === SYNC_YEAR_START ? SYNC_MONTH_START : 1;
    const defaultMonthEnd = year === CURRENT_YEAR ? CURRENT_MONTH : 12;
    const monthEnd = year === SYNC_YEAR_END ? Math.min(SYNC_MONTH_END, defaultMonthEnd) : defaultMonthEnd;
    for (let month = monthStart; month <= monthEnd; month += 1) {
      periods.push({ year, month });
    }
  }
  return periods;
}

export function normalizeFacturaPedidoValue(value) {
  const text = normalizeTextValue(value);
  if (!text) return null;

  const direct = /\b(6\d{9})\b/.exec(text);
  return direct?.[1] || null;
}

async function fetchFacturasPeriodo({ empresa, period, cursor, maxRowsRemaining }) {
  const rows = [];
  const existingRowsById = new Map(
    getFacturasLocalRows({ proveedor: empresa.proveedor, period: periodLabel(period) })
      .map((row) => [normalizeCfdiIdValue(row.id), row])
      .filter(([id]) => Boolean(id))
  );
  let page = 1;
  let pagesProcessed = 0;
  let totalFetched = 0;
  let lastTotalCount = 0;
  let xmlProcessed = 0;
  let xmlErrors = 0;

  while (true) {
    if (MAX_PAGES > 0 && pagesProcessed >= MAX_PAGES) break;
    if (maxRowsRemaining !== null && rows.length >= maxRowsRemaining) break;

    const { items, totalCount } = await obtenerFacturasEmitidas({
      empresa: empresa.id,
      pageNumber: page,
      pageSize: 100,
      year: period.year,
      month: period.month,
    });

    lastTotalCount = Number(totalCount || 0);
    logFacturas('pagina consultada en ClubFactura', {
      empresa: empresa.id,
      proveedor: empresa.proveedor,
      periodo: periodLabel(period),
      pagina: page,
      recibidos: items.length,
      totalCount: lastTotalCount,
    });
    if (!items.length) break;
    if (cursor && pagesProcessed > 0 && items.every((item) => !isRowNewerThanCursor(item, cursor))) {
      break;
    }

    const remainingRows = maxRowsRemaining !== null ? Math.max(maxRowsRemaining - rows.length, 0) : items.length;
    const pageItems = maxRowsRemaining !== null ? items.slice(0, remainingRows) : items;
    if (!pageItems.length) break;

    for (const f of pageItems) {
      const folio = f.serieFolio?.trim();
      if (isFacturaDePago(f)) {
        continue;
      }
      const cfdiId = normalizeCfdiIdValue(f.id ?? null);
      const existingRow = cfdiId ? existingRowsById.get(cfdiId) : null;
      let pedido = normalizeFacturaPedidoValue(f?.pedido ?? f?.PEDIDO ?? f?.pedidoDesc ?? f?.pedidoNum);
      let uuid = normalizeTextValue(f?.uuid ?? f?.UUID ?? f?.Uuid);
      const existingPedido = normalizeTextValue(existingRow?.pedido ?? existingRow?.PEDIDO);
      const existingUuid = normalizeTextValue(existingRow?.uuid ?? existingRow?.UUID);
      const isExcluded = isFacturaCancelada(f) || isFacturaEnProcesoCancelacion(f);
      if (!pedido && existingPedido) pedido = existingPedido;
      if (!uuid && existingUuid) uuid = existingUuid;

      const needsXml = !isExcluded && f?.id != null && needsXmlProcessing(pedido);
      if (needsXml) {
        try {
          const xmlResponse = await descargarXml(f.id);
          const xmlText = Buffer.from(xmlResponse.data).toString('utf8');
          pedido = resolveFacturaPedidoValue(pedido, xmlText);
          if (!uuid) uuid = extractUuidFromXmlText(xmlText);
          xmlProcessed += 1;
        } catch (err) {
          console.error(`Error leyendo XML para id ${f.id}:`, err?.message || err);
          xmlErrors += 1;
          pedido = resolveFacturaPedidoValue(pedido);
        }
      } else {
        pedido = resolveFacturaPedidoValue(pedido);
      }

      rows.push({
        id: cfdiId,
        [APPSHEET_KEY_COLUMN]: cfdiId,
        serieFolio: folio,
        fecha: formatearFechaAppSheet(f.fecha),
        RFC: f.rfc,
        importe: f.importe,
        tipoDesc: f.tipoDesc,
        estatus: f.estatus ?? null,
        estatusCancelacion: f.estatusCancelacion ?? null,
        esCancelable: f.esCancelable ?? null,
        estatusPagoDesc: f.estatusPagoDesc ?? '',
        fechaPagoCobro: f.fechaPagoCobro ? formatearFechaAppSheet(f.fechaPagoCobro) : null,
        XML: f.xmlDownloadUrl ?? null,
        PDF: f.pdfDownloadUrl ?? null,
        PROVEEDOR: empresa.proveedor,
        PEDIDO: pedido,
        UUID: uuid,
      });
    }

    totalFetched += pageItems.length;
    page += 1;
    pagesProcessed += 1;

    if (maxRowsRemaining !== null && rows.length >= maxRowsRemaining) break;
    if (totalFetched >= lastTotalCount) break;
  }

  return {
    rows,
    totalFetched,
    pagesProcessed,
    totalCount: lastTotalCount,
    xmlProcessed,
    xmlErrors,
  };
}

async function processFacturasPeriodo({ empresa, period, cursor, maxRowsRemaining }) {
  logFacturas('inicia periodo', {
    empresa: empresa.id,
    proveedor: empresa.proveedor,
    periodo: periodLabel(period),
  });
  const fetched = await fetchFacturasPeriodo({ empresa, period, cursor, maxRowsRemaining });
  const acumuladas = fetched.rows;
  const cancelledRows = acumuladas.filter((row) => isFacturaCancelada(row));
  const inProcessCancelRows = acumuladas.filter((row) => !isFacturaCancelada(row) && isFacturaEnProcesoCancelacion(row));
  const paymentRows = acumuladas.filter((row) => isFacturaDePago(row));
  const excludedRows = [...cancelledRows, ...inProcessCancelRows, ...paymentRows];
  const activeRows = acumuladas.filter((row) => !isFacturaCancelada(row) && !isFacturaEnProcesoCancelacion(row) && !isFacturaDePago(row));

  const persistResult = persistFacturasLocalRows(activeRows, excludedRows);

  let deletedFromAppSheet = 0;
  const rowsToDeleteFromAppSheet = Array.isArray(persistResult?.deletedRows) && persistResult.deletedRows.length > 0
    ? persistResult.deletedRows
    : [];
  if (rowsToDeleteFromAppSheet.length > 0) {
    logFacturas('eliminando canceladas/en proceso de AppSheet', {
      empresa: empresa.id,
      periodo: periodLabel(period),
      filas: rowsToDeleteFromAppSheet.length,
    });
    try {
      const deletedResult = await eliminarDeAppSheet(rowsToDeleteFromAppSheet);
      deletedFromAppSheet = Number(deletedResult?.deleted || 0);
    } catch (error) {
      console.error(`Error eliminando CFDIs excluidos de AppSheet para ${empresa.id} ${periodLabel(period)}:`, error?.message || error);
    }
  }

  const localRows = getFacturasLocalRows({ proveedor: empresa.proveedor, period: periodLabel(period) });
  const staleRows = [];

  const snapshotPath = resolveDumpFile('cfdis_snapshot.json');
  const missingUuid = activeRows.filter(r => !r.UUID);

  writeCsv(resolveDumpFile(`cfdis_all_${periodLabel(period)}.csv`), activeRows);
  writeCsv(resolveDumpFile(`cfdis_to_upload_${periodLabel(period)}.csv`), activeRows);
  writeCancelledCsv(resolveDumpFile(`cfdis_cancelled_${periodLabel(period)}.csv`), [...excludedRows, ...staleRows]);
  writeCancelledCleanupCsv(resolveDumpFile(`cfdis_cancelled_deleted_${periodLabel(period)}.csv`), [...excludedRows, ...staleRows]);
  writeUuidMissingCsv(resolveDumpFile(`cfdis_uuid_missing_${periodLabel(period)}.csv`), missingUuid);

  saveReplicaRows(snapshotPath, activeRows, 'id', { mergeWithExisting: true });

  logFacturas('termina periodo', {
    empresa: empresa.id,
    proveedor: empresa.proveedor,
    periodo: periodLabel(period),
    fetchRows: acumuladas.length,
    activas: activeRows.length,
    canceladas: cancelledRows.length,
    cancelacionEnProceso: inProcessCancelRows.length,
    pagos: paymentRows.length,
    xmlProcesados: fetched.xmlProcessed,
    xmlErrores: fetched.xmlErrors,
    cambiosLocales: Number(persistResult?.changedCount || 0),
    eliminadasLocal: Number(persistResult?.deletedCount || 0),
    eliminadasAppSheet: deletedFromAppSheet,
    pendientesUuid: missingUuid.length,
  });

  return {
    period: periodLabel(period),
    fetched: acumuladas.length,
    uploaded: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    cancelled: cancelledRows.length,
    cancelacionEnProceso: inProcessCancelRows.length,
    pagos: paymentRows.length,
    appsheetDeleted: deletedFromAppSheet,
    excluded: excludedRows.length + staleRows.length,
    staleRemoved: staleRows.length,
    skippedDeletes: 0,
    missingUuid: missingUuid.length,
    reconcileExisting: localRows.length,
    localPersisted: activeRows.length,
    localChanged: Boolean(persistResult?.changed),
    localChangedRows: Number(persistResult?.changedCount || 0),
    localDeletedRows: Number(persistResult?.deletedCount || 0),
    localRemoved: staleRows.length,
    localDirty: Boolean(getFacturasLocalSyncState()?.dirty),
    activeRows,
  };
}

let isRunning = false;
export async function syncFacturasNative() {
  if (isRunning) return { ok: true, skipped: true, message: 'Sync en curso, se omite nueva ejecucion.' };
  isRunning = true;
  try {
    logFacturas('inicia job', {
      syncYearStart: SYNC_YEAR_START,
      syncYearEnd: SYNC_YEAR_END,
      syncMonthStart: SYNC_MONTH_START,
      syncMonthEnd: SYNC_MONTH_END,
      maxEmpresas: MAX_EMPRESAS || null,
      maxPages: MAX_PAGES || null,
      maxRows: MAX_ROWS || null,
      forceResync: FORCE_RESYNC,
    });
    await iniciarSesionWeb();
    logFacturas('sesion web iniciada');
    await loginClubFactura();
    logFacturas('login ClubFactura correcto');
    const state = loadJobState(JOB_ID);
    const nextState = { ...(state.data || {}), companies: { ...(state.data?.companies || {}) } };
    const syncPeriods = getFacturasSyncPeriods();
    const empresas = [
      { id: 15622, proveedor: 'xwDqa6Mt6a42iqKHzJG9L6' },
      { id: 15673, proveedor: 'EiHiUQ9YHf4mA-C7L_ziyc' }
    ];
    const empresasToProcess = MAX_EMPRESAS > 0 ? empresas.slice(0, MAX_EMPRESAS) : empresas;
    const periodResults = [];
    const allActiveRows = [];
    const useJobState = INCREMENTAL_SYNC && !FORCE_RESYNC && SYNC_YEAR_START <= 0;
    logFacturas('plan de consulta preparado', {
      empresas: empresasToProcess.map((empresa) => empresa.id),
      periodos: syncPeriods.map(periodLabel),
    });

    for (const empresa of empresasToProcess) {
      logFacturas('inicia empresa', { empresa: empresa.id, proveedor: empresa.proveedor });
      const companyState = nextState.companies?.[String(empresa.id)] || {};
      const cursor = useJobState && companyState.lastSeenAt
        ? { lastSeenAt: Number(companyState.lastSeenAt), lastSeenId: Number(companyState.lastSeenId || 0) }
        : null;
      let newestSeen = null;

      for (const period of syncPeriods) {
        const periodResult = await processFacturasPeriodo({
          empresa,
          period,
          cursor,
          maxRowsRemaining: MAX_ROWS > 0 ? Math.max(MAX_ROWS - allActiveRows.length, 0) : null,
        });
        periodResults.push({
          empresa: empresa.id,
          ...periodResult,
        });
        allActiveRows.push(...periodResult.activeRows);

        const periodNewest = periodResult.activeRows.reduce((acc, row) => {
          const current = normalizeCursor(row);
          if (!current) return acc;
          if (!acc) return current;
          if (current.lastSeenAt > acc.lastSeenAt) return current;
          if (current.lastSeenAt === acc.lastSeenAt && current.lastSeenId > acc.lastSeenId) return current;
          return acc;
        }, null);
        if (periodNewest && (!newestSeen || periodNewest.lastSeenAt > newestSeen.lastSeenAt || (periodNewest.lastSeenAt === newestSeen.lastSeenAt && periodNewest.lastSeenId > newestSeen.lastSeenId))) {
          newestSeen = periodNewest;
        }

        if (MAX_ROWS > 0 && allActiveRows.length >= MAX_ROWS) break;
      }

      if (MAX_ROWS > 0 && allActiveRows.length >= MAX_ROWS) break;
      logFacturas('termina empresa', {
        empresa: empresa.id,
        proveedor: empresa.proveedor,
        filasActivasAcumuladas: allActiveRows.length,
      });
    }

    if (useJobState) {
      const companyIds = empresasToProcess.map((empresa) => String(empresa.id));
      for (const companyId of companyIds) {
        const companyRows = allActiveRows.filter((row) => String(row.PROVEEDOR || '') === String(empresas.find((empresa) => String(empresa.id) === companyId)?.proveedor || ''));
        const newest = companyRows.reduce((acc, row) => {
          const current = normalizeCursor(row);
          if (!current) return acc;
          if (!acc) return current;
          if (current.lastSeenAt > acc.lastSeenAt) return current;
          if (current.lastSeenAt === acc.lastSeenAt && current.lastSeenId > acc.lastSeenId) return current;
          return acc;
        }, null);
        if (newest) {
          nextState.companies[companyId] = newest;
        }
      }
      saveJobState(JOB_ID, nextState);
    }

    const pendingRows = getFacturasPendingSyncRows();
    let uploadResult = { added: 0, updated: 0, total: 0, skippedExcluded: 0 };
    let markedSynced = 0;
    logFacturas('pendientes de sincronizar AppSheet', { filas: pendingRows.length });
    if (pendingRows.length > 0) {
      uploadResult = await enviarAAppSheet(pendingRows, {
        onProgress: (event) => logFacturas('avance AppSheet', event),
      });
      logFacturas('termina envio AppSheet', uploadResult);
      markedSynced = markFacturasRowsSyncState(pendingRows.map((row) => row.id), {
        syncState: "SINCRONIZADO",
        syncAt: new Date().toISOString(),
        origin: "APPSHEET",
      });
      logFacturas('filas marcadas sincronizadas localmente', { filas: markedSynced });
    }

    const result = {
      ok: true,
      uploaded: Number(uploadResult?.added || 0) + Number(uploadResult?.updated || 0),
      deleted: periodResults.reduce((acc, item) => acc + Number(item.appsheetDeleted || 0), 0),
      unchanged: periodResults.reduce((acc, item) => acc + Number(item.unchanged || 0), 0),
      total: periodResults.reduce((acc, item) => acc + Number(item.fetched || 0), 0),
      cancelled: periodResults.reduce((acc, item) => acc + Number(item.cancelled || 0), 0),
      cancelacionEnProceso: periodResults.reduce((acc, item) => acc + Number(item.cancelacionEnProceso || 0), 0),
      excluded: periodResults.reduce((acc, item) => acc + Number(item.excluded || 0), 0),
      staleRemoved: periodResults.reduce((acc, item) => acc + Number(item.staleRemoved || 0), 0),
      skippedDeletes: periodResults.reduce((acc, item) => acc + Number(item.skippedDeletes || 0), 0),
      missingUuid: periodResults.reduce((acc, item) => acc + Number(item.missingUuid || 0), 0),
      pendingUploaded: Number(uploadResult?.total || pendingRows.length || 0),
      pendingMarkedSynced: markedSynced,
      pendingSkippedExcluded: Number(uploadResult?.skippedExcluded || 0),
      periods: periodResults.map(({ activeRows, ...item }) => item),
      incrementalSync: INCREMENTAL_SYNC,
      mirrorAppSheet: false,
      mirrorUploaded: 0,
      mirrorDeleted: 0,
      mirrorSkippedDeletes: 0,
      mirrorTotal: 0,
      limits: {
        maxEmpresas: MAX_EMPRESAS || null,
        maxPages: MAX_PAGES || null,
        maxRows: MAX_ROWS || null,
        syncYearStart: SYNC_YEAR_START || null,
        syncYearEnd: SYNC_YEAR_END || null,
        syncMonthStart: SYNC_MONTH_START || null,
        syncMonthEnd: SYNC_MONTH_END || null,
      },
      forceResync: FORCE_RESYNC,
    };
    logFacturas('termina job', {
      total: result.total,
      uploaded: result.uploaded,
      deleted: result.deleted,
      cancelled: result.cancelled,
      cancelacionEnProceso: result.cancelacionEnProceso,
      pendingUploaded: result.pendingUploaded,
      pendingMarkedSynced: result.pendingMarkedSynced,
    });
    return result;
  } finally {
    isRunning = false;
  }
}
