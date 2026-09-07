import { readLocalOperationalTable } from "../../services/localOperationalRepository.js";

const TABLES = { municipales: "MUNICIPALES", estatales: "ESTATALES" };
const STATUS_PENDING_CREATE = "PENDIENTE DE CREAR";

function text(value) { return String(value ?? "").trim(); }
function normalize(value) { return text(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function splitRefs(value) { return text(value).split(/\s*,\s*/).map(text).filter(Boolean); }

function extractUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return text(parsed?.Url || parsed?.url || parsed?.LinkText || parsed?.linkText);
  } catch { return /^https?:\/\//i.test(raw) ? raw : ""; }
}

function parseDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const parts = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    return new Date(Number(parts[3]), (first > 12 ? second : first) - 1, first > 12 ? first : second);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(value) {
  const date = value instanceof Date ? value : parseDate(value);
  return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
}

function formatDate(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date) : text(value);
}

function recordYear(row) {
  for (const value of [row.FECHA, row.VENCIMIENTO, row.CAPACITACION]) {
    const date = parseDate(value);
    if (date) return date.getFullYear();
    const match = text(value).match(/20\d{2}/);
    if (match) return Number(match[0]);
  }
  return null;
}

function buildCatalog(rows, keys) {
  const map = new Map();
  rows.forEach((row) => keys.forEach((key) => { const value = text(row[key]); if (value) map.set(value, row); }));
  return map;
}

function companyName(empresa = {}, fallback = "") {
  return text(empresa["NOMBRE COMERCIAL"] || empresa.NOMBRE_COMERCIAL || empresa.LABEL || empresa["RAZON SOCIAL"] || fallback) || "Empresa sin identificar";
}

function latestTrainingBySucursal(capacitaciones) {
  const bySucursal = new Map();
  const today = dateKey(new Date());
  capacitaciones.forEach((capacitacion) => {
    const date = parseDate(capacitacion["FECHA CAPACITACION"]);
    if (!date) return;
    const entry = { date, formatted: formatDate(capacitacion["FECHA CAPACITACION"]), status: today > dateKey(date) ? "CAPACITADA" : "PROGRAMADA", capacitadores: text(capacitacion.CAPACITADORES) };
    splitRefs(capacitacion.SUCURSALES).forEach((id) => { const current = bySucursal.get(id); if (!current || current.date < date) bySucursal.set(id, entry); });
  });
  return bySucursal;
}

export function getTrabajoTableName(tipo) { return TABLES[normalize(tipo)] || ""; }

