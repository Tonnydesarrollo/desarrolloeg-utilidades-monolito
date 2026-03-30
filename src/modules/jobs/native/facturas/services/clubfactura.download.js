import { client } from '../config/axios.js';
import { iniciarSesionWeb } from './clubfactura.session.js';
import { loginClubFactura } from './clubfactura.auth.js';

const AUTH_TTL_MS = 25 * 60 * 1000;
let lastAuthAt = 0;

async function ensureAuth(force = false) {
  const hasAuthHeader = Boolean(client.defaults.headers.common?.Authorization);
  const isFresh = Date.now() - lastAuthAt < AUTH_TTL_MS;
  if (!force && hasAuthHeader && isFresh) return;
  await iniciarSesionWeb();
  await loginClubFactura();
  lastAuthAt = Date.now();
}

async function requestWithRetry(makeRequest) {
  try {
    await ensureAuth(false);
    return await makeRequest();
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401) {
      await ensureAuth(true);
      return await makeRequest();
    }
    throw error;
  }
}

async function followTempFileIfNeeded(response) {
  const contentType = response?.headers?.['content-type'] || '';
  if (!contentType.includes('application/json')) return response;

  let payload = null;
  try {
    const text = Buffer.from(response.data).toString('utf8');
    payload = JSON.parse(text);
  } catch {
    return response;
  }

  const token = payload?.uuid || payload?.fileToken || payload?.token || payload?.id || null;
  if (!token) return response;

  return client.get(`/api/File/DownloadTempFileFromSession?uuid=${encodeURIComponent(token)}`, {
    responseType: 'arraybuffer'
  });
}

export async function descargarXml(id) {
  return requestWithRetry(async () => {
    const response = await client.get(`/api/CFDI/DownloadXml?id=${id}`, { responseType: 'arraybuffer' });
    return followTempFileIfNeeded(response);
  });
}

export async function descargarPdf(id) {
  return requestWithRetry(async () => {
    const response = await client.post(
      '/api/CFDI/DownloadPDF',
      { id },
      { responseType: 'arraybuffer' }
    );
    return followTempFileIfNeeded(response);
  });
}
