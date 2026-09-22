import { canReadSemanticEntity, projectSemanticRow, resolveSemanticEntity } from "./semanticEntities.js";

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function rowValue(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names) {
    const expected = normalized(name).replace(/[^a-z0-9]/g, "");
    const match = entries.find(([key]) => normalized(key).replace(/[^a-z0-9]/g, "") === expected);
    if (match && match[1] !== undefined && match[1] !== null && String(match[1]).trim()) return match[1];
  }
  return "";
}

function dateYear(value) {
  return Number(String(value || "").match(/\b(20\d{2})\b/)?.[1] || 0);
}

function dateOrder(value) {
  const raw = String(value || "");
  const iso = raw.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const local = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/);
  if (local) {
    const first = Number(local[1]);
    const second = Number(local[2]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return month >= 1 && month <= 12 && day >= 1 && day <= 31
      ? Date.UTC(Number(local[3]), month - 1, day) : 0;
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function companyLookup(readTable) {
  return new Map(readTable("EMPRESAS").map((row) => [String(row.ID), String(row["RAZON SOCIAL"] || row.NOMBRE || "")]));
}

export function executeAuthorizedDataQuery(args, identity, readTable) {
  if (!identity || identity.role === "sin-acceso") return { error: "Sin acceso autorizado" };
  const entity = normalized(args?.entidad);
  const definition = resolveSemanticEntity(entity);
  if (!definition || definition.name === "documentos") return { error: "Entidad no disponible" };
  if (!canReadSemanticEntity(identity, definition)) {
    return { error: "Sin permiso para consultar esta informacion" };
  }
  const companyFilter = normalized(String(args?.empresa || "").slice(0, 100));
  const year = args?.anio == null ? new Date().getFullYear() : Number(args.anio);
  if (!Number.isInteger(year) || year < 2020 || year > new Date().getFullYear() + 1) return { error: "Ano invalido" };
  const storeFilter = String(args?.tienda || "").trim().slice(0, 10);
  if (storeFilter && !/^\d{1,6}$/.test(storeFilter)) return { error: "Tienda invalida" };
  const includeRows = args?.detalle === true || Boolean(storeFilter);
  const fromDate = args?.fechaDesde ? dateOrder(args.fechaDesde) : 0;
  const toDate = args?.fechaHasta ? dateOrder(args.fechaHasta) : 0;
  if ((args?.fechaDesde && !fromDate) || (args?.fechaHasta && !toDate)) return { error: "Rango de fechas invalido" };
  const requestedLimit = Number(args?.limite);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, entity === "empresas" ? 100 : 30) : 8;
  const companies = companyLookup(readTable);
  const companyRows = readTable("EMPRESAS");
  if (entity === "empresas") {
    const matches = companyRows.filter((row) => !companyFilter
      || [row["RAZON SOCIAL"], row["NOMBRE COMERCIAL"], row.LABEL]
        .some((name) => normalized(name).includes(companyFilter)));
    return { entidad: "empresas", total: matches.length,
      registros: includeRows ? matches.slice(0, limit).map((row) => ({
        nombre: row["NOMBRE COMERCIAL"] || row.LABEL || row["RAZON SOCIAL"],
        razonSocial: row["RAZON SOCIAL"] || "",
      })) : [], detalleOmitido: !includeRows, truncado: includeRows && matches.length > limit };
  }
  if (!["sucursales", "pipc", "municipales"].includes(entity)) {
    const permission = identity.accessProfile?.views?.[definition.view];
    const employeeId = String(identity.id || "");
    const query = normalized(String(args?.texto || "").slice(0, 160));
    const statusFilter = normalized(String(args?.estatus || "").slice(0, 80)).replace(/s$/, "");
    const employees = new Map(readTable("EMPLEADOS").map((row) => [String(row.ID), row.NOMBRE || ""]));
    const branchRows = new Map(readTable("SUCURSALES").map((row) => [String(row.ID), row]));
    const branches = new Map([...branchRows].map(([id, row]) => [id, [row.TIENDA, row.NOMBRE].filter(Boolean).join(" ")]));
    const companiesById = new Map(companyRows.map((row) => [String(row.ID), row["NOMBRE COMERCIAL"] || row["RAZON SOCIAL"] || ""]));
    const providers = new Map(readTable("PROVEEDORES").map((row) => [String(row.ID), row.NOMBRE || ""]));
    const labels = (value, lookup) => String(value || "").split(/\s*,\s*/).filter(Boolean).map((id) => lookup.get(id) || id).join(", ");
    let matches = readTable(definition.table).filter((row) => {
      if (permission?.scope === "own" && definition.ownField) {
        const owners = String(row[definition.ownField] || "").split(/\s*,\s*/);
        if (!owners.includes(employeeId)) return false;
      }
      const date = String(rowValue(row, "FECHA CAPACITACION", "FECHA", "FECHA REGISTRO", "CREATED_AT") || "");
      if (args?.anio != null && dateYear(date) !== year) return false;
      const timestamp = dateOrder(date);
      if (fromDate && timestamp < fromDate) return false;
      if (toDate && timestamp > toDate) return false;
      if (statusFilter && !normalized(rowValue(row, "STATUS", "ESTATUS", "PIPC", "PLAN DE CONTINGENCIA", "RESULTADO")).includes(statusFilter)) return false;
      if (storeFilter) {
        const branchReference = String(rowValue(row, "SUCURSAL", "CENTRO DE TRABAJO", "CENTRO_DE_TRABAJO") || "");
        const branch = branches.get(branchReference) || "";
        if (!normalized(branch).split(/\s+/).includes(normalized(storeFilter))) return false;
      }
      if (companyFilter) {
        const companyReference = String(rowValue(row, "EMPRESA", "RAZON SOCIAL", "CLIENTE") || "");
        const branchReference = String(rowValue(row, "SUCURSAL", "CENTRO DE TRABAJO", "CENTRO_DE_TRABAJO") || "");
        const branch = branchRows.get(branchReference);
        const branchCompany = companiesById.get(String(branch?.["ID EMPRESA"] || branch?.EMPRESA || ""))
          || branch?.["RAZON SOCIAL"] || "";
        const company = companiesById.get(companyReference) || companyReference || branchCompany;
        if (!normalized(company).includes(companyFilter)) return false;
      }
      return true;
    }).map((row) => {
      const projected = projectSemanticRow(definition, row);
      if (projected.CEDE) projected.CEDE = branches.get(String(projected.CEDE)) || projected.CEDE;
      if (projected.SUCURSALES) projected.SUCURSALES = labels(projected.SUCURSALES, branches);
      if (projected.CAPACITADORES) projected.CAPACITADORES = labels(projected.CAPACITADORES, employees);
      if (projected.EMPLEADOS) projected.EMPLEADOS = labels(projected.EMPLEADOS, employees);
      if (projected.EMPRESA) projected.EMPRESA = companiesById.get(String(projected.EMPRESA)) || projected.EMPRESA;
      if (projected.SUCURSAL) projected.SUCURSAL = branches.get(String(projected.SUCURSAL)) || projected.SUCURSAL;
      if (projected.RESPONSABLE) projected.RESPONSABLE = employees.get(String(projected.RESPONSABLE)) || projected.RESPONSABLE;
      if (projected.INSPECTOR) projected.INSPECTOR = employees.get(String(projected.INSPECTOR)) || projected.INSPECTOR;
      if (projected.AUTOR) projected.AUTOR = employees.get(String(projected.AUTOR)) || projected.AUTOR;
      if (projected.PROVEEDOR) {
        projected.PROVEEDOR = providers.get(String(projected.PROVEEDOR)) || projected.PROVEEDOR;
      }
      return projected;
    }).filter((row) => !query || normalized(Object.values(row).join(" ")).includes(query));
    const order = normalized(args?.orden);
    if (order === "reciente" || order === "antiguo") {
      matches = matches.sort((left, right) => {
        const difference = dateOrder(right["FECHA CAPACITACION"] || right.FECHA)
          - dateOrder(left["FECHA CAPACITACION"] || left.FECHA);
        return order === "reciente" ? difference : -difference;
      });
    }
    return { entidad: definition.name, fuente: definition.table, total: matches.length, consultadoEn: new Date().toISOString(),
      filtroTexto: query || null, orden: order || null,
      registros: includeRows ? matches.slice(0, limit) : [], detalleOmitido: !includeRows,
      truncado: includeRows && matches.length > limit };
  }
  const matchingCompanyIds = new Set(companyRows.filter((row) =>
    [row["RAZON SOCIAL"], row["NOMBRE COMERCIAL"], row.LABEL].some((name) => normalized(name).includes(companyFilter))
  ).map((row) => String(row.ID)));
  const cityFilter = normalized(String(args?.municipio || "").slice(0, 100));
  const branches = readTable("SUCURSALES");
  const visibleBranches = branches.filter((branch) => {
    const company = String(branch["RAZON SOCIAL"] || companies.get(String(branch["ID EMPRESA"])) || "");
    return (!companyFilter || matchingCompanyIds.has(String(branch["ID EMPRESA"])) || normalized(company).includes(companyFilter))
      && (!storeFilter || String(branch.TIENDA) === storeFilter)
      && (!cityFilter || normalized(branch.MUNICIPIO_NOMBRE).includes(cityFilter));
  });
  if (entity === "sucursales") {
    return {
      entidad: "sucursales", empresa: companyFilter || "todas", total: visibleBranches.length,
      registros: (includeRows ? visibleBranches.slice(0, limit) : []).map((row) => ({
        tienda: row.TIENDA, nombre: row.NOMBRE, empresa: row["RAZON SOCIAL"] || companies.get(String(row["ID EMPRESA"])) || "",
        tipo: row.TIPO, municipio: row.MUNICIPIO_NOMBRE, estado: row.ESTADO_NOMBRE, direccion: row.DIRECCION,
      })),
      detalleOmitido: !includeRows, truncado: includeRows && visibleBranches.length > limit,
    };
  }

  if (entity === "municipales") {
    const branchById = new Map(visibleBranches.map((row) => [String(row.ID), row]));
    const matches = readTable("MUNICIPALES").filter((row) =>
      branchById.has(String(row.SUCURSAL || row.sucursal_id || ""))
      && Number(row.ANIO || row.anio || dateYear(row.FECHA || row.fecha)) === year
    ).map((row) => {
      const branch = branchById.get(String(row.SUCURSAL || row.sucursal_id));
      return { tienda: branch.TIENDA, sucursal: branch.NOMBRE, municipio: branch.MUNICIPIO_NOMBRE,
        fecha: row.FECHA || row.fecha || "", planDeContingencia: row["PLAN DE CONTINGENCIA"] || row.plan_de_contingencia || "" };
    });
    const unique = [...new Map(matches.map((row) => [String(row.tienda || row.sucursal), row])).values()];
    return { entidad: "municipales", empresa: companyFilter || "todas", anio: year, total: unique.length,
      registros: includeRows ? unique.slice(0, limit) : [], detalleOmitido: !includeRows,
      truncado: includeRows && unique.length > limit };
  }

  const branchById = new Map(visibleBranches.map((row) => [String(row.ID), row]));
  const latest = new Map();
  for (const row of readTable("ESTATALES")) {
    const branchId = String(row.SUCURSAL || "");
    if (!branchById.has(branchId) || dateYear(row.FECHA) !== year) continue;
    const order = dateOrder(row.FECHA);
    if (!latest.has(branchId) || order >= latest.get(branchId).order) latest.set(branchId, { row, order });
  }
  const pipcFilter = normalized(String(args?.estatusPipc || "").slice(0, 80));
  const matches = [...latest].flatMap(([branchId, { row }]) => {
    if (pipcFilter && normalized(row.PIPC) !== pipcFilter) return [];
    const branch = branchById.get(branchId);
    return [{
      tienda: branch.TIENDA, sucursal: branch.NOMBRE, empresa: branch["RAZON SOCIAL"] || companies.get(String(branch["ID EMPRESA"])) || "",
      fecha: row.FECHA, pipc: String(row.PIPC || "Sin estatus"), sistemaPc: String(row["SISTEMA PC"] || "Pendiente"),
    }];
  });
  const byPipc = new Map();
  let enSistemaPc = 0;
  for (const row of matches) {
    byPipc.set(row.pipc, (byPipc.get(row.pipc) || 0) + 1);
    if (normalized(row.sistemaPc) === "en sistema pc") enSistemaPc += 1;
  }
  return {
    entidad: "pipc", empresa: companyFilter || "todas", anio: year,
    filtroPipc: pipcFilter || null,
    total: matches.length,
    porEstatusPipc: [...byPipc].map(([estatus, total]) => ({ estatus, total })).sort((a, b) => b.total - a.total),
    sistemaPc: { enSistema: enSistemaPc, pendientes: matches.length - enSistemaPc },
    registros: includeRows ? matches.slice(0, limit) : [],
    detalleOmitido: !includeRows, truncado: includeRows && matches.length > limit,
    nota: "PIPC describe el avance del documento; Sistema PC es un estado independiente.",
  };
}
