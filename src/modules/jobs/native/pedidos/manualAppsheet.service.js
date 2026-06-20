import axios from "axios";

const APPSHEET_REGION = process.env.PEDIDOS_APPSHEET_REGION || "www.appsheet.com";
const APPSHEET_APP_ID = process.env.PEDIDOS_APPSHEET_APP_ID || "";
const APPSHEET_API_KEY = process.env.PEDIDOS_APPSHEET_API_KEY || "";
const APPSHEET_TABLE = process.env.PEDIDOS_APPSHEET_TABLE_PEDIDOS || "PEDIDOS_LEY";
const APPSHEET_KEY_COLUMN = process.env.PEDIDOS_APPSHEET_KEY_PEDIDOS || "PEDIDO";
const APPSHEET_ACTION = String(process.env.PEDIDOS_MANUAL_APPSHEET_ACTION || "AddOrUpdate").trim();
const CHUNK_SIZE = Math.max(1, Number(process.env.PEDIDOS_MANUAL_CHUNK_SIZE || "10"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatLocalDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeImporte(value) {
  if (value === null || value === undefined) return "";
  let text = String(value).trim();
  if (!text) return "";

  text = text.replace(/[$\s]/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",") && !text.includes(".")) {
    text = text.replace(",", ".");
  }

  return text;
}

function toApiRow(row = {}) {
  const apiRow = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (!text) continue;
    apiRow[key] = text;
  }
  return apiRow;
}

function getUrl() {
  if (!APPSHEET_APP_ID || !APPSHEET_API_KEY) {
    throw new Error("Faltan variables PEDIDOS_APPSHEET_APP_ID o PEDIDOS_APPSHEET_API_KEY");
  }
  return `https://${APPSHEET_REGION}/api/v2/apps/${APPSHEET_APP_ID}/tables/${encodeURIComponent(APPSHEET_TABLE)}/Action`;
}

