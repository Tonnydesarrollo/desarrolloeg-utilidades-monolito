import XLSX from "xlsx";

const cache = {
  ts: 0,
  rows: [],
  sucursalesById: new Map(),
  municipiosById: new Map(),
};

const DOCUMENTO_CATALOGO = [
  "Acta constitutiva",
  "Lista de asistencia de capacitación",
  "DC3",
  "BITACORA de bombas contra incendio",
  "BITACORA de detectores de incendio",
  "BITACORA de alarmas de jalón",
  "BITACORA de extintores",
  "BITACORA de hidrantes",
  "BITACORA luces de emergencia",
  "BITACORA de planta de emergencia",
  "BITACORA de salidas de emergencia",
  "Inventario de bomberos",
  "Cedula para la evaluación de simulacros",
  "Fotografías (evidencia) de simulacro realizado.",
  "Reporte de servicio de FUMIGACION",
];

function readEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function getConfig() {
  return {
    appsheetAppId: readEnv(
      [
        "FALTANTES_LEY_APPSHEET_APP_ID",
        "DOCS_APPSHEET_APP_ID",
        "APPSHEET_APP_ID",
      ],
      ""
    ),
    appsheetAccessKey: readEnv(
      [
        "FALTANTES_LEY_APPSHEET_API_KEY",
        "DOCS_APPSHEET_ACCESS_KEY",
        "DOCS_APPSHEET_API_KEY",
        "APPSHEET_API_KEY",
      ],
      ""
    ),
    appsheetRegion: readEnv(["FALTANTES_LEY_APPSHEET_REGION", "APPSHEET_REGION"], "api.appsheet.com"),
    appsheetLocale: readEnv(["FALTANTES_LEY_APPSHEET_LOCALE", "APPSHEET_LOCALE"], "es-MX"),
    appsheetTimezone: readEnv(["FALTANTES_LEY_APPSHEET_TIMEZONE", "APPSHEET_TIMEZONE"], "America/Mexico_City"),
    estatalesTable: readEnv(["FALTANTES_LEY_TABLE_ESTATALES", "APPSHEET_TABLE_ESTATALES"], "ESTATALES"),
    sucursalesTable: readEnv(["FALTANTES_LEY_TABLE_SUCURSALES", "APPSHEET_TABLE_SUCURSALES"], "SUCURSALES"),
    municipiosTable: readEnv(["FALTANTES_LEY_TABLE_MUNICIPIOS", "APPSHEET_TABLE_MUNICIPIOS"], "MUNICIPIOS"),
  };
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeLooseKey(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFirst(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function getFirstFlexible(row, keys) {
  const direct = getFirst(row, keys);
  if (direct !== undefined) return direct;

  const wanted = new Set(keys.map((key) => normalizeLooseKey(key)));
  for (const [key, value] of Object.entries(row || {})) {
    if (!wanted.has(normalizeLooseKey(key))) continue;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function asText(value = "") {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  return String(value).trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function buildLookupCandidates(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value).trim()];
  if (Array.isArray(value)) return value.flatMap(buildLookupCandidates);

  if (typeof value === "object") {
    return [
      value["Row ID"],
      value["ROW ID"],
      value.ID,
      value.Id,
      value.id,
      value.label,
      value.LABEL,
      value.Label,
      value.NOMBRE,
      value.Nombre,
      value._ComputedKey,
    ]
      .flatMap(buildLookupCandidates)
      .filter(Boolean);
  }

  return [];
}

function resolveByCandidates(value, map) {
  for (const candidate of buildLookupCandidates(value)) {
    const row = map.get(candidate);
    if (row) return row;
  }
  return null;
}

function makeMap(rows, keys) {
  const map = new Map();
  for (const row of rows) {
    for (const key of keys) {
      const value = getFirstFlexible(row, [key]);
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        map.set(String(value).trim(), row);
      }
    }
  }
  return map;
}

async function fetchTable(config, tableName) {
  if (!config.appsheetAppId) {
    throw new Error("No hay APPSHEET_APP_ID configurado.");
  }
  if (!config.appsheetAccessKey) {
    throw new Error("No hay APPSHEET_API_KEY configurado.");
  }

  const url = `https://${config.appsheetRegion}/api/v2/apps/${config.appsheetAppId}/tables/${encodeURIComponent(tableName)}/Action`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ApplicationAccessKey: config.appsheetAccessKey,
    },
    body: JSON.stringify({
      Action: "Find",
      Properties: {
        Locale: config.appsheetLocale,
        Timezone: config.appsheetTimezone,
      },
      Rows: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`AppSheet devolvio ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : Array.isArray(data?.Rows) ? data.Rows : [];
}

function cleanPiece(value) {
  return String(value || "")
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPendientes(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const normalized = raw.includes(":") ? raw.split(":").slice(1).join(":") : raw;
  return normalized
    .split(",")
    .map(cleanPiece)
    .filter(Boolean)
    .map((piece, index) => (index === 0 ? piece.replace(/^[^:]+:\s*/u, "") : piece))
    .map((piece) => piece.replace(/^\-\s*/, "").trim())
    .filter(Boolean);
}

function isNoPendientesMarker(value) {
  return normalizeText(value) === "SIN FALTANTES";
}

function inferEstadoFaltantes(pendientes, faltantesTexto) {
  if (pendientes.length) return "FALTANTES";
  if (isNoPendientesMarker(faltantesTexto)) return "SIN FALTANTES";
  return "SIN FALTANTES";
}

function splitDocumentacionIds(text) {
  return String(text || "")
    .split(",")
    .map(cleanPiece)
    .filter(Boolean);
}

function pickSucursalLabel(row) {
  const tienda = firstNonEmpty(
    getFirstFlexible(row, ["TIENDA", "Tienda"]),
    getFirstFlexible(row, ["NUMERO", "Número"])
  );
  const tipo = firstNonEmpty(getFirstFlexible(row, ["TIPO", "Tipo", "TIPO SUCURSAL", "Tipo Sucursal"]));
  const nombre = firstNonEmpty(
    getFirstFlexible(row, ["NOMBRE", "Nombre", "LABEL", "Label", "LABEL2", "Label2"]),
    getFirstFlexible(row, ["SUCURSAL", "Sucursal"])
  );

  const composed = [tienda, tipo, nombre].filter(Boolean).join(" ").trim();
  if (composed) return composed;

  const label = firstNonEmpty(
    getFirstFlexible(row, ["LABEL", "Label", "LABEL2", "Label2", "NOMBRE", "Nombre"]),
    getFirstFlexible(row, ["SUCURSAL", "Sucursal"])
  );

  if (label) {
    if (tienda && !normalizeText(label).startsWith(normalizeText(tienda))) {
      return `${tienda} ${label}`.trim();
    }
    return label;
  }

  return tienda;
}

function pickMunicipioLabel(row, fallbackRows = []) {
  const rows = Array.isArray(fallbackRows) ? fallbackRows : [fallbackRows];
  const fallbackValues = rows.flatMap((fallbackRow) => [
    getFirstFlexible(fallbackRow, ["municipio_label", "MUNICIPIO_LABEL", "municipioNombre", "municipio_nombre"]),
    getFirstFlexible(fallbackRow, ["label", "LABEL", "Label", "NOMBRE", "Nombre"]),
  ]);

  return firstNonEmpty(getFirstFlexible(row, ["label", "LABEL", "Label", "NOMBRE", "Nombre"]), ...fallbackValues);
}

function buildExportRows(rows) {
  const maxPendientes = rows.reduce((max, row) => Math.max(max, row.pendientes.length), 0);
  const headers = ["SUCURSAL", "MUNICIPIO"];
  for (let i = 1; i <= maxPendientes; i += 1) {
    headers.push(`Pendiente ${i}`);
  }

  const exportRows = rows.map((row) => {
    const output = {
      SUCURSAL: row.sucursal,
      MUNICIPIO: row.municipio,
    };

    for (let i = 1; i <= maxPendientes; i += 1) {
      output[`Pendiente ${i}`] = row.pendientes[i - 1] || "";
    }

    return output;
  });

  return { headers, exportRows };
}

async function loadFaltantesLeyData() {
  const config = getConfig();
  const ttlMs = 5 * 60 * 1000;

  if (Date.now() - cache.ts < ttlMs && cache.rows.length) {
    return {
      config,
      rows: cache.rows,
      sucursalesById: cache.sucursalesById,
      municipiosById: cache.municipiosById,
    };
  }

  const [estatales, sucursales, municipios] = await Promise.all([
    fetchTable(config, config.estatalesTable),
    fetchTable(config, config.sucursalesTable),
    fetchTable(config, config.municipiosTable),
  ]);

  const sucursalesById = makeMap(sucursales, ["Row ID", "ROW ID", "ID", "Id", "id"]);
  const municipiosById = makeMap(municipios, ["Row ID", "ROW ID", "ID", "Id", "id"]);

  const rows = estatales
    .map((row) => {
      const pipc = normalizeText(getFirstFlexible(row, ["PIPC", "Pipc"]) || "");
      if (pipc !== "PENDIENTE") return null;

      const sucursalRow = resolveByCandidates(
        getFirstFlexible(row, ["sucursal", "SUCURSAL", "Sucursal"]),
        sucursalesById
      );
      if (!sucursalRow) return null;

      const empresa = normalizeText(
        getFirstFlexible(sucursalRow, ["empresa", "EMPRESA", "ID EMPRESA", "Id Empresa"]) || ""
      );
      if (empresa !== "1") return null;

      const municipioRef = firstNonEmpty(
        getFirstFlexible(row, ["MUNICIPIO", "Municipio"]),
        getFirstFlexible(sucursalRow, ["MUNICIPIO", "Municipio"])
      );
      const municipioRow = resolveByCandidates(municipioRef, municipiosById);

      const sucursal = pickSucursalLabel(sucursalRow);
      const municipio = pickMunicipioLabel(municipioRow, [sucursalRow, row]);
      const faltantesTexto = getFirstFlexible(row, ["FALTANTES_TEXTO", "FALTANTES TEXTO"]);
      const documentacionRaw = getFirstFlexible(row, ["DOCUMENTACION", "Documentacion"]);
      const documentacionIds = splitDocumentacionIds(documentacionRaw);
      const pendientes = splitPendientes(faltantesTexto || "");
      const derivedPendientes = pendientes.length
        ? pendientes.filter((pendiente) => !isNoPendientesMarker(pendiente))
        : DOCUMENTO_CATALOGO.slice(Math.min(documentacionIds.length, DOCUMENTO_CATALOGO.length));
      if (!sucursal) return null;
      const estadoFaltantes = inferEstadoFaltantes(derivedPendientes, faltantesTexto);

      return {
        id: asText(getFirstFlexible(row, ["Row ID", "ROW ID", "ID", "Id", "id"])),
        sucursal,
        municipio,
        pendientes: derivedPendientes,
        estadoFaltantes,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aKey = `${a.sucursal} ${a.municipio}`.toLowerCase();
      const bKey = `${b.sucursal} ${b.municipio}`.toLowerCase();
      return aKey.localeCompare(bKey, "es-MX", { numeric: true, sensitivity: "base" });
    });

  cache.ts = Date.now();
  cache.rows = rows;
  cache.sucursalesById = sucursalesById;
  cache.municipiosById = municipiosById;

  return { config, rows, sucursalesById, municipiosById };
}

function normalizeEstadoFilter(estado = "") {
  const value = normalizeText(estado);
  if (value === "FALTANTES") return "FALTANTES";
  if (value === "SIN FALTANTES" || value === "SINFALTANTES") return "SIN FALTANTES";
  return "TODAS";
}

function filterRowsByEstado(rows, estado) {
  const normalizedEstado = normalizeEstadoFilter(estado);
  if (normalizedEstado === "TODAS") return rows;
  if (normalizedEstado === "FALTANTES") {
    return rows.filter((row) => row.estadoFaltantes === "FALTANTES");
  }
  return rows.filter((row) => row.estadoFaltantes === "SIN FALTANTES");
}

export async function getFaltantesLeyData(query = "", estado = "todas") {
  const { rows } = await loadFaltantesLeyData();
  const rowsByEstado = filterRowsByEstado(rows, estado);
  const normalizedQuery = normalizeText(query);
  const filtered = !normalizedQuery
    ? rowsByEstado
    : rowsByEstado.filter((row) => {
        const haystack = normalizeText([row.sucursal, row.municipio, ...row.pendientes].join(" "));
        return haystack.includes(normalizedQuery);
      });

  const { headers, exportRows } = buildExportRows(filtered);
  return {
    total: filtered.length,
    columns: headers,
    rows: exportRows,
  };
}

export async function getFaltantesLeyWorkbookBuffer(query = "", estado = "todas") {
  const { columns, rows } = await getFaltantesLeyData(query, estado);
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  worksheet["!cols"] = columns.map((column, index) => ({
    wch: Math.max(column.length + 2, index < 2 ? 24 : 28),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Faltantes Ley");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}
