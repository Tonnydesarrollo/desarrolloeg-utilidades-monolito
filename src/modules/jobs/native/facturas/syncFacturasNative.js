import fs from 'fs';
import { iniciarSesionWeb } from './services/clubfactura.session.js';
import { loginClubFactura } from './services/clubfactura.auth.js';
import { obtenerFacturasEmitidas } from './services/clubfactura.facturas.js';
import { enviarAAppSheet } from './services/appsheet.service.js';
import { descargarXml } from './services/clubfactura.download.js';
import { diffRowsAgainstReplica, loadReplica, saveReplicaRows } from '../../services/localReplica.js';
import { loadJobState, saveJobState } from '../../services/jobState.js';

const MAX_EMPRESAS = Math.max(0, Number(process.env.FACTURAS_MAX_EMPRESAS || '0'));
const MAX_PAGES = Math.max(0, Number(process.env.FACTURAS_MAX_PAGES || '0'));
const MAX_ROWS = Math.max(0, Number(process.env.FACTURAS_MAX_ROWS || '0'));
const FORCE_RESYNC = String(process.env.FACTURAS_FORCE_RESYNC || '').trim() === '1';
const INCREMENTAL_SYNC = String(process.env.FACTURAS_INCREMENTAL_SYNC || '1').trim() !== '0';
const SYNC_LOOKBACK_DAYS = Math.max(0, Number(process.env.FACTURAS_SYNC_LOOKBACK_DAYS || '2'));
const JOB_ID = 'facturas-native-sync';

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

function extractPedidoFromXmlText(xmlText) {
  if (!xmlText) return null;
  const direct = /PEDIDO\s+(\d{6,})/i.exec(xmlText);
  if (direct?.[1]) return direct[1];
  const descRegex = /Descripcion=(?:"([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = descRegex.exec(xmlText))) {
    const desc = match[1] || match[2] || '';
    const pedidoMatch = /PEDIDO\s+(\d{6,})/i.exec(desc);
    if (pedidoMatch?.[1]) return pedidoMatch[1];
  }
  return null;
}

