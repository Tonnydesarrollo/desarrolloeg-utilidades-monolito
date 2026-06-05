function getFirst(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function getFlexibleValue(row, keys) {
  if (!row || typeof row !== 'object') return undefined;
  const normalized = new Map();
  for (const key of Object.keys(row)) {
    normalized.set(String(key).trim().toLowerCase().replace(/\s+/g, ' '), key);
  }
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
      return direct;
    }
    const normalizedKey = String(key).trim().toLowerCase().replace(/\s+/g, ' ');
    const matchedKey = normalized.get(normalizedKey);
    if (matchedKey) {
      const value = row[matchedKey];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }
  }
  return undefined;
}

function setIfPresent(target, key, value) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (!text) return;
  target[key] = value;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseLatLng(row) {
  const combined = getFlexibleValue(row, ['lat/lng', 'LAT/LNG', 'Lat/Lng', 'lat_lng', 'LAT_LNG']);
  if (typeof combined === 'string') {
    const parts = combined.replace(/[()]/g, '').split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const parsedLat = toNumber(parts[0]);
      const parsedLng = toNumber(parts[1]);
      if (parsedLat !== undefined && parsedLng !== undefined) return { lat: parsedLat, lng: parsedLng };
    }
  }

  const lat = toNumber(getFlexibleValue(row, ['LAT', 'Lat', 'lat', 'LATITUD', 'Latitud', 'latitude']));
  const lng = toNumber(getFlexibleValue(row, ['LNG', 'Lng', 'lng', 'LONGITUD', 'Longitud', 'longitude']));
  if (lat !== undefined && lng !== undefined) return { lat, lng };

  const locationRaw = getFlexibleValue(row, ['LOCATION', 'Location', 'Ubicacion', 'Ubicación', 'Geo', 'GEOCODE', 'LatLng', 'LATLNG', 'Coords', 'COORDS']);
  if (typeof locationRaw === 'string') {
    const cleaned = locationRaw.replace(/[()]/g, '').trim();
    const parts = cleaned.split(',').map((p) => p.trim());
    if (parts.length >= 2) {
      const parsedLat = toNumber(parts[0]);
      const parsedLng = toNumber(parts[1]);
      if (parsedLat !== undefined && parsedLng !== undefined) {
        return { lat: parsedLat, lng: parsedLng };
      }
    }
  }
  return undefined;
}

function getBranchKey(row) {
  return String(getFlexibleValue(row, ['TIENDA', 'Tienda', 'tienda', 'ID', 'Id', 'id']) ?? '').trim();
}

function getBranchLabel(row, fallback = '') {
  return String(getFlexibleValue(row, [
    'LABEL2',
    'Label2',
    'LABEL',
    'Label',
    'label',
    'NOMBRE',
    'Nombre',
    'name',
    'SUCURSAL',
    'Sucursal',
    'title',
  ]) ?? fallback).trim();
}

function getBranchAddress(row, fallback = '') {
  return String(getFlexibleValue(row, [
    'DIRECCION GOOGLE',
    'Direccion Google',
    'DIRECCION_GOOGLE',
    'direccion_google',
    'DIRECCION',
    'Direccion',
    'address',
    'street',
  ]) ?? fallback).trim();
}

