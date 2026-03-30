import axios from 'axios';

const CHUNK_SIZE = Math.max(1, Number(process.env.FACTURAS_APPSHEET_CHUNK_SIZE || '5'));
const MAX_RETRIES = 10;
const RETRY_BASE_MS = 60000;
const VERIFY_AFTER_WRITE = process.env.FACTURAS_APPSHEET_VERIFY === 'true';
const KEY_COLUMN = process.env.FACTURAS_APPSHEET_KEY_COLUMN || 'id';
const ID_AS_STRING = process.env.FACTURAS_APPSHEET_ID_AS_STRING === 'true';
const TEST_MINIMAL = process.env.FACTURAS_APPSHEET_TEST_MINIMAL === 'true';
const TEST_SINGLE = process.env.FACTURAS_APPSHEET_TEST_SINGLE === 'true';
const ALLOWED_COLUMNS = (process.env.FACTURAS_APPSHEET_ALLOWED_COLUMNS || '').split(',').map(s => s.trim()).filter(Boolean);

function getUrl() {
  return `https://api.appsheet.com/api/v2/apps/${process.env.FACTURAS_APPSHEET_APP_ID}/tables/${process.env.FACTURAS_APPSHEET_TABLE}/Action`;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function getRetryDelayMs(error, attempt) {
  const retryAfterHeader = error?.response?.headers?.['retry-after'] ?? error?.response?.headers?.['Retry-After'];
  const retryAfterSeconds = Number(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  return RETRY_BASE_MS * attempt;
}
function toIso(value) {
  if (!value) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

export async function enviarAAppSheet(rows) {
  if (ID_AS_STRING) {
    rows = rows.map(r => ({ ...r, id: r.id != null ? String(r.id) : r.id }));
  }
  if (TEST_SINGLE) {
    rows = rows.slice(0, 1).map(r => {
      const base = { ...r, fecha: toIso(r.fecha), fechaPagoCobro: toIso(r.fechaPagoCobro) };
      if (TEST_MINIMAL) return { id: base.id, serieFolio: base.serieFolio };
      return base;
    });
  }
  if (ALLOWED_COLUMNS.length > 0) {
    rows = rows.map(r => {
      const out = {};
      for (const key of ALLOWED_COLUMNS) {
        if (Object.prototype.hasOwnProperty.call(r, key)) out[key] = r[key];
      }
      return out;
    });
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    let attempt = 0;
    while (true) {
      try {
        await axios.post(getUrl(), {
          Action: process.env.FACTURAS_APPSHEET_ACTION || 'AddOrUpdate',
          Properties: { Locale: 'es-MX' },
          Rows: chunk
        }, {
          headers: {
            'Content-Type': 'application/json',
            ApplicationAccessKey: process.env.FACTURAS_APPSHEET_API_KEY
          }
        });
        if (VERIFY_AFTER_WRITE) {
          const first = chunk[0] || {};
          const keyValue = first[KEY_COLUMN] ?? first.id ?? null;
          if (keyValue !== null) {
            await axios.post(getUrl(), {
              Action: 'Find',
              Properties: { Locale: 'es-MX', Selector: `${KEY_COLUMN} = ${keyValue}` },
              Rows: [{ [KEY_COLUMN]: keyValue }]
            }, {
              headers: {
                'Content-Type': 'application/json',
                ApplicationAccessKey: process.env.FACTURAS_APPSHEET_API_KEY
              }
            });
          }
        }
        break;
      } catch (error) {
        attempt += 1;
        const status = error?.response?.status;
        if (attempt >= MAX_RETRIES || status !== 429) throw error;
        await sleep(getRetryDelayMs(error, attempt));
      }
    }
    await sleep(3000);
  }
}
