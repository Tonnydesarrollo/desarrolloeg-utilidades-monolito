import fs from 'fs';
import { iniciarSesionWeb } from './services/clubfactura.session.js';
import { loginClubFactura } from './services/clubfactura.auth.js';
import { obtenerFacturasEmitidas } from './services/clubfactura.facturas.js';
import { enviarAAppSheet } from './services/appsheet.service.js';
import { descargarXml } from './services/clubfactura.download.js';

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

function loadSnapshot(path) {
  if (!fs.existsSync(path)) return {};
  try { return JSON.parse(fs.readFileSync(path, 'utf8')) || {}; } catch { return {}; }
}
function saveSnapshot(path, snapshot) { fs.writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf8'); }
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
function diffRows(rows, snapshot) {
  const toUpload = [];
  for (const r of rows) {
    const id = r.id != null ? String(r.id) : '';
    const pedido = r.PEDIDO ?? '';
    const uuid = r.UUID ?? '';
    const prev = snapshot[id];
    let uuidChanged = false;
    if (!prev) uuidChanged = true;
    else if (Object.prototype.hasOwnProperty.call(prev, 'UUID')) uuidChanged = prev.UUID !== uuid;
    else uuidChanged = uuid !== '';
    if (!prev || prev.PEDIDO !== pedido || uuidChanged) toUpload.push(r);
  }
  return toUpload;
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
    const acumuladas = [];
    const empresas = [
      { id: 15622, proveedor: 'xwDqa6Mt6a42iqKHzJG9L6' },
      { id: 15673, proveedor: 'EiHiUQ9YHf4mA-C7L_ziyc' }
    ];

    for (const empresa of empresas) {
      let page = 1;
      let total = 0;
      while (true) {
        const { items, totalCount } = await obtenerFacturasEmitidas({ empresa: empresa.id, pageNumber: page, pageSize: 100 });
        if (!items.length) break;
        const rows = [];
        for (const f of items) {
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
        }
        acumuladas.push(...rows);
        total += rows.length;
        page++;
        if (total >= totalCount) break;
      }
    }

    const snapshotPath = resolveDumpFile('cfdis_snapshot.json');
    const snapshot = loadSnapshot(snapshotPath);
    const toUpload = diffRows(acumuladas, snapshot);
    const missingUuid = acumuladas.filter(r => !r.UUID);

    writeCsv(resolveDumpFile('cfdis_all.csv'), acumuladas);
    writeCsv(resolveDumpFile('cfdis_to_upload.csv'), toUpload);
    writeUuidMissingCsv(resolveDumpFile('cfdis_uuid_missing.csv'), missingUuid);

    if (toUpload.length > 0) {
      await enviarAAppSheet(toUpload);
    }

    const nextSnapshot = {};
    for (const r of acumuladas) {
      if (r.id != null) nextSnapshot[String(r.id)] = { PEDIDO: r.PEDIDO ?? '', UUID: r.UUID ?? '' };
    }
    saveSnapshot(snapshotPath, nextSnapshot);

    return { ok: true, uploaded: toUpload.length, total: acumuladas.length, missingUuid: missingUuid.length };
  } finally {
    isRunning = false;
  }
}