async function appsheetAction(action, rows) {
  return axios.post(
    getUrl(),
    {
      Action: action,
      Properties: { Locale: "es-MX", Timezone: "America/Mexico_City" },
      Rows: rows,
    },
    {
      headers: {
        ApplicationAccessKey: APPSHEET_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      validateStatus: () => true,
    }
  );
}

async function fetchExistingRows() {
  const response = await appsheetAction("Find", []);
  if (response.status < 200 || response.status >= 300) {
    const errorText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    throw new Error(`AppSheet Find fallo (${response.status}): ${errorText}`);
  }
  return Array.isArray(response.data) ? response.data : (response.data?.Rows || response.data?.rows || []);
}

async function writeRows(action, rows) {
  if (!rows.length) return;

  let attempt = 0;
  while (true) {
    try {
      const response = await appsheetAction(action, rows);
      if (response.status < 200 || response.status >= 300) {
        const errorText = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
        throw new Error(`AppSheet ${action} fallo (${response.status}): ${errorText}`);
      }
      return;
    } catch (error) {
      attempt += 1;
      const status = error?.response?.status;
      if (attempt >= 5 || status !== 429) throw error;
      await sleep(600 * Math.pow(2, attempt));
    }
  }
}

export function normalizePedidoRow(raw = {}) {
  const row = {};

  const establecimiento = raw.ESTABLECIMIENTO ?? raw["NO. TIENDA"] ?? raw["NO TIENDA"] ?? raw["TIENDA"] ?? raw["Tienda"] ?? raw["No. tienda"] ?? raw["No. Tienda"] ?? raw["No tienda"] ?? raw["ESTABLECIMIENTO"];
  const importe = raw.IMPORTE ?? raw["IMPORTE MXN"] ?? raw["MONTO"] ?? raw["TOTAL"] ?? raw["Importe"];
  const pedido = raw.PEDIDO ?? raw["NO. PEDIDO"] ?? raw["NO PEDIDO"] ?? raw["No. pedido"] ?? raw["Pedido"];
  const descripcion = raw.DESCRIPCION ?? raw["DESCRIPCIÓN"] ?? raw["CONCEPTO"] ?? raw["Concepto"] ?? raw["DESCRIPCION / CONCEPTO"];
  const proveedor = raw.PROVEEDOR ?? raw["Proveedor"] ?? raw["NOMBRE PROVEEDOR"];

  if (establecimiento !== undefined) row.ESTABLECIMIENTO = String(establecimiento).trim();
  if (importe !== undefined) row.IMPORTE = normalizeImporte(importe);
  if (pedido !== undefined) row.PEDIDO = String(pedido).trim();
  if (descripcion !== undefined) row.DESCRIPCION = String(descripcion).trim();
  if (proveedor !== undefined) row.PROVEEDOR = String(proveedor).trim();
  if (raw.FECHA !== undefined && String(raw.FECHA).trim() !== "") {
    row.FECHA = String(raw.FECHA).trim();
  }

  return row;
}

export function summarizeRows(rows = []) {
  const normalized = [];
  const errors = [];

  rows.forEach((rawRow, index) => {
    const row = normalizePedidoRow(rawRow);
    const missing = [];
    if (!row.ESTABLECIMIENTO) missing.push("ESTABLECIMIENTO");
    if (!row.IMPORTE) missing.push("IMPORTE");
    if (!row.PEDIDO) missing.push("PEDIDO");
    if (!row.DESCRIPCION) missing.push("DESCRIPCION");
    if (!row.PROVEEDOR) missing.push("PROVEEDOR");

    if (missing.length) {
      errors.push({ row: index + 1, missing, raw: rawRow });
      return;
    }

    normalized.push(row);
  });

  return { normalized, errors };
}

export async function enviarPedidosManual(rows = []) {
  const { normalized, errors } = summarizeRows(rows);
  if (!normalized.length) {
    return { ok: false, added: 0, edited: 0, total: 0, errors };
  }

  const existingRows = await fetchExistingRows();
  const existingIds = new Set(
    existingRows
      .map((row) => row?.[APPSHEET_KEY_COLUMN] ?? row?.PEDIDO ?? row?.id ?? null)
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
      .map((value) => String(value))
  );

  const addRows = [];
  const editRows = [];
  for (const row of normalized) {
    const keyValue = row?.[APPSHEET_KEY_COLUMN] ?? row?.PEDIDO ?? null;
    const apiRow = toApiRow({
      ESTABLECIMIENTO: row.ESTABLECIMIENTO,
      IMPORTE: row.IMPORTE,
      PEDIDO: row.PEDIDO,
      DESCRIPCION: row.DESCRIPCION,
      PROVEEDOR: row.PROVEEDOR,
      ...(row.FECHA ? { FECHA: row.FECHA } : {}),
    });

    if (APPSHEET_ACTION === "Add") {
      addRows.push(apiRow);
      continue;
    }
    if (APPSHEET_ACTION === "Edit") {
      editRows.push(apiRow);
      continue;
    }
    if (keyValue !== null && existingIds.has(String(keyValue))) {
      const existingRow = existingRows.find((candidate) => String(candidate?.[APPSHEET_KEY_COLUMN] ?? candidate?.PEDIDO ?? "") === String(keyValue));
      editRows.push(existingRow?.["Row ID"] ? { ...apiRow, "Row ID": String(existingRow["Row ID"]) } : apiRow);
    } else {
      addRows.push(apiRow);
    }
  }

  async function writeBatches(action, batchRows) {
    const failed = [];
    for (let i = 0; i < batchRows.length; i += CHUNK_SIZE) {
      const chunk = batchRows.slice(i, i + CHUNK_SIZE);
      try {
        await writeRows(action, chunk);
      } catch (error) {
        for (const row of chunk) {
          try {
            await writeRows(action, [row]);
          } catch (singleError) {
            failed.push({
              action,
              row,
              error: singleError?.response?.data || singleError?.message || "Error desconocido",
            });
          }
        }
      }
    }
    return failed;
  }

  const failedEdits = await writeBatches("Edit", editRows);
  const failedAdds = await writeBatches("Add", addRows);
  const failed = [...failedEdits, ...failedAdds];

  return {
    ok: failed.length === 0,
    total: normalized.length,
    added: addRows.length,
    edited: editRows.length,
    failed,
    errors,
    rows: normalized,
  };
}
