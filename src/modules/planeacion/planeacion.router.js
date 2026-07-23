import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readCsvFile } from './services/csvStore.js';
import { fetchBranchesFromAppSheet, normalizePlaneacionMonthForStorage, normalizePlaneacionMonthFromCsv, normalizePlaneacionStatus, updateBranchLocationInAppSheet, updateBranchPlaneacionInAppSheet, upsertBranchToAppSheet } from './services/appsheet.js';
import { geocodeMissing } from './services/geocode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const casaleyCsvPath = path.join(__dirname, 'data', 'casaley_stores.csv');
const planeacionRuntimeDir = path.join(process.cwd(), 'runtime', 'planeacion');
const branchesCacheFile = path.join(planeacionRuntimeDir, 'branches-cache.json');

export const planeacionRouter = express.Router();
export const planeacionApiRouter = express.Router();

const branchesCacheTtlMs = Number(process.env.PLANEACION_BRANCHES_CACHE_TTL_MS || 5 * 60 * 1000);
let branchesCache = {
  at: 0,
  data: null,
  pending: null,
};

function invalidateBranchesCache() {
  branchesCache = {
    at: 0,
    data: null,
    pending: null,
  };
  try {
    if (fs.existsSync(branchesCacheFile)) {
      fs.rmSync(branchesCacheFile, { force: true });
    }
  } catch {
    // ignore
  }
}

async function getBranchesCached({ force = false } = {}) {
  const now = Date.now();
  const fresh = branchesCache.data && now - branchesCache.at < branchesCacheTtlMs;
  if (!force && fresh) return branchesCache.data;
  if (!force) {
    try {
      if (fs.existsSync(branchesCacheFile)) {
        const raw = fs.readFileSync(branchesCacheFile, 'utf8');
        if (raw) {
          const parsed = JSON.parse(raw);
          const diskData = Array.isArray(parsed?.data) ? parsed.data : null;
          const diskAt = Number(parsed?.at || 0);
          if (diskData && diskAt && now - diskAt < branchesCacheTtlMs) {
            branchesCache = { at: diskAt, data: diskData, pending: null };
            return diskData;
          }
        }
      }
    } catch {
      // ignore cache read errors
    }
  }
  if (branchesCache.pending) return branchesCache.pending;
  branchesCache.pending = fetchBranchesFromAppSheet()
    .then((rows) => {
      branchesCache = { at: Date.now(), data: rows, pending: null };
      try {
        fs.mkdirSync(planeacionRuntimeDir, { recursive: true });
        fs.writeFileSync(branchesCacheFile, JSON.stringify({ at: branchesCache.at, data: rows }), 'utf8');
      } catch {
        // ignore cache write errors
      }
      return rows;
    })
    .catch((error) => {
      branchesCache.pending = null;
      throw error;
    });
  return branchesCache.pending;
}