function getAssignedMonth(row) {
  const raw = getFlexibleValue(row, [
    'MES PLANEACION',
    'MES_PLANEACION',
    'MES PLANEADO',
    'MES_PLANEADO',
    'assigned_month',
    'ASSIGNED_MONTH',
    'MES CAPACITACION',
    'MES_CAPACITACION',
    'MES',
    'Mes',
  ]);
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function normalizePlaneacionMonthForStorage(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return text;
  if (parsed <= 0) return null;
  return parsed;
}

export function normalizePlaneacionMonthFromCsv(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return text;
  if (parsed < 0) return null;
  return parsed + 1;
}

function getVencimientoEstatal(row) {
  return String(getFlexibleValue(row, [
    'VENCIMIENTOESTATAL',
    'VencimientoEstatal',
    'VENCIMIENTO ESTATAL',
    'Vencimiento Estatal',
  ]) ?? '').trim();
}

export function normalizePlaneacionStatus(rawValue) {
  const value = String(rawValue || '').trim().toUpperCase();
  if (!value) return '';
  if (value === 'FINALIZADA' || value.includes('FINAL') || value.includes('CAPAC')) return 'FINALIZADA';
  if (value === 'PROGRAMADA' || value.includes('PROGRAM')) return 'PROGRAMADA';
  if (value === 'PENDIENTE' || value.includes('PEND')) return 'PENDIENTE';
  return value;
}

function getPlaneacionStatusValue(row) {
  return getFlexibleValue(row, [
    'ESTATUS CAPACITACION',
    'Estatus Capacitacion',
    'Estatus capacitación',
    'Estatus Capacitación',
    'ESTATUS_CAPACITACION',
    'estatus_capacitacion',
    'PLANEACION_STATUS',
    'Planeacion Status',
    'planeacion_status',
    'STATUS',
    'Status',
    'status',
  ]);
}

async function appsheetFind(table) {
  const APP_ID = (process.env.PLANEACION_APPSHEET_APP_ID || process.env.APPSHEET_APP_ID || '').trim();
  const API_KEY = (process.env.PLANEACION_APPSHEET_API_KEY || process.env.APPSHEET_API_KEY || '').trim();
  if (!APP_ID || !API_KEY) throw new Error('Faltan credenciales AppSheet de planeacion');

  const url = `https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${table}/Action`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ApplicationAccessKey: API_KEY,
    },
    body: JSON.stringify({
      Action: 'Find',
      Properties: { Locale: 'es-ES', Timezone: 'America/Mexico_City' },
      Rows: [],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AppSheet API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : data.Rows ?? [];
}

async function appsheetAction(table, action, rows = [], properties = {}) {
  const APP_ID = (process.env.PLANEACION_APPSHEET_APP_ID || process.env.APPSHEET_APP_ID || '').trim();
  const API_KEY = (process.env.PLANEACION_APPSHEET_API_KEY || process.env.APPSHEET_API_KEY || '').trim();
  if (!APP_ID || !API_KEY) throw new Error('Faltan credenciales AppSheet de planeacion');

  const url = `https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${table}/Action`;
  const body = JSON.stringify({
    Action: action,
    Properties: {
      Locale: 'es-ES',
      Timezone: 'America/Mexico_City',
      ...properties,
    },
    Rows: rows,
  });

  const maxAttempts = 4;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ApplicationAccessKey: API_KEY,
      },
      body,
    });

    const text = await response.text();
    if (response.ok) {
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    lastError = new Error(`AppSheet API error ${response.status}: ${text}`);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) break;

    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = Number(String(retryAfterHeader || '').trim());
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : Math.min(1500 * attempt, 6000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw lastError || new Error(`AppSheet API error on ${action} ${table}`);
}

async function appsheetEdit(table, row) {
  return appsheetAction(table, 'Edit', [row]);
}

async function appsheetUpsert(table, row) {
  try {
    return await appsheetEdit(table, row);
  } catch (error) {
    return appsheetAction(table, 'Add', [row]);
  }
}

export async function fetchBranchStatusesFromAppSheet() {
  const sucursales = await appsheetFind('SUCURSALES');
  return sucursales
    .map((row) => {
      const id = getBranchKey(row);
      if (!id) return null;
      const tienda = String(getFlexibleValue(row, ['TIENDA', 'Tienda', 'tienda']) ?? '').trim();
      const label = getBranchLabel(row, id);
      const planeacionStatus = normalizePlaneacionStatus(getPlaneacionStatusValue(row));
      return { id, label, tienda, planeacionStatus };
    })
    .filter(Boolean);
}

