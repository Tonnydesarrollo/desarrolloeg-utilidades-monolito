import fs from "node:fs";
import path from "node:path";

const STOP_WORDS = new Set([
  "como", "cual", "cuales", "dame", "donde", "esta", "estan", "para", "sobre",
  "todas", "todos", "tiene", "tienen", "quiero", "necesito", "informacion",
]);

const DOMAIN_SYNONYMS = new Map([
  ["pipc", ["estatal", "proteccion", "programa", "interno"]],
  ["estatal", ["pipc", "proteccion", "civil"]],
  ["municipal", ["contingencia", "proteccion", "civil"]],
  ["tienda", ["sucursal", "centro", "trabajo"]],
  ["sucursal", ["tienda", "centro", "trabajo"]],
  ["capacitacion", ["curso", "constancia", "diploma"]],
  ["constancia", ["capacitacion", "diploma"]],
  ["cotizacion", ["presupuesto", "facturacion", "concepto"]],
  ["documento", ["archivo", "drive", "carpeta"]],
  ["permiso", ["rol", "alcance", "acceso"]],
]);

function words(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().match(/[a-z0-9]{4,}/g)?.filter((word) => !STOP_WORDS.has(word)) || [];
}

function expandedWords(value) {
  const base = words(value);
  return [...new Set(base.flatMap((word) => [word, ...(DOMAIN_SYNONYMS.get(word) || [])]))];
}

function listMarkdown(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return listMarkdown(file);
    return entry.isFile() && entry.name.endsWith(".md") ? [file] : [];
  });
}

function mayReadDocument(relativePath, identity) {
  const role = identity?.role;
  if (role === "admin" || role === "gerente") return true;
  const views = identity?.accessProfile?.views || {};
  if (relativePath === "docs/guia-operativa-portal.md") return true;
  if (relativePath === "docs/asistente-modelo-negocio.md") return true;
  if (relativePath === "docs/cotizaciones-appsheet.md") return views.facturacion?.actions?.includes("view");
  if (relativePath === "docs/solventaciones-arquitectura.md") return views.gestion?.actions?.includes("view");
  return false;
}

export function searchAuthorizedDocumentation(query, identity, root = process.cwd()) {
  if (!identity || identity.role === "sin-acceso") return [];
  const queryWords = expandedWords(query);
  if (!queryWords.length) return [];
  const files = [path.join(root, "README.md"), ...listMarkdown(path.join(root, "docs"))];
  const matches = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const relativePath = path.relative(root, file).replace(/\\/g, "/");
    if (!mayReadDocument(relativePath, identity)) continue;
    const title = path.basename(file, ".md").replace(/[-_]/g, " ");
    const titleWords = new Set(words(title));
    const chunks = fs.readFileSync(file, "utf8").split(/(?=^#{1,3} )/m);
    for (const chunk of chunks) {
      const chunkWords = new Set(expandedWords(chunk));
      const overlap = queryWords.filter((word) => chunkWords.has(word));
      if (!overlap.length) continue;
      const score = overlap.length + overlap.filter((word) => titleWords.has(word)).length * 2;
      matches.push({ fuente: relativePath, fragmento: chunk.trim().slice(0, 1200), score });
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, 4)
    .map(({ fuente, fragmento }) => ({ fuente, fragmento }));
}

export function searchAuthorizedOperationalData(query, identity, readTable) {
  const views = identity?.accessProfile?.views || {};
  const allowed = (view) => views[view]?.actions?.includes("view");
  const normalized = String(query || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const store = words(query).find((word) => /^\d{3,4}$/.test(word) && Number(word) < 2020);
  const companyName = /\b(casa ley|ley)\b/.test(normalized) ? "ley" : "";
  const results = [];
  const read = (table) => {
    try { return readTable(table); } catch { return []; }
  };
  const companies = read("EMPRESAS");
  const companyById = new Map(companies.map((row) => [String(row.ID), row["RAZON SOCIAL"] || row.LABEL || ""]));
  const branches = read("SUCURSALES");
  const branchById = new Map(branches.map((row) => [String(row.ID), row]));
  const companyMatches = (name) => !companyName || String(name || "").toLowerCase().includes(companyName);

  if (allowed("informacion-sucursales") && /\b(empresa|empresas)\b/.test(normalized)
    && !/\b(tienda|tiendas|sucursal|sucursales)\b/.test(normalized)) {
    return [{ modulo: "Empresas", total: companies.length, truncado: false,
      registros: companies.map((row) => ({
        nombre: row["NOMBRE COMERCIAL"] || row.LABEL || row["RAZON SOCIAL"],
        razonSocial: row["RAZON SOCIAL"] || "",
      })) }];
  }

  if (allowed("informacion-sucursales") && /\b(tienda|tiendas|sucursal|sucursales)\b/.test(normalized)) {
    const matches = branches.filter((row) => {
      if (store && String(row.TIENDA) !== store) return false;
      if (!companyMatches(row["RAZON SOCIAL"] || companyById.get(String(row["ID EMPRESA"] || row.EMPRESA || "")))) return false;
      return store || words(`${row.TIENDA} ${row.NOMBRE} ${row.MUNICIPIO_NOMBRE}`).some((word) => words(query).includes(word));
    });
    results.push({ modulo: "Sucursales", total: matches.length, truncado: matches.length > 12,
      registros: matches.slice(0, 12).map((row) => ({
        tienda: row.TIENDA, nombre: row.NOMBRE,
        empresa: row["RAZON SOCIAL"] || companyById.get(String(row["ID EMPRESA"] || row.EMPRESA || "")),
        municipio: row.MUNICIPIO_NOMBRE, estado: row.ESTADO_NOMBRE,
        direccion: row.DIRECCION, tipo: row.TIPO,
      })) });
  }

  for (const [word, table, view] of [
    ["estatal", "ESTATALES", "gestion"],
    ["municipal", "MUNICIPALES", "gestion"],
    ["cotizacion", "COTIZACIONES", "facturacion"],
  ]) {
    if (!allowed(view) || !normalized.includes(word)) continue;
    const matches = read(table).flatMap((row) => {
      const branch = branchById.get(String(row.SUCURSAL || row.CENTRO_DE_TRABAJO || ""));
      const company = branch?.["RAZON SOCIAL"] || companyById.get(String(row.EMPRESA || row["RAZON SOCIAL"] || "")) || "";
      const tienda = branch?.TIENDA || row.TIENDA || "";
      if (store && String(tienda) !== store) return [];
      if (!companyMatches(company)) return [];
      return [{ tienda, sucursal: branch?.NOMBRE || "", empresa: company,
        fecha: row.FECHA || "", estatus: row.PIPC || row.STATUS || row.ESTATUS || "",
        titulo: row.TITULO || "" }];
    });
    results.push({ modulo: table, total: matches.length, truncado: matches.length > 12,
      registros: matches.slice(0, 12) });
  }
  return results;
}