export async function warmPlaneacionBranchesCache() {
  try {
    await getBranchesCached();
  } catch {
    // ignore warmup failures
  }
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

function splitLatLngValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return { lat: '', lng: '' };
  const parts = value.replace(/[()]/g, '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { lat: parts[0], lng: parts[1] };
  return { lat: '', lng: '' };
}

function buildCsvLatLng(row) {
  const combined = String(row['lat/lng'] || row.lat_lng || row.latLng || '').trim();
  if (combined) return combined;
  const lat = String(row.lat || row.latitude || '').trim();
  const lng = String(row.lng || row.longitude || '').trim();
  if (lat && lng) return `${lat}, ${lng}`;
  return lat || lng || '';
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

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getBranchStatusFromRow(row) {
  return normalizePlaneacionStatus(
    row.planeacion_status ||
      row.planeacionStatus ||
      row['ESTATUS CAPACITACION'] ||
      row['Estatus Capacitacion'] ||
      row['Estatus Capacitación'] ||
      row['Estatus capacitación'] ||
      row.ESTATUS_CAPACITACION ||
      row.estatus_capacitacion ||
      row.STATUS ||
      row.status ||
      row.ESTATUS ||
      row.estatus ||
      'PENDIENTE'
  ) || 'PENDIENTE';
}

function getBranchIdentifier(row) {
  return String(row.tienda || row.TIENDA || row.id || row.ID || row.Id || '').trim();
}

function getBranchTitle(row) {
  return String(row.title || row.name || row.label || row.Label || row.LABEL || row.SUCURSAL || '').trim();
}

function getBranchAddress(row) {
  return String(row.address || row.street || row['DIRECCION GOOGLE'] || row['Direccion Google'] || row['DIRECCION'] || row['Direccion'] || '').trim();
}

planeacionApiRouter.get('/branches', async (_req, res) => {
  try {
    const rows = await getBranchesCached();
    const normalized = rows.map((row) => {
      const title = normalizeText(getBranchTitle(row));
      const tienda = normalizeText(row.tienda || row.TIENDA || '');
      const id = normalizeText(row.id || tienda || '');
      const assignedRaw = row.assignedMonth ?? row.assigned_month ?? row.ASSIGNED_MONTH ?? row['MES PLANEACION'] ?? row.MES_PLANEACION ?? row['MES PLANEADO'] ?? row.MES_PLANEADO ?? row.MES ?? row.mes ?? '';
      const assignedMonth = assignedRaw === '' || assignedRaw === null || assignedRaw === undefined ? null : Number(assignedRaw);
      const vencimiento = normalizeText(row.vencimientoEstatal || row.VENCIMIENTOESTATAL || row.vencimientoestatal || row.VencimientoEstatal || row['VENCIMIENTO ESTATAL'] || row['Vencimiento Estatal'] || '');
      const planeacionStatus = normalizePlaneacionStatus(row.planeacion_status || row.planeacionStatus || getBranchStatusFromRow(row) || 'PENDIENTE') || 'PENDIENTE';
      const latLngValue = String(row['lat/lng'] || row.lat || row.latitude || row.lng || row.longitude || '').trim();
      const splitCoords = splitLatLngValue(latLngValue);
      const normalizedAssignedMonth = assignedMonth !== null && assignedMonth !== undefined && assignedMonth !== ''
        ? normalizePlaneacionMonthForStorage(assignedMonth)
        : null;
      return {
        id: id || tienda,
        title,
        name: normalizeText(row.name || title || tienda || id),
        tienda,
        address: getBranchAddress(row),
        city: normalizeText(row.city || row.municipio_nombre || row.municipio || row.MUNICIPIO || ''),
          state: normalizeText(row.state || row.estado_nombre || row.estado || row.ESTADO || ''),
          vencimientoEstatal: vencimiento,
          'lat/lng': latLngValue,
          ...splitCoords,
          assignedMonth: normalizedAssignedMonth,
        planeacionStatus,
        planeacionTone: getPlaneacionStatusTone(planeacionStatus, vencimiento),
      };
    });
    const sorted = [...normalized].sort((a, b) => {
      const aNum = Number.parseInt(String(a.tienda || a.id || a.title || '').split(' ')[0], 10);
      const bNum = Number.parseInt(String(b.tienda || b.id || b.title || '').split(' ')[0], 10);
      const aHas = Number.isFinite(aNum);
      const bHas = Number.isFinite(bNum);
      if (aHas && bHas) return aNum - bNum;
      if (aHas) return -1;
      if (bHas) return 1;
      return String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''), 'es');
    });
    res.json(sorted);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.post('/sync', async (_req, res) => {
  try {
    const rows = await getBranchesCached({ force: true });
    res.json({ count: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.post('/migrate-casaley-csv', async (_req, res) => {
    try {
      const rows = readCsvFile(casaleyCsvPath);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'No hay filas en el CSV de origen' });
      }

      const existingRows = await getBranchesCached({ force: true });
      const appsheetIdByTienda = new Map(
        existingRows
          .map((row) => [normalizeText(row.tienda || row.TIENDA || ''), row.appsheetId || ''])
          .filter(([tienda, rowId]) => tienda && rowId)
      );

    let migrated = 0;
    let skipped = 0;
    const failures = [];

      for (const row of rows) {
        const tienda = String(row.TIENDA || row.tienda || row.id || row.ID || '').trim();
        const title = String(row.title || row.name || row.label || row.SUCURSAL || tienda).trim();
        const street = String(row.street || row.address || row['DIRECCION GOOGLE'] || row['Direccion Google'] || '').trim();
      const city = String(row.city || row.municipio_nombre || row.municipio || row.MUNICIPIO || '').trim();
      const state = String(row.state || row.estado_nombre || row.estado || row.ESTADO || '').trim();
        const lat = String(row.lat || row.latitude || '').trim();
        const lng = String(row.lng || row.longitude || '').trim();
        const latLng = lat && lng ? `${lat}, ${lng}` : String(row['lat/lng'] || row['lat_lng'] || '').trim();
        const assignedMonth = String(row['MES PLANEADO'] || row.MES_PLANEADO || row['MES PLANEACION'] || row.MES_PLANEACION || row.assigned_month || row.assignedMonth || row.ASSIGNED_MONTH || '').trim();
      const vencimiento = String(row.VENCIMIENTOESTATAL || row.vencimientoEstatal || row.VencimientoEstatal || '').trim();

        if (!tienda) {
          skipped += 1;
          continue;
        }

        try {
          const normalizedAssignedMonth = normalizePlaneacionMonthFromCsv(assignedMonth);
          if (assignedMonth && normalizedAssignedMonth === null) {
            failures.push({
              tienda,
              title,
              error: `Mes de planeacion invalido: ${assignedMonth}`,
            });
            continue;
          }

          await updateBranchPlaneacionInAppSheet({
            ID: appsheetIdByTienda.get(tienda) || '',
            TIENDA: tienda,
            'DIRECCION GOOGLE': street,
            'lat/lng': latLng,
            'MES PLANEACION': normalizedAssignedMonth,
          });
        migrated += 1;
      } catch (error) {
        failures.push({
          tienda,
          title,
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    res.json({
      total: rows.length,
      migrated,
      skipped,
      failed: failures.length,
      failures: failures.slice(0, 10),
      source: 'casaley_stores.csv',
      target: 'SUCURSALES.DIRECCION GOOGLE',
    });
    invalidateBranchesCache();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.all('/geocode-missing', async (req, res) => {
  try {
    const rows = await getBranchesCached({ force: true });
    const limit = Number(req.query.limit || 5);
    const onlyMissing = rows.filter((row) => !row.lat || !row.lng);
    const batch = onlyMissing.slice(0, Math.max(1, limit));
    const remainingMissing = onlyMissing.slice(batch.length);
    const kept = rows.filter((row) => row.lat && row.lng);
    const geocoded = await geocodeMissing(batch);
    const rowByTienda = new Map(
      rows
        .map((row) => [normalizeText(row.tienda || row.TIENDA || ''), row])
        .filter(([tienda, row]) => tienda && row)
    );
    await Promise.all(
      geocoded.rows.map((row) => updateBranchLocationInAppSheet({
        ID: rowByTienda.get(normalizeText(row.tienda || row.TIENDA || ''))?.appsheetId || '',
        TIENDA: row.tienda || row.id || row.TIENDA || row.rowId || '',
        id: row.tienda || row.id || row.TIENDA || row.rowId || '',
        address: row.address || '',
        'lat/lng': row['lat/lng'] || row.lat || row.lng || '',
      }))
    );
    invalidateBranchesCache();
    const withCoords = kept.length + geocoded.rows.length;
    res.json({
      total: rows.length,
      processed: geocoded.rows.length,
      withCoords,
      geocoded: geocoded.success,
      failed: geocoded.failed,
      remaining: Math.max(0, onlyMissing.length - geocoded.rows.length),
      lastQueries: geocoded.lastQueries.slice(-5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    res.status(500).json({ error: message });
  }
});

planeacionApiRouter.post('/branches/update', async (req, res) => {
  try {
    const { id, assignedMonth, tienda, title, address, city, state, lat, lng } = req.body;
    const key = normalizeText(tienda || id);
    if (!key) return res.status(400).json({ error: 'Missing tienda/id' });

    const existingRows = await getBranchesCached({ force: true });
    const current = existingRows.find((row) => normalizeText(row.tienda || row.id || row.TIENDA || '') === key);

      await updateBranchLocationInAppSheet({
        ID: current?.appsheetId || '',
        TIENDA: key,
        id: key,
        title: title !== undefined ? normalizeText(title) : '',
        name: title !== undefined ? normalizeText(title) : '',
        address: address !== undefined ? normalizeText(address) : '',
      city: city !== undefined ? normalizeText(city) : '',
        state: state !== undefined ? normalizeText(state) : '',
        'lat/lng': lat !== undefined && lat !== null && lng !== undefined && lng !== null
          ? `${String(lat).trim()}, ${String(lng).trim()}`
          : String(req.body['lat/lng'] ?? req.body['lat_lng'] ?? req.body.latlng ?? '').trim(),
        'MES PLANEACION': assignedMonth === null || assignedMonth === undefined || String(assignedMonth).trim() === ''
          ? ''
          : String(normalizePlaneacionMonthForStorage(assignedMonth)),
    });
    invalidateBranchesCache();
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
    await upsertBranchToAppSheet({
      TIENDA: normalizeText(tienda),
      id: normalizeText(tienda),
      title: normalizeText(title),
      name: normalizeText(title),
      address: normalizeText(address),
      city: normalizeText(city),
      state: normalizeText(state),
      'lat/lng': lat !== undefined && lat !== null && lng !== undefined && lng !== null
          ? `${String(lat).trim()}, ${String(lng).trim()}`
          : String(req.body['lat/lng'] ?? req.body['lat_lng'] ?? req.body.latlng ?? '').trim(),
        'MES PLANEACION': '',
      'ESTATUS CAPACITACION': 'PENDIENTE',
    });
    invalidateBranchesCache();
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
