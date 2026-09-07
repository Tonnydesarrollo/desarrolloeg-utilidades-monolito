import { readLocalOperationalTable } from "../../services/localOperationalRepository.js";

const TABLES = { municipales: "MUNICIPALES", estatales: "ESTATALES" };

function text(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return text(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function extractUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return text(parsed?.Url || parsed?.url || parsed?.LinkText || parsed?.linkText);
  } catch {
    return /^https?:\/\//i.test(raw) ? raw : "";
  }
}

function recordYear(row) {
  for (const value of [row.FECHA, row.VENCIMIENTO, row.CAPACITACION]) {
    const match = text(value).match(/20\d{2}/);
    if (match) return Number(match[0]);
  }
  return null;
}

function buildCatalog(rows, keys) {
  const map = new Map();
  rows.forEach((row) => keys.forEach((key) => {
    const value = text(row[key]);
    if (value) map.set(value, row);
  }));
  return map;
}

export function getTrabajoTableName(tipo) {
  return TABLES[normalize(tipo)] || "";
}

export function obtenerTrabajosResumen(tipo, query = {}) {
  const table = getTrabajoTableName(tipo);
  if (!table) throw new Error("Tipo de trabajo no valido.");

  const rows = readLocalOperationalTable(table);
  const sucursales = readLocalOperationalTable("SUCURSALES");
  const empresas = readLocalOperationalTable("EMPRESAS");
  const municipios = readLocalOperationalTable("MUNICIPIOS");
  const estados = readLocalOperationalTable("ESTADOS");
  const sucursalMap = buildCatalog(sucursales, ["ID", "Row ID"]);
  const empresaMap = buildCatalog(empresas, ["ID", "Row ID"]);
  const municipioMap = buildCatalog(municipios, ["ID", "Row ID"]);
  const estadoMap = buildCatalog(estados, ["ID", "Row ID"]);

  const all = rows.map((row) => {
    const sucursal = sucursalMap.get(text(row.SUCURSAL)) || {};
    const empresaId = text(row["Razon Social"] || sucursal.EMPRESA || sucursal.empresa_id);
    const empresa = empresaMap.get(empresaId) || {};
    const municipio = municipioMap.get(text(row.MUNICIPIO || sucursal.MUNICIPIO)) || {};
    const estado = estadoMap.get(text(row.ESTADO || sucursal.ESTADO)) || {};
    const status = text(table === "ESTATALES" ? row.PIPC : row["PLAN DE CONTINGENCIA"]) || "SIN ESTATUS";
    return {
      id: text(row["Row ID"] || row.ID),
      year: recordYear(row),
      fecha: text(row.FECHA),
      sucursalId: text(row.SUCURSAL),
      sucursal: text(sucursal.LABEL2 || sucursal.LABEL || row.TIENDA || row.SUCURSAL) || "Sucursal sin nombre",
      tienda: text(row.TIENDA || sucursal.TIENDA),
      empresaId,
      empresa: text(empresa.NOMBRE_COMERCIAL || empresa.nombre_comercial || empresa.RAZON_SOCIAL || row["Razon Social"]) || "Empresa sin identificar",
      razonSocial: text(empresa.RAZON_SOCIAL || empresa.razon_social),
      municipio: text(municipio.NOMBRE || municipio.nombre || row.MUNICIPIO),
      estado: text(estado.NOMBRE || estado.nombre || row.ESTADO),
      status,
      drive: extractUrl(row.DRIVE),
      capacitacion: text(row.CAPACITACION),
      capacitadores: text(row.CAPACITADORES),
      statusCapacitacion: text(row["STATUS CAPACITACION"]),
      faltantes: text(row.FALTANTES_TEXTO || row["DUCOMENTACION FALTANTE"]),
      notas: text(row.NOTAS),
    };
  });

  const years = [...new Set(all.map((item) => item.year).filter(Number.isFinite))].sort((a, b) => b - a);
  const requestedYear = Number(query.year || 0);
  const selectedYear = requestedYear || years[0] || new Date().getFullYear();
  const company = normalize(query.empresa);
  const status = normalize(query.status);
  const search = normalize(query.q);
  const items = all.filter((item) => {
    if (item.year !== selectedYear) return false;
    if (company && normalize(`${item.empresaId} ${item.empresa} ${item.razonSocial}`) !== company && !normalize(`${item.empresaId} ${item.empresa} ${item.razonSocial}`).includes(company)) return false;
    if (status && normalize(item.status) !== status) return false;
    if (search && !normalize(Object.values(item).join(" ")).includes(search)) return false;
    return true;
  });

  const companies = [...new Map(all.map((item) => [item.empresaId || item.empresa, { id: item.empresaId || item.empresa, label: item.empresa }])).values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
  const statuses = [...new Set(all.filter((item) => item.year === selectedYear).map((item) => item.status))].sort((a, b) => a.localeCompare(b, "es"));
  return { tipo: normalize(tipo), table, selectedYear, years, companies, statuses, total: items.length, items };
}