export async function fetchBranchesFromAppSheet() {
  const [sucursales, municipios, estados, empresas] = await Promise.all([
    appsheetFind('SUCURSALES'),
    appsheetFind('MUNICIPIOS'),
    appsheetFind('ESTADOS'),
    appsheetFind('EMPRESAS'),
  ]);

  const municipiosMap = new Map();
  for (const row of municipios) {
    const id = getFlexibleValue(row, ['ID', 'Id', 'id']);
    const nombre = getFlexibleValue(row, ['NOMBRE', 'Nombre', 'name']);
    if (id !== undefined && nombre !== undefined) municipiosMap.set(String(id), String(nombre));
  }

  const estadosMap = new Map();
  for (const row of estados) {
    const id = getFlexibleValue(row, ['ID', 'Id', 'id']);
    const nombre = getFlexibleValue(row, ['NOMBRE', 'Nombre', 'name']);
    if (id !== undefined && nombre !== undefined) estadosMap.set(String(id), String(nombre));
  }

  const empresasMap = new Map();
  for (const row of empresas) {
    const id = getFlexibleValue(row, ['ID', 'Id', 'id']);
    const nombre = getFlexibleValue(row, ['RAZON SOCIAL', 'Razón Social', 'Razon Social', 'Nombre']);
    if (id !== undefined && nombre !== undefined) empresasMap.set(String(id), String(nombre));
  }

  const now = new Date().toISOString();
  const result = [];

  for (const row of sucursales) {
    const tienda = String(getFlexibleValue(row, ['TIENDA', 'Tienda', 'tienda']) ?? '').trim();
    const id = tienda || String(getFlexibleValue(row, ['ID', 'Id', 'id']) ?? '').trim();
    if (!id) continue;

    const label = getBranchLabel(row, id);
    const planeacionStatus = normalizePlaneacionStatus(getPlaneacionStatusValue(row));
    const municipioId = String(getFlexibleValue(row, ['MUNICIPIO', 'Municipio', 'municipio']) ?? '').trim();
    const estadoId = String(getFlexibleValue(row, ['ESTADO', 'Estado', 'estado']) ?? '').trim();
    const empresaId = String(getFlexibleValue(row, ['EMPRESA', 'Empresa', 'ID EMPRESA', 'empresa']) ?? '').trim();
    const municipioNombre = municipiosMap.get(municipioId) ?? '';
    const estadoNombre = estadosMap.get(estadoId) ?? '';
    const empresaNombre = empresasMap.get(empresaId) ?? '';
    const coords = parseLatLng(row);
    const addressGoogle = getBranchAddress(row);
    const assignedMonth = getAssignedMonth(row);
    const vencimientoEstatal = getVencimientoEstatal(row);
    const address = addressGoogle || [label, municipioNombre, estadoNombre, 'Mexico'].filter(Boolean).join(', ');

      result.push({
        id,
        tienda,
        appsheetId: String(getFlexibleValue(row, ['ID', 'Id', 'id']) ?? '').trim(),
        rowId: row['Row ID'] || row.RowID || row.rowId || row.rowID || '',
        label,
      title: label,
      name: label,
      empresa_id: empresaId,
      empresa_nombre: empresaNombre,
      municipio_id: municipioId,
        municipio_nombre: municipioNombre,
        estado_id: estadoId,
        estado_nombre: estadoNombre,
        'lat/lng': coords ? `${coords.lat}, ${coords.lng}` : '',
        lat: coords ? String(coords.lat) : '',
        lng: coords ? String(coords.lng) : '',
        address,
        street: addressGoogle,
      city: municipioNombre,
      state: estadoNombre,
      assignedMonth,
      vencimientoEstatal,
      planeacion_status: planeacionStatus,
      updated_at: now,
    });
  }

  return result;
}

export async function upsertBranchToAppSheet(row) {
  const tienda = String(getFlexibleValue(row, ['TIENDA', 'Tienda', 'tienda']) ?? '').trim();
  if (!tienda) throw new Error('Falta TIENDA para guardar en AppSheet');

  const address = String(getFlexibleValue(row, ['DIRECCION GOOGLE', 'Direccion Google', 'DIRECCION', 'Direccion', 'address', 'street']) ?? '').trim();
  const payload = {
    TIENDA: tienda,
  };
  setIfPresent(payload, 'ID', getFlexibleValue(row, ['ID', 'Id', 'id']));
  setIfPresent(payload, 'title', getFlexibleValue(row, ['title', 'TITLE', 'Label2', 'LABEL2']));
  setIfPresent(payload, 'name', getFlexibleValue(row, ['name', 'NAME', 'LABEL', 'Label']));
  setIfPresent(payload, 'address', address);
  setIfPresent(payload, 'DIRECCION GOOGLE', address);
  setIfPresent(payload, 'city', getFlexibleValue(row, ['city', 'CITY', 'municipio_nombre', 'MUNICIPIO']));
  setIfPresent(payload, 'state', getFlexibleValue(row, ['state', 'STATE', 'estado_nombre', 'ESTADO']));
  const latLng = getFlexibleValue(row, ['lat/lng', 'LAT/LNG', 'Lat/Lng', 'lat_lng', 'LAT_LNG', 'lat', 'LAT', 'lng', 'LNG']);
  setIfPresent(payload, 'lat/lng', latLng);
  const month = normalizePlaneacionMonthForStorage(getFlexibleValue(row, [
    'MES PLANEACION',
    'MES_PLANEACION',
    'MES PLANEADO',
    'MES_PLANEADO',
    'assigned_month',
    'ASSIGNED_MONTH',
    'MES CAPACITACION',
    'MES_CAPACITACION',
  ]));
  if (month !== null && month !== undefined && String(month).trim() !== '') {
    payload['MES PLANEACION'] = month;
  }
  setIfPresent(payload, 'VENCIMIENTOESTATAL', getFlexibleValue(row, ['VENCIMIENTOESTATAL', 'VencimientoEstatal', 'VENCIMIENTO ESTATAL']));
  const status = normalizePlaneacionStatus(getFlexibleValue(row, ['ESTATUS CAPACITACION', 'Estatus Capacitacion', 'planeacion_status']));
  if (status) payload['ESTATUS CAPACITACION'] = status;

  return appsheetUpsert('SUCURSALES', payload);
}

