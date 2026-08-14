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
const EXISTING_LOOKUP_MODE = String(process.env.FACTURAS_APPSHEET_EXISTING_LOOKUP_MODE || 'edit-first').trim().toLowerCase();
const OPERATION_ONLY = String(process.env.FACTURAS_APPSHEET_OPERATION_ONLY ?? '1').trim() !== '0';
const POST_CHUNK_DELAY_MS = Math.max(0, Number(process.env.FACTURAS_APPSHEET_POST_CHUNK_DELAY_MS || '3000'));
const APPSHEET_TIMEOUT_MS = Math.max(20000, Number(process.env.FACTURAS_APPSHEET_TIMEOUT_MS || '120000'));
const LOCAL_SYNC_COLUMNS = new Set([
  'pdf_extraido',
  'pdf_extraido_fecha',
  'pdf_extraido_error',
  'sync_appsheet_estado',
  'sync_appsheet_fecha',
  'sync_appsheet_operacion',
  'sync_origen_ultimo',
]);

function getUrl() {
  return `https://${APPSHEET_REGION}/api/v2/apps/${process.env.FACTURAS_APPSHEET_APP_ID}/tables/${process.env.FACTURAS_APPSHEET_TABLE}/Action`;
}

function normalizeFacturasKeyValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function normalizeFacturasRow(row) {
  if (!row || typeof row !== 'object') return row;

  const normalized = { ...row };
  const keyValue = normalizeFacturasKeyValue(normalized?.[KEY_COLUMN] ?? normalized?.id ?? normalized?.['Row ID']);
  if (keyValue !== null) {
    normalized[KEY_COLUMN] = keyValue;
    if (KEY_COLUMN === 'id') {
      normalized.id = keyValue;
    }
  }

  const pickFirstValue = (...keys) => {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(normalized, key)) continue;
      const value = normalized[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return value;
      }
    }
    return undefined;
  };

  const fieldAliases = [
    ['serieFolio', ['serieFolio', 'serie_folio', 'SERIE_FOLIO']],
    ['RFC', ['RFC', 'rfc', 'rfc_emisor']],
    ['tipoDesc', ['tipoDesc', 'tipo_desc', 'TIPO_DESC']],
    ['estatusPagoDesc', ['estatusPagoDesc', 'estatus_pago_desc', 'ESTATUS_PAGO_DESC']],
    ['estatusCancelacion', ['estatusCancelacion', 'estatus_cancelacion', 'ESTATUS_CANCELACION']],
    ['fechaPagoCobro', ['fechaPagoCobro', 'fecha_pago_cobro', 'FECHA_PAGO_COBRO']],
    ['XML', ['XML', 'xml']],
    ['PDF', ['PDF', 'pdf']],
    ['PROVEEDOR', ['PROVEEDOR', 'proveedor']],
    ['PEDIDO', ['PEDIDO', 'pedido']],
    ['UUID', ['UUID', 'uuid']],
  ];

  for (const [targetKey, sourceKeys] of fieldAliases) {
    const value = pickFirstValue(...sourceKeys);
    if (value !== undefined) {
      normalized[targetKey] = value;
    }
  }

  return normalized;
}

function stripLocalSyncColumns(row) {
  const clean = { ...row };
  for (const column of LOCAL_SYNC_COLUMNS) {
    delete clean[column];
  }
  return clean;
}