export function obtenerTrabajosResumen(tipo, query = {}) {
  const normalizedType = normalize(tipo);
  const table = getTrabajoTableName(normalizedType);
  if (!table) throw new Error("Tipo de trabajo no valido.");

  const rows = readLocalOperationalTable(table);
  const sucursales = readLocalOperationalTable("SUCURSALES");
  const empresas = readLocalOperationalTable("EMPRESAS");
  const municipios = readLocalOperationalTable("MUNICIPIOS");
  const estados = readLocalOperationalTable("ESTADOS");
  const capacitaciones = readLocalOperationalTable("CAPACITACIONES");
  const documentos = readLocalOperationalTable("DOCUMENTACION");
  const sucursalMap = buildCatalog(sucursales, ["ID", "Row ID"]);
  const empresaMap = buildCatalog(empresas, ["ID", "Row ID"]);
  const municipioMap = buildCatalog(municipios, ["ID", "Row ID"]);
  const estadoMap = buildCatalog(estados, ["ID", "Row ID"]);
  const trainingMap = latestTrainingBySucursal(capacitaciones);
  const documentOptions = documentos
    .filter((row) => normalize(row.PROGRAMA).includes(normalizedType === "estatales" ? "estatal" : "municipal"))
    .map((row) => ({ id: text(row["Row ID"] || row.ID), label: text(row.DOCUMENTO || row.NOMBRE) }))
    .filter((row) => row.id && row.label);

  const all = rows.map((row) => {
    const sucursal = sucursalMap.get(text(row.SUCURSAL)) || {};
    const empresaId = text(row["Razon Social"] || sucursal.EMPRESA || sucursal["ID EMPRESA"]);
    const empresa = empresaMap.get(empresaId) || {};
    const municipio = municipioMap.get(text(row.MUNICIPIO || sucursal.MUNICIPIO)) || {};
    const estado = estadoMap.get(text(row.ESTADO || sucursal.ESTADO)) || {};
    const selectedDocuments = splitRefs(row.DOCUMENTACION);
    const training = trainingMap.get(text(row.SUCURSAL));
    return {
      id: text(row["Row ID"] || row.ID), virtual: false, year: recordYear(row), fecha: formatDate(row.FECHA), fechaRaw: text(row.FECHA),
      sucursalId: text(row.SUCURSAL), sucursal: text(sucursal.LABEL2 || sucursal.LABEL || row.TIENDA) || "Sucursal sin nombre", tienda: text(row.TIENDA || sucursal.TIENDA),
      empresaId, empresa: companyName(empresa, row["Razon Social"]), razonSocial: text(empresa["RAZON SOCIAL"]), logo: text(empresa.LOGOCALCULADO || empresa.LOGOURL || empresa.LOGO),
      municipio: text(municipio.NOMBRE || row.MUNICIPIO), estado: text(estado.NOMBRE || row.ESTADO),
      status: text(table === "ESTATALES" ? row.PIPC : row["PLAN DE CONTINGENCIA"]) || "SIN ESTATUS", drive: extractUrl(row.DRIVE),
      capacitacionFecha: training?.formatted || formatDate(row.CAPACITACION),
      capacitacionStatus: training?.status || (text(row["STATUS CAPACITACION"]) ? normalize(row["STATUS CAPACITACION"]).includes("final") ? "CAPACITADA" : "PROGRAMADA" : "SIN CAPACITACION"),
      capacitadores: text(row.CAPACITADORES || training?.capacitadores), selectedDocuments,
      missingDocuments: documentOptions.filter((document) => !selectedDocuments.includes(document.id)), faltantes: text(row.FALTANTES_TEXTO || row["DUCOMENTACION FALTANTE"]), notas: text(row.NOTAS),
    };
  });

  const years = [...new Set([...all.map((item) => item.year).filter(Number.isFinite), new Date().getFullYear()])].sort((a, b) => b - a);
  const selectedYear = Number(query.year || 0) || years[0] || new Date().getFullYear();
  const existingSucursalIds = new Set(all.filter((item) => item.year === selectedYear).map((item) => item.sucursalId));
  const workToken = normalizedType === "estatales" ? "estatal" : "municipal";
  if (selectedYear === new Date().getFullYear()) sucursales.forEach((sucursal) => {
    const sucursalId = text(sucursal.ID || sucursal["Row ID"]);
    const workTypes = normalize(sucursal.TRABAJOS).split(/\s*,\s*/);
    if (!sucursalId || existingSucursalIds.has(sucursalId) || !workTypes.includes(workToken)) return;
    const empresaId = text(sucursal.EMPRESA || sucursal["ID EMPRESA"]);
    const empresa = empresaMap.get(empresaId) || {};
    const training = trainingMap.get(sucursalId);
    all.push({
      id: "", virtual: true, year: selectedYear, fecha: "", fechaRaw: "", sucursalId,
      sucursal: text(sucursal.LABEL2 || sucursal.LABEL) || "Sucursal sin nombre", tienda: text(sucursal.TIENDA), empresaId,
      empresa: companyName(empresa, sucursal["RAZON SOCIAL"]), razonSocial: text(empresa["RAZON SOCIAL"] || sucursal["RAZON SOCIAL"]), logo: text(empresa.LOGOCALCULADO || empresa.LOGOURL || empresa.LOGO),
      municipio: text(sucursal.MUNICIPIO_NOMBRE), estado: text(sucursal.ESTADO_NOMBRE), status: STATUS_PENDING_CREATE, drive: "",
      capacitacionFecha: training?.formatted || "", capacitacionStatus: training?.status || "SIN CAPACITACION", capacitadores: training?.capacitadores || "",
      selectedDocuments: [], missingDocuments: documentOptions, faltantes: "", notas: "",
    });
  });

  const company = text(query.empresa);
  const status = normalize(query.status);
  const trainingStatus = normalize(query.capacitacion);
  const search = normalize(query.q);
  const items = all.filter((item) => item.year === selectedYear
    && (!company || item.empresaId === company)
    && (!status || normalize(item.status) === status)
    && (!trainingStatus || normalize(item.capacitacionStatus) === trainingStatus)
    && (!search || normalize([item.sucursal, item.tienda, item.empresa, item.razonSocial, item.municipio, item.estado].join(" ")).includes(search)));

  const groupedMap = new Map();
  items.forEach((item) => { const key = item.empresaId || item.empresa; if (!groupedMap.has(key)) groupedMap.set(key, []); groupedMap.get(key).push(item); });
  const groups = [...groupedMap].map(([key, companyItems]) => ({
    id: key, name: companyItems[0]?.empresa || "Empresa sin identificar", businessName: companyItems[0]?.razonSocial || "", logo: key && companyItems[0]?.logo ? `/dashboard/empresas/${encodeURIComponent(key)}/logo` : "", total: companyItems.length,
    items: companyItems.sort((a, b) => a.sucursal.localeCompare(b.sucursal, "es")),
  })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const companies = empresas.map((empresa) => ({ id: text(empresa.ID || empresa["Row ID"]), label: companyName(empresa) })).filter((item) => item.id).sort((a, b) => a.label.localeCompare(b.label, "es"));
  const statuses = [...new Set(all.filter((item) => item.year === selectedYear).map((item) => item.status))].sort((a, b) => a.localeCompare(b, "es"));
  return { tipo: normalizedType, table, selectedYear, years, companies, statuses, trainingStatuses: ["CAPACITADA", "PROGRAMADA", "SIN CAPACITACION"], documentOptions, total: items.length, groups, items };
}
