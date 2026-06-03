import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchBranchStatusesFromAppSheet, fetchBranchesFromAppSheet, normalizePlaneacionStatus } from './services/appsheet.js';
import { geocodeMissing } from './services/geocode.js';
import { readBranches, readCsvFile, writeBranches, writeCsvFile } from './services/csvStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

export const planeacionRouter = express.Router();
export const planeacionApiRouter = express.Router();

function getStoresCsvPath() {
  return process.env.PLANEACION_STORES_CSV_PATH || path.resolve(process.cwd(), 'src', 'modules', 'planeacion', 'data', 'casaley_stores.csv');
}

function parsePlaneacionDate(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!match) return null;
  let month = Number(match[1]);
  let day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month > 12 && day <= 12) [day, month] = [month, day];
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isExpiredVencimiento(rawValue) {
  const vencimiento = parsePlaneacionDate(rawValue);
  if (!vencimiento) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return vencimiento < today;
}

function getPlaneacionStatusTone(rawValue, vencimientoRaw) {
  const value = normalizePlaneacionStatus(rawValue);
  if (value === 'FINALIZADA') return '#16a34a';
  if (value === 'PROGRAMADA') return '#ca8a04';
  if (value === 'PENDIENTE' && isExpiredVencimiento(vencimientoRaw)) return '#dc2626';
  return '#6b7280';
}

function getFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function getBranchStatusFromRow(row) {
  return normalizePlaneacionStatus(
    getFirstDefined(
      row.planeacion_status,
      row.planeacionStatus,
      row['ESTATUS CAPACITACION'],
      row['Estatus Capacitacion'],
      row['Estatus Capacitación'],
      row['Estatus capacitación'],
      row.ESTATUS_CAPACITACION,
      row.estatus_capacitacion,
      row.STATUS,
      row.status,
      row.ESTATUS,
      row.estatus
    ) || 'PENDIENTE'
  ) || 'PENDIENTE';
}

let planeacionStatusIndexCache = { loadedAt: 0, rows: [] };

async function getPlaneacionStatusIndex() {
  const now = Date.now();
  if (planeacionStatusIndexCache.rows.length > 0 && now - planeacionStatusIndexCache.loadedAt < 5 * 60 * 1000) {
    return planeacionStatusIndexCache.rows;
  }
  const rows = await fetchBranchStatusesFromAppSheet();
  planeacionStatusIndexCache = { loadedAt: now, rows };
  return rows;
}