function getLocalSyncOperation(row) {
  const operation = String(row?.sync_appsheet_operacion || row?.SYNC_APPSHEET_OPERACION || '').trim().toUpperCase();
  if (operation === 'ADD' || operation === 'EDIT') return operation;
  return null;
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

function normalizeStatusText(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeNumericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getFacturasTextCandidates(row = {}) {
  return Object.entries(row || {})
    .filter(([, value]) => value !== null && value !== undefined)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .map(([key, value]) => ({
      keyText: String(key).toUpperCase(),
      valueText: normalizeStatusText(value),
    }))
    .filter(({ valueText }) => Boolean(valueText));
}

function rowTextMatches(row, patterns) {
  const candidates = getFacturasTextCandidates(row);
  return candidates.some(({ keyText, valueText }) => {
    const keyMatches = (patterns.key || []).some((pattern) => pattern.test(keyText));
    if (!keyMatches) return false;
    return (patterns.value || []).some((pattern) => pattern.test(valueText));
  });
}

function isExcludedFacturasRow(row) {
  const tipoText = normalizeStatusText(row?.tipoDesc || row?.tipo_desc || row?.tipo || row?.tipoCFDI);
  if (/CFDI\s*DE\s*PAGOS|PAGOS/.test(tipoText)) {
    return true;
  }

  const estatusCancelacion = Number(row?.estatusCancelacion);
  if (Number.isFinite(estatusCancelacion) && (estatusCancelacion === 1 || estatusCancelacion === 2 || estatusCancelacion === 3)) {
    return true;
  }

  const estatus = normalizeNumericValue(row?.estatus);
  const esCancelable = normalizeNumericValue(row?.esCancelable);
  if (estatus === 2 && esCancelable === 3) {
    return true;
  }

  const statusText = normalizeStatusText(row?.estatusPagoDesc || row?.estatus_pago_desc || row?.estatusDesc || row?.status);
  if (/CANCEL|PROCES|PENDIENTE\s+DE\s+CANCEL|EN\s+TRAMITE\s+DE\s+CANCEL|SOLICITUD\s+DE\s+CANCEL/.test(statusText)) {
    return true;
  }

  return rowTextMatches(row, {
    key: [/CANCEL/, /ESTATUS/, /STATUS/, /PAGO/, /TIPO/],
    value: [
      /CANCEL/,
      /CANCELAD/,
      /ANULAD/,
      /REVOCAD/,
      /SUSPENDID/,
      /PROCES.*CANCEL|CANCEL.*PROCES/,
      /PENDIENTE.*CANCEL|CANCEL.*PENDIENTE/,
      /TRAMITE.*CANCEL|CANCEL.*TRAMITE/,
      /SOLICITUD.*CANCEL|CANCEL.*SOLICITUD/,
      /EN\s+CURSO.*CANCEL|CANCEL.*EN\s+CURSO/,
      /CFDI\s*DE\s*PAGOS/,
      /\bPAGOS?\b/,
    ],
  });
}

function prepareFacturasRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { rows: [], skippedExcluded: 0 };
  }

  let normalizedRows = rows.map(normalizeFacturasRow);
  const beforeFilterCount = normalizedRows.length;
  normalizedRows = normalizedRows.filter((row) => !isExcludedFacturasRow(row));
  const skippedExcluded = beforeFilterCount - normalizedRows.length;

  if (ID_AS_STRING) {
    normalizedRows = normalizedRows.map(r => ({ ...r, id: r.id != null ? String(r.id) : r.id }));
  }
  if (TEST_SINGLE) {
    normalizedRows = normalizedRows.slice(0, 1).map(r => {
      const base = { ...r, fecha: toIso(r.fecha), fechaPagoCobro: toIso(r.fechaPagoCobro) };
      if (TEST_MINIMAL) return { id: base.id, serieFolio: base.serieFolio };
      return base;
    });
  }
  if (ALLOWED_COLUMNS.length > 0) {
    normalizedRows = normalizedRows.map(r => {
      const out = {};
      for (const key of ALLOWED_COLUMNS) {
        if (Object.prototype.hasOwnProperty.call(r, key)) out[key] = r[key];
      }
      return out;
    });
  }

  return { rows: normalizedRows, skippedExcluded };
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
    timeout: APPSHEET_TIMEOUT_MS,
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
  return normalizeFacturasKeyValue(row?.[KEY_COLUMN] ?? row?.id ?? row?.['Row ID'] ?? null);
}