function extractUuidFromXmlText(xmlText) {
  if (!xmlText) return null;
  const match = /UUID\s*=\s*["']([^"']+)["']/i.exec(xmlText);
  return match?.[1] || null;
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

let isRunning = false;

export async function syncFacturasNative() {
  if (isRunning) return { ok: true, skipped: true, message: 'Sync en curso, se omite nueva ejecucion.' };
  isRunning = true;
  try {
    await iniciarSesionWeb();
    await loginClubFactura();
    const state = loadJobState(JOB_ID);
    const nextState = { ...(state.data || {}), companies: { ...(state.data?.companies || {}) } };
    const acumuladas = [];
    const empresas = [
      { id: 15622, proveedor: 'xwDqa6Mt6a42iqKHzJG9L6' },
      { id: 15673, proveedor: 'EiHiUQ9YHf4mA-C7L_ziyc' }
    ];
    const empresasToProcess = MAX_EMPRESAS > 0 ? empresas.slice(0, MAX_EMPRESAS) : empresas;

    for (const empresa of empresasToProcess) {
      const companyState = nextState.companies?.[String(empresa.id)] || {};
      const cursor = INCREMENTAL_SYNC && !FORCE_RESYNC && companyState.lastSeenAt
        ? { lastSeenAt: Number(companyState.lastSeenAt), lastSeenId: Number(companyState.lastSeenId || 0) }
        : null;
      const fromDate = cursor?.lastSeenAt
        ? addDays(new Date(cursor.lastSeenAt), -SYNC_LOOKBACK_DAYS)
        : null;
      let page = 1;
      let total = 0;
      let pagesProcessed = 0;
      let newestSeen = null;
      while (true) {
        if (MAX_PAGES > 0 && pagesProcessed >= MAX_PAGES) break;
        if (MAX_ROWS > 0 && acumuladas.length >= MAX_ROWS) break;

        const { items, totalCount } = await obtenerFacturasEmitidas({ empresa: empresa.id, pageNumber: page, pageSize: 100 });
        if (!items.length) break;
        if (cursor && pagesProcessed > 0 && items.every((item) => !isRowNewerThanCursor(item, cursor))) {
          break;
        }
        const remainingRows = MAX_ROWS > 0 ? Math.max(MAX_ROWS - acumuladas.length, 0) : items.length;
        const pageItems = MAX_ROWS > 0 ? items.slice(0, remainingRows) : items;
        if (!pageItems.length) break;
        const rows = [];
        for (const f of pageItems) {
          const folio = f.serieFolio?.trim();
          let pedido = f?.pedido ?? f?.PEDIDO ?? f?.pedidoDesc ?? f?.pedidoNum ?? null;
          let uuid = f?.uuid ?? f?.UUID ?? f?.Uuid ?? null;
          const needsXml = (pedido == null || uuid == null) && f?.id != null;
          if (needsXml) {
            try {
              const xmlResponse = await descargarXml(f.id);
              const xmlText = Buffer.from(xmlResponse.data).toString('utf8');
              if (pedido == null) pedido = extractPedidoFromXmlText(xmlText);
              if (uuid == null) uuid = extractUuidFromXmlText(xmlText);
            } catch (err) {
              console.error(`Error leyendo XML para id ${f.id}:`, err?.message || err);
            }
            if (pedido == null) pedido = 'PENDIENTE';
          }
          rows.push({
            id: f.id ?? null,
            serieFolio: folio,
            fecha: formatearFechaAppSheet(f.fecha),
            RFC: f.rfc,
            importe: f.importe,
            tipoDesc: f.tipoDesc,
            estatusPagoDesc: f.estatusPagoDesc ?? '',
            fechaPagoCobro: f.fechaPagoCobro ? formatearFechaAppSheet(f.fechaPagoCobro) : null,
            XML: f.xmlDownloadUrl ?? null,
            PDF: f.pdfDownloadUrl ?? null,
            PROVEEDOR: empresa.proveedor,
            PEDIDO: pedido,
            UUID: uuid
          });
          const rowCursor = normalizeCursor(rows[rows.length - 1]);
          if (rowCursor && (!newestSeen || rowCursor.lastSeenAt > newestSeen.lastSeenAt || (rowCursor.lastSeenAt === newestSeen.lastSeenAt && rowCursor.lastSeenId > newestSeen.lastSeenId))) {
            newestSeen = rowCursor;
          }
        }
        acumuladas.push(...rows);
        total += rows.length;
        page++;
        pagesProcessed++;
        if (MAX_ROWS > 0 && acumuladas.length >= MAX_ROWS) break;
        if (total >= totalCount) break;
      }

      if (MAX_ROWS > 0 && acumuladas.length >= MAX_ROWS) break;
    }

    const snapshotPath = resolveDumpFile('cfdis_snapshot.json');
    const snapshot = loadReplica(snapshotPath);
    const { changedRows: toUpload, unchangedRows } = FORCE_RESYNC
      ? { changedRows: acumuladas, unchangedRows: [] }
      : diffRowsAgainstReplica(acumuladas, 'id', snapshot.rows, {
          entryMatchesRow: isLegacyFacturasReplicaMatch,
        });
    const missingUuid = acumuladas.filter(r => !r.UUID);

    writeCsv(resolveDumpFile('cfdis_all.csv'), acumuladas);
    writeCsv(resolveDumpFile('cfdis_to_upload.csv'), toUpload);
    writeUuidMissingCsv(resolveDumpFile('cfdis_uuid_missing.csv'), missingUuid);

    if (toUpload.length > 0) {
      await enviarAAppSheet(toUpload);
    }

    saveReplicaRows(snapshotPath, acumuladas, 'id', { mergeWithExisting: true });
    if (INCREMENTAL_SYNC && !FORCE_RESYNC) {
      const companyIds = empresasToProcess.map((empresa) => String(empresa.id));
      for (const companyId of companyIds) {
        const companyRows = acumuladas.filter((row) => String(row.PROVEEDOR || '') === String(empresas.find((empresa) => String(empresa.id) === companyId)?.proveedor || ''));
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

    return {
      ok: true,
      uploaded: toUpload.length,
      unchanged: unchangedRows.length,
      total: acumuladas.length,
      missingUuid: missingUuid.length,
      incrementalSync: INCREMENTAL_SYNC,
      limits: {
        maxEmpresas: MAX_EMPRESAS || null,
        maxPages: MAX_PAGES || null,
        maxRows: MAX_ROWS || null,
      },
      forceResync: FORCE_RESYNC,
    };
  } finally {
    isRunning = false;
  }
}
