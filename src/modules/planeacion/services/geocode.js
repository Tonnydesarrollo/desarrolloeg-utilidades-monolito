const USER_AGENT = 'planeacion-por-mes/1.0';
const EMAIL = (process.env.GEOCODER_EMAIL || process.env.PLANEACION_GEOCODER_EMAIL || '').trim();

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchNominatim(query, timeoutMs = 8000) {
  const params = new URLSearchParams({ q: query, format: 'json', limit: '1', addressdetails: '0', countrycodes: 'mx' });
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es', ...(EMAIL ? { From: EMAIL } : {}) },
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!response.ok) throw new Error(`Nominatim error ${response.status}`);
  const data = await response.json();
  if (data[0]?.lat && data[0]?.lon) return { lat: data[0].lat, lng: data[0].lon };
  return undefined;
}

function buildQueries(row) {
  const primary = row.address?.trim();
  const fallback = [row.label, row.municipio_nombre, row.estado_nombre, 'Mexico'].filter((p) => p && p.trim() !== '').join(', ');
  const strippedPrimary = primary ? primary.replace(/^\s*\d+\s+/g, '').trim() : '';
  const municipioEstado = [row.municipio_nombre, row.estado_nombre, 'Mexico'].filter((p) => p && p.trim() !== '').join(', ');
  return Array.from(new Set([primary, strippedPrimary, fallback, municipioEstado].filter(Boolean)));
}

export async function geocodeMissing(rows) {
  const updated = [];
  let success = 0;
  let failed = 0;
  const lastQueries = [];

  for (const row of rows) {
    if (row.lat && row.lng) { updated.push(row); continue; }
    const queries = buildQueries(row);
    if (queries.length === 0) { updated.push(row); failed += 1; continue; }
    let resolved = false;
    for (const query of queries) {
      try {
        const result = await fetchNominatim(query);
        if (result) {
          row.lat = result.lat; row.lng = result.lng; resolved = true; lastQueries.push({ id: row.id, query, found: true }); break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        console.warn(`Geocode error for "${query}": ${message}`);
      }
      lastQueries.push({ id: row.id, query, found: false });
      await sleep(1200);
    }
    if (resolved) success += 1; else failed += 1;
    updated.push(row);
    await sleep(1200);
  }
  return { rows: updated, success, failed, lastQueries };
}