async function fetchExistingRowsByKey(rows) {
  const existingIds = new Set();
  for (const row of rows) {
    const keyValue = getRowKeyValue(row);
    if (keyValue === null) continue;
    const response = await appsheetAction('Find', [{ [KEY_COLUMN]: keyValue }]);
    if (response.status < 200 || response.status >= 300) {
      const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      throw new Error(`AppSheet Find por key fallo (${response.status}): ${errorText}`);
    }
    const found = Array.isArray(response.data) ? response.data : (response.data?.Rows || response.data?.rows || []);
    if (found.length > 0) existingIds.add(String(keyValue));
  }
  return existingIds;
}

export async function addMissingRowsToAppSheet(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { added: 0, existing: 0, missingRows: [] };
  }

  const prepared = prepareFacturasRows(rows);
  const normalizedRows = prepared.rows;

  const existingIds = await fetchExistingRowsByKey(normalizedRows);
  const missingRows = normalizedRows.filter((row) => {
    const keyValue = getRowKeyValue(row);
    return keyValue !== null && !existingIds.has(String(keyValue));
  });

  for (let i = 0; i < missingRows.length; i += CHUNK_SIZE) {
    const chunk = missingRows.slice(i, i + CHUNK_SIZE);
    await writeRows('Add', chunk);
    await sleep(POST_CHUNK_DELAY_MS);
  }

  return {
    added: missingRows.length,
    existing: existingIds.size,
    missingRows,
    skippedExcluded: prepared.skippedExcluded,
  };
}

export async function addRowsToAppSheet(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { added: 0, skippedExcluded: 0 };
  }

  const prepared = prepareFacturasRows(rows);
  const normalizedRows = prepared.rows;

  for (let i = 0; i < normalizedRows.length; i += CHUNK_SIZE) {
    const chunk = normalizedRows.slice(i, i + CHUNK_SIZE);
    await writeRows('Add', chunk);
    await sleep(POST_CHUNK_DELAY_MS);
  }

  return { added: normalizedRows.length, skippedExcluded: prepared.skippedExcluded };
}