export async function updateBranchLocationInAppSheet(row) {
  const tienda = String(getFlexibleValue(row, ['TIENDA', 'Tienda', 'tienda']) ?? '').trim();
  if (!tienda) throw new Error('Falta TIENDA para actualizar en AppSheet');

  const address = String(getFlexibleValue(row, ['DIRECCION GOOGLE', 'Direccion Google', 'DIRECCION', 'Direccion', 'address', 'street']) ?? '').trim();
  const payload = {
    TIENDA: tienda,
  };
  setIfPresent(payload, 'ID', getFlexibleValue(row, ['ID', 'Id', 'id']));
  setIfPresent(payload, 'address', address);
  setIfPresent(payload, 'DIRECCION GOOGLE', address);
  const latLng = getFlexibleValue(row, ['lat/lng', 'LAT/LNG', 'Lat/Lng', 'lat_lng', 'LAT_LNG', 'lat', 'LAT', 'lng', 'LNG']);
  setIfPresent(payload, 'lat/lng', latLng);
  const month = normalizePlaneacionMonthForStorage(getFlexibleValue(row, [
    'MES PLANEACION',
    'MES_PLANEACION',
    'MES PLANEADO',
    'MES_PLANEADO',
    'assigned_month',
    'ASSIGNED_MONTH',
    'MES CAPACITACION',
    'MES_CAPACITACION',
  ]));
  if (month !== null && month !== undefined && String(month).trim() !== '') {
    payload['MES PLANEACION'] = month;
  }
  return appsheetEdit('SUCURSALES', payload);
}

export async function updateBranchPlaneacionInAppSheet(row) {
  const tienda = String(getFlexibleValue(row, ['TIENDA', 'Tienda', 'tienda']) ?? '').trim();
  if (!tienda) throw new Error('Falta TIENDA para actualizar en AppSheet');

  const payload = {
    TIENDA: tienda,
  };
  setIfPresent(payload, 'ID', getFlexibleValue(row, ['ID', 'Id', 'id']));
  setIfPresent(payload, 'DIRECCION GOOGLE', getFlexibleValue(row, ['DIRECCION GOOGLE', 'Direccion Google', 'DIRECCION', 'Direccion', 'address', 'street']));
  setIfPresent(payload, 'lat/lng', getFlexibleValue(row, ['lat/lng', 'LAT/LNG', 'Lat/Lng', 'lat_lng', 'LAT_LNG', 'lat', 'LAT', 'lng', 'LNG']));

  const month = getFlexibleValue(row, [
    'MES PLANEACION',
    'MES_PLANEACION',
    'MES PLANEADO',
    'MES_PLANEADO',
    'assigned_month',
    'ASSIGNED_MONTH',
    'MES CAPACITACION',
    'MES_CAPACITACION',
  ]);
  if (month !== undefined && month !== null && String(month).trim() !== '') {
    payload['MES PLANEACION'] = String(normalizePlaneacionMonthForStorage(month));
  }

  return appsheetEdit('SUCURSALES', payload);
}
