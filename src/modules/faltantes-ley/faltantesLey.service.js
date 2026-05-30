import XLSX from "xlsx";

const cache = {
  ts: 0,
  rows: [],
  sucursalesById: new Map(),
  municipiosById: new Map(),
  documentacionIds: [],
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
    capacitadoresAppId: readEnv(
      [
        "FALTANTES_LEY_CAPACITADORES_APPSHEET_APP_ID",
        "WHATSAPP_CAP_APPSHEET_APP_ID",
        "CONSTANCIAS_APPSHEET_APP_ID",
        "PLANEACION_APPSHEET_APP_ID",
        "APPSHEET_APP_ID",
      ],
      ""
    ),
    capacitadoresAccessKey: readEnv(
      [
        "FALTANTES_LEY_CAPACITADORES_APPSHEET_API_KEY",
        "FALTANTES_LEY_CAPACITADORES_APPSHEET_ACCESS_KEY",
        "WHATSAPP_CAP_APPSHEET_ACCESS_KEY",
        "CONSTANCIAS_APPSHEET_API_KEY",
        "PLANEACION_APPSHEET_API_KEY",
        "APPSHEET_API_KEY",
      ],
      ""
    ),
    capacitadoresRegion: readEnv(
      ["FALTANTES_LEY_CAPACITADORES_APPSHEET_REGION", "WHATSAPP_CAP_APPSHEET_REGION", "APPSHEET_REGION"],
      "www.appsheet.com"
    ),
    capacitadoresLocale: readEnv(
      ["FALTANTES_LEY_CAPACITADORES_APPSHEET_LOCALE", "WHATSAPP_CAP_APPSHEET_LOCALE", "APPSHEET_LOCALE"],
      "es-MX"
    ),
    capacitadoresTimezone: readEnv(
      [
        "FALTANTES_LEY_CAPACITADORES_APPSHEET_TIMEZONE",
        "WHATSAPP_CAP_APPSHEET_TIMEZONE",
        "APPSHEET_TIMEZONE",
      ],
      "America/Mexico_City"
    ),
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

function getDocumentacionIdsFromRow(row) {
  const raw = getFirstFlexible(row, ["DOCUMENTACION", "Documentacion"]);
  return splitDocumentacionIds(raw);
}

function buildDocumentacionCatalogIds(rows) {
  const catalogSource = [...rows]
    .map((row) => getDocumentacionIdsFromRow(row))
    .filter((ids) => ids.length >= DOCUMENTO_CATALOGO.length)
    .sort((a, b) => b.length - a.length)[0];

  return Array.isArray(catalogSource) && catalogSource.length >= DOCUMENTO_CATALOGO.length
    ? catalogSource.slice(0, DOCUMENTO_CATALOGO.length)
    : [];
}

function derivePendientesFromDocumentacion(documentacionIds, catalogDocumentacionIds) {
  const present = new Set((documentacionIds || []).map((value) => String(value || "").trim()).filter(Boolean));
  if (!Array.isArray(catalogDocumentacionIds) || !catalogDocumentacionIds.length) return [];

  return catalogDocumentacionIds
    .map((documentoId, index) => ({ documentoId, nombre: DOCUMENTO_CATALOGO[index] }))
    .filter(({ documentoId }) => !present.has(documentoId))
    .map(({ nombre }) => nombre)
    .filter(Boolean);
}

function isBitacoraPendiente(value) {
  return normalizeText(value).startsWith("BITACORA");
}

function stripBitacoraPrefix(value) {
  return String(value || "")
    .replace(/^BITACORA\s+/i, "")
    .replace(/^BITACORA\s+/i, "")
    .trim();
}

function groupBitacorasForDisplay(pendientes = []) {
  const list = Array.isArray(pendientes) ? pendientes.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const bitacoras = list.filter(isBitacoraPendiente);
  const otherPendientes = list.filter((value) => !isBitacoraPendiente(value));

  if (!bitacoras.length) return list;

  const bitacorasLimpias = bitacoras.map(stripBitacoraPrefix).filter(Boolean);
  if (bitacorasLimpias.length === bitacoras.length && otherPendientes.length === 0) {
    return ["TODAS LAS BITACORAS"];
  }

  return [
    ...otherPendientes,
    `BITACORAS: ${bitacorasLimpias.join(", ")}`,
  ];
}

function splitEnumList(text) {
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
  const displayPendientesRows = rows.map((row) => ({
    ...row,
    pendientesDisplay: groupBitacorasForDisplay(row.pendientes || []),
  }));
  const headers = ["SUCURSAL", "MUNICIPIO", "ESTADO", "CAPACITADORES", "PENDIENTES"];
  const maxPendientes = displayPendientesRows.reduce((max, row) => Math.max(max, row.pendientesDisplay.length), 0);
  for (let i = 1; i <= maxPendientes; i += 1) {
    headers.push(`Pendiente ${i}`);
  }

  const exportRows = displayPendientesRows.map((row) => {
    const output = {
      SUCURSAL: row.sucursal,
      MUNICIPIO: row.municipio,
      ESTADO: row.estadoFaltantes,
      PENDIENTES: row.pendientesDisplay.join(", "),
      PENDIENTES_DETALLE: (row.pendientes || []).join(", "),
      CAPACITADORES: (row.capacitadores || []).join(", "),
    };

    for (let i = 1; i <= maxPendientes; i += 1) {
      output[`Pendiente ${i}`] = row.pendientesDisplay[i - 1] || "";
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

  let capacitadoresSucursales = [];
  if (config.capacitadoresAppId && config.capacitadoresAccessKey) {
    try {
      capacitadoresSucursales = await fetchTable(
        {
          ...config,
          appsheetAppId: config.capacitadoresAppId,
          appsheetAccessKey: config.capacitadoresAccessKey,
          appsheetRegion: config.capacitadoresRegion,
          appsheetLocale: config.capacitadoresLocale,
          appsheetTimezone: config.capacitadoresTimezone,
        },
        config.sucursalesTable
      );
    } catch (_error) {
      capacitadoresSucursales = [];
    }
  }

  const sucursalesById = makeMap(sucursales, ["Row ID", "ROW ID", "ID", "Id", "id"]);
  const municipiosById = makeMap(municipios, ["Row ID", "ROW ID", "ID", "Id", "id"]);
  const capacitadoresSucursalesById = makeMap(capacitadoresSucursales, ["Row ID", "ROW ID", "ID", "Id", "id"]);
  const documentacionIds = buildDocumentacionCatalogIds(estatales);

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
      const documentacionIdsRow = splitDocumentacionIds(documentacionRaw);
      const capacitadoresSucursalRow = resolveByCandidates(
        getFirstFlexible(row, ["sucursal", "SUCURSAL", "Sucursal"]),
        capacitadoresSucursalesById
      );
      const capacitadoresRaw = firstNonEmpty(
        getFirstFlexible(capacitadoresSucursalRow, ["CAPACITADORES", "Capacitadores", "CAPACITADOR", "Capacitador"]),
        getFirstFlexible(sucursalRow, ["CAPACITADORES", "Capacitadores", "CAPACITADOR", "Capacitador"]),
        getFirstFlexible(row, ["CAPACITADORES", "Capacitadores", "CAPACITADOR", "Capacitador"])
      );
      const capacitadores = splitEnumList(capacitadoresRaw);
      const pendientes = splitPendientes(faltantesTexto || "");
      const derivedPendientes = pendientes.length
        ? pendientes.filter((pendiente) => !isNoPendientesMarker(pendiente))
        : derivePendientesFromDocumentacion(documentacionIdsRow, documentacionIds);
      if (!sucursal) return null;
      const estadoFaltantes = inferEstadoFaltantes(derivedPendientes, faltantesTexto);

      return {
        id: asText(getFirstFlexible(row, ["Row ID", "ROW ID", "ID", "Id", "id"])),
        sucursal,
        municipio,
        pendientes: derivedPendientes,
        capacitadores,
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
  cache.documentacionIds = documentacionIds;

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

function normalizeSelectionList(value) {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeSelectionList);
  }

  return String(value || "")
    .split(",")
    .map(cleanPiece)
    .map(normalizeText)
    .filter(Boolean);
}

function rowMatchesAnySelections(rowValues, selectedValues) {
  if (!selectedValues.length) return true;
  const rowSet = new Set((rowValues || []).map((value) => normalizeText(value)));
  return selectedValues.some((selectedValue) => {
    for (const rowValue of rowSet) {
      if (rowValue === selectedValue || rowValue.includes(selectedValue) || selectedValue.includes(rowValue)) {
        return true;
      }
    }
    return false;
  });
}

function rowMatchesAllSelections(rowValues, selectedValues) {
  if (!selectedValues.length) return true;
  const rowSet = new Set((rowValues || []).map((value) => normalizeText(value)));
  return selectedValues.every((selectedValue) => {
    for (const rowValue of rowSet) {
      if (rowValue === selectedValue || rowValue.includes(selectedValue) || selectedValue.includes(rowValue)) {
        return true;
      }
    }
    return false;
  });
}

function getSortValue(row, key) {
  const column = String(key || "").trim();
  if (!column) return "";
  if (column === "SUCURSAL") return row.sucursal || "";
  if (column === "MUNICIPIO") return row.municipio || "";
  if (column === "ESTADO") return row.estadoFaltantes || "";
  if (column === "CAPACITADORES") return (row.capacitadores || []).join(", ");
  if (column.startsWith("Pendiente ")) {
    const index = Number(column.split(" ")[1] || 0) - 1;
    return row.pendientes[index] || "";
  }
  return row[column] || "";
}

function sortRows(rows, sortBy = "", sortDir = "asc") {
  const key = String(sortBy || "").trim();
  if (!key) return rows;
  const direction = String(sortDir || "asc").toLowerCase() === "desc" ? -1 : 1;

  return [...rows].sort((a, b) => {
    const aValue = String(getSortValue(a, key) || "");
    const bValue = String(getSortValue(b, key) || "");
    if (!aValue && !bValue) return 0;
    if (!aValue) return 1;
    if (!bValue) return -1;
    return aValue.localeCompare(bValue, "es-MX", { numeric: true, sensitivity: "base" }) * direction;
  });
}

function applyAdvancedFilters(rows, filters = {}) {
  const municipio = normalizeText(filters.municipio || "");
  const selectedCapacitadores = normalizeSelectionList(filters.capacitador || filters.capacitadores);
  const selectedPendientes = normalizeSelectionList(filters.pendiente || filters.pendientes);

  return rows.filter((row) => {
    if (municipio && normalizeText(row.municipio || "") !== municipio) {
      return false;
    }

    if (!rowMatchesAnySelections(row.capacitadores || [], selectedCapacitadores)) {
      return false;
    }

    if (!rowMatchesAllSelections(row.pendientes || [], selectedPendientes)) {
      return false;
    }

    return true;
  });
}

export async function getFaltantesLeyData(query = "", estado = "todas", filters = {}) {
  const { rows } = await loadFaltantesLeyData();
  const rowsByEstado = filterRowsByEstado(rows, estado);
  const normalizedQuery = normalizeText(query);
  let filtered = !normalizedQuery
    ? rowsByEstado
    : rowsByEstado.filter((row) => {
        const haystack = normalizeText([
          row.sucursal,
          row.municipio,
          row.estadoFaltantes,
          ...(row.capacitadores || []),
          ...(row.pendientes || []),
        ].join(" "));
        return haystack.includes(normalizedQuery);
      });

  filtered = applyAdvancedFilters(filtered, filters);
  filtered = sortRows(filtered, filters.sortBy, filters.sortDir);

  const { headers, exportRows } = buildExportRows(filtered);
  return {
    total: filtered.length,
    columns: headers,
    rows: exportRows,
  };
}

export async function getFaltantesLeyWorkbookBuffer(query = "", estado = "todas", filters = {}) {
  const { columns, rows } = await getFaltantesLeyData(query, estado, filters);
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  worksheet["!cols"] = columns.map((column, index) => ({
    wch: Math.max(column.length + 2, index < 2 ? 24 : 28),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Faltantes Ley");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}
