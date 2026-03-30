function getFirst(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
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
  const lat = toNumber(getFirst(row, ['LAT', 'Lat', 'lat', 'LATITUD', 'Latitud', 'latitude']));
  const lng = toNumber(getFirst(row, ['LNG', 'Lng', 'lng', 'LONGITUD', 'Longitud', 'longitude']));
  if (lat !== undefined && lng !== undefined) return { lat, lng };

  const locationRaw = getFirst(row, ['LOCATION', 'Location', 'Ubicacion', 'Ubicación', 'Geo', 'GEOCODE', 'LatLng', 'LATLNG', 'Coords', 'COORDS']);
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

export async function fetchBranchesFromAppSheet() {
  const [sucursales, municipios, estados, empresas] = await Promise.all([
    appsheetFind('SUCURSALES'),
    appsheetFind('MUNICIPIOS'),
    appsheetFind('ESTADOS'),
    appsheetFind('EMPRESAS'),
  ]);

  const municipiosMap = new Map();
  for (const row of municipios) {
    const id = getFirst(row, ['ID', 'Id', 'id']);
    const nombre = getFirst(row, ['NOMBRE', 'Nombre', 'name']);
    if (id !== undefined && nombre !== undefined) municipiosMap.set(String(id), String(nombre));
  }

  const estadosMap = new Map();
  for (const row of estados) {
    const id = getFirst(row, ['ID', 'Id', 'id']);
    const nombre = getFirst(row, ['NOMBRE', 'Nombre', 'name']);
    if (id !== undefined && nombre !== undefined) estadosMap.set(String(id), String(nombre));
  }

  const empresasMap = new Map();
  for (const row of empresas) {
    const id = getFirst(row, ['ID', 'Id', 'id']);
    const nombre = getFirst(row, ['RAZON SOCIAL', 'Razón Social', 'Razon Social', 'Nombre']);
    if (id !== undefined && nombre !== undefined) empresasMap.set(String(id), String(nombre));
  }

  const now = new Date().toISOString();
  const result = [];

  for (const row of sucursales) {
    const id = String(getFirst(row, ['ID', 'Id', 'id']) ?? '');
    if (!id) continue;

    const label = String(getFirst(row, ['LABEL', 'Label', 'label', 'NOMBRE', 'Nombre', 'name', 'SUCURSAL', 'Sucursal']) ?? id);
    const municipioId = String(getFirst(row, ['MUNICIPIO', 'Municipio', 'municipio']) ?? '');
    const estadoId = String(getFirst(row, ['ESTADO', 'Estado', 'estado']) ?? '');
    const empresaId = String(getFirst(row, ['EMPRESA', 'Empresa', 'ID EMPRESA', 'empresa']) ?? '');
    const municipioNombre = municipiosMap.get(municipioId) ?? '';
    const estadoNombre = estadosMap.get(estadoId) ?? '';
    const empresaNombre = empresasMap.get(empresaId) ?? '';
    const coords = parseLatLng(row);
    const address = [label, municipioNombre, estadoNombre, 'Mexico'].filter(Boolean).join(', ');

    result.push({
      id,
      label,
      empresa_id: empresaId,
      empresa_nombre: empresaNombre,
      municipio_id: municipioId,
      municipio_nombre: municipioNombre,
      estado_id: estadoId,
      estado_nombre: estadoNombre,
      lat: coords ? String(coords.lat) : '',
      lng: coords ? String(coords.lng) : '',
      address,
      updated_at: now,
    });
  }

  return result;
}
