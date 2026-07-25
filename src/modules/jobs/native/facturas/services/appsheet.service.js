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
const APPSHEET_REGION = process.env.FACTURAS_APPSHEET_REGION || 'www.appsheet.com';

function getUrl() {
  return `https://${APPSHEET_REGION}/api/v2/apps/${process.env.FACTURAS_APPSHEET_APP_ID}/tables/${process.env.FACTURAS_APPSHEET_TABLE}/Action`;
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

async function appsheetAction(action, rows) {
  return axios.post(getUrl(), {
    Action: action,
    Properties: { Locale: 'es-MX' },
    Rows: rows,
  }, {
    headers: {
      'Content-Type': 'application/json',
      ApplicationAccessKey: process.env.FACTURAS_APPSHEET_API_KEY,
      Accept: 'application/json',
    },
    validateStatus: () => true,
  });
}

async function fetchExistingRows() {
  const response = await appsheetAction('Find', []);
  if (response.status < 200 || response.status >= 300) {
    const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    throw new Error(`AppSheet Find fallo (${response.status}): ${errorText}`);
  }

  return Array.isArray(response.data) ? response.data : (response.data?.Rows || response.data?.rows || []);
}

function getRowKeyValue(row) {
  return row?.[KEY_COLUMN] ?? row?.id ?? row?.['Row ID'] ?? null;
}

async function writeRows(action, rows) {
  if (!rows.length) return;

  let attempt = 0;
  while (true) {
    try {
      const response = await appsheetAction(action, rows);
      if (response.status < 200 || response.status >= 300) {
        const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        throw new Error(`AppSheet ${action} fallo (${response.status}): ${errorText}`);
      }
      return;
    } catch (error) {
      attempt += 1;
      const status = error?.response?.status;
      if (attempt >= MAX_RETRIES || status !== 429) throw error;
      await sleep(getRetryDelayMs(error, attempt));
    }
  }
}

export async function enviarAAppSheet(rows) {
  const configuredAction = String(process.env.FACTURAS_APPSHEET_ACTION || 'AddOrUpdate').trim();

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

  // AppSheet REST API only documents Add/Edit/Delete/Find, so we emulate
  // AddOrUpdate by checking the current ids and dispatching the real verb.
  const existingRows = await fetchExistingRows();
  const existingIds = new Set(
    existingRows
      .map(getRowKeyValue)
      .filter(value => value !== null && value !== undefined && String(value).trim() !== '')
      .map(value => String(value))
  );

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const addRows = [];
    const editRows = [];

    if (configuredAction === 'Add') {
      addRows.push(...chunk);
    } else if (configuredAction === 'Edit') {
      editRows.push(...chunk);
    } else {
      for (const row of chunk) {
        const keyValue = row?.[KEY_COLUMN] ?? row?.id ?? null;
        if (keyValue !== null && existingIds.has(String(keyValue))) {
          editRows.push(row);
        } else {
          addRows.push(row);
        }
      }
    }

    if (editRows.length > 0) {
      await writeRows('Edit', editRows);
    }

    if (addRows.length > 0) {
      await writeRows('Add', addRows);
    }

    if (VERIFY_AFTER_WRITE && chunk.length > 0) {
      const first = chunk[0] || {};
      const keyValue = first[KEY_COLUMN] ?? first.id ?? null;
      if (keyValue !== null) {
        const verifyResponse = await appsheetAction('Find', [{ [KEY_COLUMN]: keyValue }]);
        if (verifyResponse.status < 200 || verifyResponse.status >= 300) {
          const errorText = typeof verifyResponse.data === 'string' ? verifyResponse.data : JSON.stringify(verifyResponse.data);
          throw new Error(`AppSheet Find fallo (${verifyResponse.status}): ${errorText}`);
        }
      }
    }
    await sleep(3000);
  }
}

export async function eliminarDeAppSheet(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { deleted: 0, skipped: 0 };
  }

  if (ID_AS_STRING) {
    rows = rows.map(r => ({ ...r, id: r.id != null ? String(r.id) : r.id }));
  }

  const existingRows = await fetchExistingRows();
  const existingIds = new Set(
    existingRows
      .map(getRowKeyValue)
      .filter(value => value !== null && value !== undefined && String(value).trim() !== '')
      .map(value => String(value))
  );

  const rowsToDelete = [];
  const skippedRows = [];
  for (const row of rows) {
    const keyValue = getRowKeyValue(row);
    if (keyValue === null || keyValue === undefined || String(keyValue).trim() === '') {
      skippedRows.push(row);
      continue;
    }
    if (!existingIds.has(String(keyValue))) {
      skippedRows.push(row);
      continue;
    }
    rowsToDelete.push({ [KEY_COLUMN]: keyValue });
  }

  for (let i = 0; i < rowsToDelete.length; i += CHUNK_SIZE) {
    const chunk = rowsToDelete.slice(i, i + CHUNK_SIZE);
    await writeRows('Delete', chunk);
    await sleep(3000);
  }

  return {
    deleted: rowsToDelete.length,
    skipped: skippedRows.length,
  };
}