async function writeRows(action, rows) {
  if (!rows.length) return;

  let attempt = 0;
  while (true) {
    try {
      const response = await appsheetAction(action, rows);
      if (response.status < 200 || response.status >= 300) {
        if (action === 'Delete' && response.status === 404) {
          return;
        }
        const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const error = new Error(`AppSheet ${action} fallo (${response.status}): ${errorText}`);
        error.response = response;
        throw error;
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

async function writeRowsBulk(action, rows) {
  if (!rows.length) return;

  let attempt = 0;
  while (true) {
    try {
      const response = await appsheetAction(action, rows);
      if (response.status < 200 || response.status >= 300) {
        if (action === 'Delete' && response.status === 404) {
          return;
        }
        const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const error = new Error(`AppSheet ${action} fallo (${response.status}): ${errorText}`);
        error.response = response;
        throw error;
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

async function writeRowsEditFirst(rows, options = {}) {
  if (!rows.length) return;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  try {
    onProgress?.({ etapa: 'appsheet-edit', filas: rows.length });
    await writeRows('Edit', rows);
    return;
  } catch (error) {
    const status = error?.response?.status;
    if (rows.length <= 1) {
      if (status === 404) {
        onProgress?.({ etapa: 'appsheet-add-missing', filas: rows.length, id: getRowKeyValue(rows[0]) });
        await writeRows('Add', rows);
        return;
      }
      throw error;
    }

    if (status !== 404) {
      throw error;
    }
  }

  const midpoint = Math.ceil(rows.length / 2);
  const left = rows.slice(0, midpoint);
  const right = rows.slice(midpoint);
  onProgress?.({ etapa: 'appsheet-edit-split', filas: rows.length, left: left.length, right: right.length });
  await writeRowsEditFirst(left, options);
  await writeRowsEditFirst(right, options);
}

export async function enviarAAppSheet(rows, options = {}) {
  const configuredAction = String(process.env.FACTURAS_APPSHEET_ACTION || 'AddOrUpdate').trim();
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  rows = rows.map(normalizeFacturasRow);
  const beforeFilterCount = rows.length;
  rows = rows.filter((row) => !isExcludedFacturasRow(row));
  const skippedExcluded = beforeFilterCount - rows.length;
  onProgress?.({
    etapa: 'appsheet-preparando',
    recibidas: beforeFilterCount,
    enviables: rows.length,
    omitidas: skippedExcluded,
    accion: configuredAction,
    modoBusqueda: EXISTING_LOOKUP_MODE,
    soloOperacionLocal: OPERATION_ONLY,
    chunkSize: CHUNK_SIZE,
    conOperacionLocal: rows.filter((row) => getLocalSyncOperation(row)).length,
  });

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
  const operationByKey = new Map();
  for (const row of rows) {
    const keyValue = getRowKeyValue(row);
    const operation = getLocalSyncOperation(row);
    if (keyValue !== null && operation) operationByKey.set(String(keyValue), operation);
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

  rows = rows.map(stripLocalSyncColumns);

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let skippedNoOperation = 0;

  // AppSheet REST API only documents Add/Edit/Delete/Find, so we emulate
  // AddOrUpdate by checking the current ids and dispatching the real verb.
  // When the caller already knows the table is empty and wants a full reload,
  // we can skip the expensive Find call by setting FACTURAS_APPSHEET_ACTION=Add.
  let existingIds = new Set();
  const allRowsHaveLocalOperation = rows.length > 0 && rows.every((row) => {
    const keyValue = getRowKeyValue(row);
    return keyValue !== null && operationByKey.has(String(keyValue));
  });

  if (!OPERATION_ONLY && configuredAction !== 'Add' && EXISTING_LOOKUP_MODE !== 'edit-first' && !allRowsHaveLocalOperation) {
    if (EXISTING_LOOKUP_MODE === 'key') {
      onProgress?.({ etapa: 'appsheet-find-por-key', filas: rows.length });
      existingIds = await fetchExistingRowsByKey(rows);
    } else {
      onProgress?.({ etapa: 'appsheet-find-global' });
      const existingRows = await fetchExistingRows();
      existingIds = new Set(
        existingRows
          .map(getRowKeyValue)
          .filter(value => value !== null && value !== undefined && String(value).trim() !== '')
          .map(value => String(value))
      );
    }
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
    onProgress?.({
      etapa: 'appsheet-chunk-inicia',
      chunk: chunkNumber,
      totalChunks,
      filas: chunk.length,
      procesadasAntes: i,
      total: rows.length,
    });
    const addRows = [];
    const editRows = [];

    if (configuredAction === 'Add') {
      addRows.push(...chunk);
    } else if (configuredAction === 'Edit') {
      editRows.push(...chunk);
    } else if (!OPERATION_ONLY && EXISTING_LOOKUP_MODE === 'edit-first') {
      await writeRowsEditFirst(chunk, options);
      updated += chunk.length;
      if (VERIFY_AFTER_WRITE && chunk.length > 0) {
        const first = chunk[0] || {};
        const keyValue = getRowKeyValue(first);
        if (keyValue !== null) {
          const verifyResponse = await appsheetAction('Find', [{ [KEY_COLUMN]: keyValue }]);
          if (verifyResponse.status < 200 || verifyResponse.status >= 300) {
            const errorText = typeof verifyResponse.data === 'string' ? verifyResponse.data : JSON.stringify(verifyResponse.data);
            throw new Error(`AppSheet Find fallo (${verifyResponse.status}): ${errorText}`);
          }
        }
      }
      await sleep(POST_CHUNK_DELAY_MS);
      onProgress?.({
        etapa: 'appsheet-chunk-termina',
        chunk: chunkNumber,
        totalChunks,
        filas: chunk.length,
        actualizadas: updated,
        agregadas: added,
      });
      continue;
    } else {
      for (const row of chunk) {
        const keyValue = getRowKeyValue(row);
        const localOperation = keyValue !== null ? operationByKey.get(String(keyValue)) : null;
        if (localOperation === 'ADD') {
          addRows.push(row);
        } else if (localOperation === 'EDIT') {
          editRows.push(row);
        } else if (OPERATION_ONLY) {
          skipped += 1;
          skippedNoOperation += 1;
        } else if (keyValue !== null && existingIds.has(String(keyValue))) {
          editRows.push(row);
        } else {
          addRows.push(row);
        }
      }
    }

    if (editRows.length > 0) {
      onProgress?.({ etapa: 'appsheet-edit', chunk: chunkNumber, filas: editRows.length });
      await writeRows('Edit', editRows);
      updated += editRows.length;
    }

    if (addRows.length > 0) {
      onProgress?.({ etapa: 'appsheet-add', chunk: chunkNumber, filas: addRows.length });
      await writeRows('Add', addRows);
      added += addRows.length;
    }

    if (VERIFY_AFTER_WRITE && chunk.length > 0) {
      const first = chunk[0] || {};
      const keyValue = getRowKeyValue(first);
      if (keyValue !== null) {
        const verifyResponse = await appsheetAction('Find', [{ [KEY_COLUMN]: keyValue }]);
        if (verifyResponse.status < 200 || verifyResponse.status >= 300) {
          const errorText = typeof verifyResponse.data === 'string' ? verifyResponse.data : JSON.stringify(verifyResponse.data);
          throw new Error(`AppSheet Find fallo (${verifyResponse.status}): ${errorText}`);
        }
      }
    }
    await sleep(POST_CHUNK_DELAY_MS);
    onProgress?.({
      etapa: 'appsheet-chunk-termina',
      chunk: chunkNumber,
      totalChunks,
      filas: chunk.length,
      actualizadas: updated,
      agregadas: added,
      omitidasSinOperacion: skippedNoOperation,
    });
  }

  return {
    added,
    updated,
    skipped,
    skippedNoOperation,
    total: rows.length,
    skippedExcluded,
  };
}

export async function eliminarDeAppSheet(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { deleted: 0, skipped: 0 };
  }

  rows = rows.map(normalizeFacturasRow);

  if (ID_AS_STRING) {
    rows = rows.map(r => ({ ...r, id: r.id != null ? String(r.id) : r.id }));
  }
  const rowsToDelete = [];
  const skippedRows = [];
  for (const row of rows) {
    const keyValue = getRowKeyValue(row);
    if (keyValue === null || keyValue === undefined || String(keyValue).trim() === '') {
      skippedRows.push(row);
      continue;
    }
    rowsToDelete.push({ [KEY_COLUMN]: normalizeFacturasKeyValue(keyValue) });
  }

  if (rowsToDelete.length > 0) {
    await writeRowsBulk('Delete', rowsToDelete);
  }

  return {
    deleted: rowsToDelete.length,
    skipped: skippedRows.length,
  };
}

export async function replaceAllRowsInAppSheet(rows) {
  const existingRows = await fetchExistingRows();
  const rowsToDelete = existingRows
    .map(normalizeFacturasRow)
    .map((row) => {
      const keyValue = getRowKeyValue(row);
      if (keyValue === null || keyValue === undefined || String(keyValue).trim() === '') {
        return null;
      }
      return { [KEY_COLUMN]: normalizeFacturasKeyValue(keyValue) };
    })
    .filter(Boolean);

  if (rowsToDelete.length > 0) {
    await writeRowsBulk('Delete', rowsToDelete);
  }
  const prepared = prepareFacturasRows(rows);
  const preparedRows = prepared.rows;
  if (preparedRows.length > 0) {
    await writeRowsBulk('Add', preparedRows);
  }

  return {
    deleted: rowsToDelete.length,
    skippedDeletes: Math.max(0, existingRows.length - rowsToDelete.length),
    added: preparedRows.length,
    total: preparedRows.length,
    skippedExcluded: prepared.skippedExcluded,
  };
}