planeacionApiRouter.get('/branches', async (_req, res) => {
  try {
    const csvPath = getStoresCsvPath();
    const rows = readCsvFile(csvPath);
    const appSheetStatuses = await getPlaneacionStatusIndex();
    const statusById = new Map(appSheetStatuses.map((row) => [String(row.id || '').trim(), row.planeacionStatus]));
    const statusByTienda = new Map(appSheetStatuses.map((row) => [String(row.tienda || '').trim(), row.planeacionStatus]));
    const statusByLabel = new Map(appSheetStatuses.map((row) => [String(row.label || '').trim().toLowerCase(), row.planeacionStatus]));
    const normalizeName = (value) => {
      const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
      return cleaned || '';
    };
    const normalized = rows.map((row) => {
      const title = row.title || row.name || row.Label || '';
      const tienda = row.TIENDA || row.tienda || '';
      const label = tienda ? `${tienda} ${title}`.trim() : String(title || '').trim();
      const assignedRaw = row.assigned_month || row.ASSIGNED_MONTH || row.mes || row.MES || '';
      const assignedMonth = assignedRaw === '' || assignedRaw === null || assignedRaw === undefined ? null : Number(assignedRaw);
      const vencimiento = row.VENCIMIENTOESTATAL || row.vencimientoestatal || row.VencimientoEstatal || row['VENCIMIENTO ESTATAL'] || row['Vencimiento Estatal'] || '';
      const localStatus = getBranchStatusFromRow(row);
      const appSheetStatus = statusByTienda.get(String(row.TIENDA || row.tienda || '').trim())
        || statusById.get(String(row.id || row.ID || row.Id || '').trim())
        || statusByLabel.get(String(label || title || '').trim().toLowerCase())
        || '';
      const planeacionStatus = normalizePlaneacionStatus(appSheetStatus || localStatus || 'PENDIENTE') || 'PENDIENTE';
      return {
        id: row.id || row.ID || row.Id || '',
        title: String(title || '').trim(),
        name: label,
        tienda: String(tienda || '').trim(),
        address: row.address || row.street || '',
        city: normalizeName(row.city || row.municipio || row.MUNICIPIO || ''),
        state: normalizeName(row.state || row.estado || row.ESTADO || ''),
        vencimientoEstatal: String(vencimiento || '').trim(),
        lat: row.lat || row.latitude || '',
        lng: row.lng || row.longitude || '',
        assignedMonth: Number.isFinite(assignedMonth) ? assignedMonth : null,
        planeacionStatus,
        planeacionTone: getPlaneacionStatusTone(planeacionStatus, vencimiento),
      };
    });
    const sorted = [...normalized].sort((a, b) => {
      const aNum = Number.parseInt(String(a.title || '').split(' ')[0], 10);
      const bNum = Number.parseInt(String(b.title || '').split(' ')[0], 10);
      const aHas = Number.isFinite(aNum);
      const bHas = Number.isFinite(bNum);
      if (aHas && bHas) return aNum - bNum;
      if (aHas) return -1;
      if (bHas) return 1;
      return String(a.title || '').localeCompare(String(b.title || ''), 'es');
    });
    res.json(sorted);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.post('/sync', async (_req, res) => {
  try {
    const rows = await fetchBranchesFromAppSheet();
    writeBranches(rows);
    res.json({ count: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.all('/geocode-missing', async (req, res) => {
  try {
    const rows = readBranches();
    const limit = Number(req.query.limit || 5);
    const onlyMissing = rows.filter((row) => !row.lat || !row.lng);
    const batch = onlyMissing.slice(0, Math.max(1, limit));
    const remainingMissing = onlyMissing.slice(batch.length);
    const kept = rows.filter((row) => row.lat && row.lng);
    const geocoded = await geocodeMissing(batch);
    const merged = [...kept, ...geocoded.rows, ...remainingMissing];
    writeBranches(merged);
    const withCoords = merged.filter((row) => row.lat && row.lng).length;
    res.json({ total: merged.length, processed: geocoded.rows.length, withCoords, geocoded: geocoded.success, failed: geocoded.failed, remaining: Math.max(0, onlyMissing.length - geocoded.rows.length), lastQueries: geocoded.lastQueries.slice(-5) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.post('/branches/update', async (req, res) => {
  try {
    const { id, assignedMonth, tienda, title, address, city, state, lat, lng } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const csvPath = getStoresCsvPath();
    const rows = readCsvFile(csvPath);
    if (rows.length === 0) return res.status(400).json({ error: 'CSV vacio' });
    const columns = Object.keys(rows[0]);
    const hasAssigned = columns.includes('assigned_month');
    const updatedRows = rows.map((row) => {
      const rowId = row.id || row.ID || row.Id || '';
      if (String(rowId) === String(id)) {
        row.assigned_month = assignedMonth === null || assignedMonth === undefined ? '' : String(assignedMonth);
        if (tienda !== undefined) row.TIENDA = String(tienda).trim();
        if (title !== undefined) row.title = String(title).trim();
        if (address !== undefined) row.street = String(address).trim();
        if (city !== undefined) row.city = String(city).trim();
        if (state !== undefined) row.state = String(state).trim();
        if (lat !== undefined) row.lat = String(lat).trim();
        if (lng !== undefined) row.lng = String(lng).trim();
      }
      return row;
    });
    const finalColumns = hasAssigned ? columns : [...columns, 'assigned_month'];
    writeCsvFile(csvPath, finalColumns, updatedRows);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.get('/reverse-geocode', async (req, res) => {
  try {
    const lat = String(req.query.lat || '');
    const lng = String(req.query.lng || '');
    if (!lat || !lng) return res.status(400).json({ error: 'Missing lat or lng' });
    const params = new URLSearchParams({ lat, lon: lng, format: 'json', zoom: '18', addressdetails: '1', countrycodes: 'mx' });
    const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'planeacion-por-mes/1.0', 'Accept-Language': 'es' } });
    if (!response.ok) return res.status(500).json({ error: await response.text() });
    const data = await response.json();
    res.json({ address: data.display_name || '', raw: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.post('/branches/create', async (req, res) => {
  try {
    const { tienda, title, lat, lng, address, city, state } = req.body;
    if (!tienda || !title) return res.status(400).json({ error: 'Missing required fields' });
    const normalizeKey = (value) => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/^\d+\s+/, '').replace(/\s+/g, ' ').trim();
    const csvPath = getStoresCsvPath();
    const rows = readCsvFile(csvPath);
    const appSheetStatuses = await getPlaneacionStatusIndex();
    const statusById = new Map(appSheetStatuses.map((row) => [String(row.id || '').trim(), row.planeacionStatus]));
    const statusByLabel = new Map(appSheetStatuses.map((row) => [String(row.label || '').trim().toLowerCase(), row.planeacionStatus]));
    if (rows.length === 0) return res.status(400).json({ error: 'CSV vacio' });
    const exists = rows.some((row) => {
      const rowTienda = String(row.TIENDA || row.tienda || '').trim();
      const rowTitle = String(row.title || row.name || '').trim();
      if (rowTienda && rowTienda === String(tienda).trim()) return true;
      return normalizeKey(rowTitle) === normalizeKey(title);
    });
    if (exists) return res.status(409).json({ error: 'Sucursal ya existe' });
    const columns = Object.keys(rows[0]);
    const newRow = {};
    columns.forEach((col) => (newRow[col] = ''));
    const nextId = Math.max(...rows.map((row) => Number.parseInt(String(row.id || row.ID || '0'), 10) || 0)) + 1;
    newRow.id = String(nextId);
    newRow.title = String(title).trim();
    newRow.street = String(address || '').trim();
    newRow.city = String(city || '').trim();
    newRow.state = String(state || '').trim();
    newRow.country = 'Mexico';
    newRow.lat = lat === undefined || lat === null ? '' : String(lat);
    newRow.lng = lng === undefined || lng === null ? '' : String(lng);
    newRow.TIENDA = String(tienda).trim();
    rows.push(newRow);
    writeCsvFile(csvPath, columns, rows);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionRouter.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html') || filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      }
    },
  })
);
planeacionRouter.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
planeacionRouter.get('*splat', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

