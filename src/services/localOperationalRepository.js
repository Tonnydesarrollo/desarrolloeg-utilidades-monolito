import { readLocalRows } from "./desarrolloegLocalDb.js";

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function joinLabel(...parts) {
  const seen = new Set();
  return parts
    .map(text)
    .filter((part) => {
      const key = part.toLocaleUpperCase("es-MX");
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

function parseLocalDateKey(value) {
  const textValue = text(value);
  if (!textValue) return "";
  const isoLike = textValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) return `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`;
  const slashMatch = textValue.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) year += 2000;
    const day = first > 12 && second <= 12 ? first : second;
    const month = first > 12 && second <= 12 ? second : first;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(textValue);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function deriveCapacitacionStatus(value) {
  const fechaKey = parseLocalDateKey(value);
  if (!fechaKey) return "";
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return todayKey > fechaKey ? "FINALIZADA" : "PROGRAMADA";
}

function mapEmpresa(row) {
  const id = text(row.id || row.row_id);
  const razonSocial = text(row.razon_social);
  const nombreComercial = text(row.nombre_comercial);
  const nombreMostrado = nombreComercial || razonSocial;
  return {
    ID: id,
    "Row ID": text(row.row_id || id),
    "RAZON SOCIAL": razonSocial,
    "NOMBRE COMERCIAL": nombreComercial,
    LOGO: text(row.logo),
    LOGOURL: text(row.logo_url),
    LOGOCALCULADO: text(row.logo_url || row.logo),
    RFC: text(row.rfc),
    LABEL: nombreMostrado,
  };
}

function mapCatalogRow(row) {
  const id = text(row.id || row.row_id);
  return {
    ID: id,
    "Row ID": text(row.row_id || id),
    NOMBRE: text(row.nombre),
    ESCUDO: text(row.escudo),
    "ENCARGADO PC": text(row.encargado_pc),
    PUESTO: text(row.puesto),
  };
}

function mapSucursal(row) {
  const id = text(row.id || row.row_id);
  const tienda = text(row.tienda);
  const nombre = text(row.nombre || row.label2 || row.label);
  const razonSocial = text(row.empresa_nombre);
  const municipio = text(row.municipio_nombre);
  const estado = text(row.estado_nombre);
  const label = text(row.label) || joinLabel(tienda, nombre) || id;
  const label2 = text(row.label2) || label;
  const direccion = text(row.direccion || row.domicilio || row.street);
  const address = direccion || [label, municipio, estado, "Mexico"].filter(Boolean).join(", ");
  const latLng = row.lat !== null && row.lat !== undefined && row.lng !== null && row.lng !== undefined
    ? `${row.lat}, ${row.lng}`
    : "";
  return {
    ID: id,
    "Row ID": text(row.row_id || id),
    TIENDA: tienda,
    NOMBRE: nombre,
    EMPRESA: text(row.empresa_id),
    "ID EMPRESA": text(row.empresa_id),
    "RAZON SOCIAL": razonSocial,
    MUNICIPIO: text(row.municipio_id),
    MUNICIPIO_NOMBRE: municipio,
    ESTADO: text(row.estado_id),
    ESTADO_NOMBRE: estado,
    DIRECCION: direccion,
    DOMICILIO: direccion,
    "DIRECCION GOOGLE": direccion,
    "lat/lng": latLng,
    LAT: row.lat ?? "",
    LNG: row.lng ?? "",
    ID_PC: text(row.id_pc),
    DRIVE: text(row.drive),
    "MES PLANEACION": row.mes_planeacion ?? row.assigned_month ?? "",
    CAPACITADORES: text(row.capacitadores),
    TRABAJOS: text(row.trabajos),
    TIPO: text(row.tipo),
    "NIVEL DE RIESGO": text(row.nivel_riesgo),
    "PRECIO ESTATAL": row.precio_estatal ?? "",
    "PRECIO MUNICIPAL": row.precio_municipal ?? "",
    "VENCIMIENTO ESTATAL": text(row.vencimiento_estatal),
    "VENCIMIENTO MUNICIPAL": text(row.vencimiento_municipal),
    "ULTIMO PIPC ESTATAL": text(row.ultimo_pipc_estatal),
    "ULTIMO MUNICIPAL": text(row.ultimo_municipal),
    PEDIDO: text(row.pedido),
    STATUS: text(row.planeacion_status),
    LABEL: label,
    LABEL2: label2,
    address,
  };
}

function mapEmpleado(row) {
  const id = text(row.id || row.row_id);
  return {
    ID: id,
    "Row ID": text(row.row_id || id),
    NOMBRE: text(row.nombre),
    INICIALES: text(row.iniciales),
    COLOR: text(row.color),
    PUESTO: text(row.puesto),
    CORREO: text(row.correo),
    CAPACITA: text(row.capacita),
    PERMISO: text(row.permiso),
    FIRMA: text(row.firma),
    "CUMPLEAÑOS": text(row.cumpleanos),
    TELEFONO: text(row.telefono),
    "TELEFONO 2": text(row.telefono_2),
  };
}

function mapCapacitacion(row) {
  const id = text(row.id || row.row_id);
  const fechaCapacitacion = text(row.fecha_capacitacion);
  const status = deriveCapacitacionStatus(fechaCapacitacion) || text(row.status);
  return {
    ID: id,
    "Row ID": text(row.row_id || id),
    "FECHA CAPACITACION": fechaCapacitacion,
    "HORA INICIO": text(row.hora_inicio),
    "HORA FIN": text(row.hora_fin),
    CEDE: text(row.cede_sucursal_id),
    SUCURSALES: text(row.sucursales_ids || row.sucursales),
    CAPACITADORES: text(row.capacitadores_ids || row.capacitadores),
    STATUS: status,
    DIPLOMAS: text(row.diplomas),
    NOTAS: text(row.notas),
  };
}

function readSucursales() {
  return readLocalRows(`
    SELECT s.*, e.razon_social AS empresa_nombre,
      m.nombre AS municipio_nombre, es.nombre AS estado_nombre
    FROM sucursales s
    LEFT JOIN empresas e ON e.id = s.empresa_id
    LEFT JOIN municipios m ON m.id = s.municipio_id
    LEFT JOIN estados es ON es.id = s.estado_id
  `).map(mapSucursal);
}

function readCapacitaciones() {
  return readLocalRows(`
    SELECT c.*,
      COALESCE((
        SELECT group_concat(x.sucursal_id, ', ')
        FROM (SELECT cs.sucursal_id FROM capacitacion_sucursales cs
          WHERE cs.capacitacion_id = c.id ORDER BY cs.orden) x
      ), '') AS sucursales_ids,
      COALESCE((
        SELECT group_concat(x.empleado_id, ', ')
        FROM (SELECT cc.empleado_id FROM capacitacion_capacitadores cc
          WHERE cc.capacitacion_id = c.id ORDER BY cc.orden) x
      ), '') AS capacitadores_ids
    FROM capacitaciones c
  `).map(mapCapacitacion);
}

function readMirroredRows(tableName, source) {
  return readLocalRows(`
    SELECT row_id, data_json FROM operational_rows
    WHERE source = ? AND table_name = ? ORDER BY updated_at, row_id
  `, [source, tableName]).flatMap((row) => {
    try {
      const parsed = JSON.parse(row.data_json);
      return [{ ...parsed, "Row ID": text(parsed["Row ID"] || row.row_id) }];
    } catch {
      return [];
    }
  });
}

function mapCatalogo(row) {
  const id = text(row.id || row.row_id);
  return {
    ID: id, "Row ID": text(row.row_id || id), CODIGO: text(row.codigo), NOMBRE: text(row.nombre),
    PRECIO_SUGERIDO: row.precio_sugerido ?? "", TIPO: text(row.tipo), IVA: row.iva ?? "",
    DESCRIPCION: text(row.descripcion),
  };
}

function mapProveedor(row) {
  const id = text(row.id || row.row_id);
  return {
    ID: id, "Row ID": text(row.row_id || id), NOMBRE: text(row.nombre), BANCO: text(row.banco),
    "CUENTA BANCARIA": text(row.cuenta_bancaria), CLABE: text(row.clabe),
    "PIE DE FIRMA": text(row.pie_de_firma), PUESTO: text(row.puesto), FIRMA: text(row.firma),
  };
}

function mapCotizacion(row) {
  const id = text(row.id || row.row_id);
  const centrosTrabajo = text(row.centros_ids);
  return {
    ID: id, "Row ID": text(row.row_id || id), "RAZON SOCIAL": text(row.empresa_id),
    EMPRESA: text(row.empresa_id), FECHA: text(row.fecha), PROVEEDOR: text(row.proveedor_id),
    TITULO: text(row.titulo),
    CENTRO_DE_TRABAJO: centrosTrabajo,
    CENTROS_DE_TRABAJO: centrosTrabajo,
  };
}

function readCotizaciones() {
  return readLocalRows(`
    SELECT c.*, COALESCE((
      SELECT group_concat(x.sucursal_id, ', ')
      FROM (SELECT ct.sucursal_id FROM cotizacion_centros_trabajo ct
        WHERE ct.cotizacion_id = c.id ORDER BY ct.orden) x
    ), '') AS centros_ids
    FROM cotizaciones c
  `).map(mapCotizacion);
}

function mapConceptoCotizacion(row) {
  const id = text(row.id || row.row_id);
  const cantidad = Number(row.cantidad || 0);
  const precio = Number(row.precio || 0);
  const ivaRaw = Number(row.iva || 0);
  const iva = ivaRaw > 1 ? ivaRaw / 100 : ivaRaw;
  const subtotal = cantidad * precio;
  const totalIva = subtotal * iva;
  return {
    ID: id, "Row ID": text(row.row_id || id), COTIZACION: text(row.cotizacion_id),
    CENTRO_DE_TRABAJO: text(row.centro_trabajo_id), CONCEPTO: text(row.concepto_id),
    CANTIDAD: row.cantidad ?? "", PRECIO: row.precio ?? "", IVA: row.iva ?? "",
    SUBTOTAL: Math.round(subtotal * 100) / 100,
    "TOTAL IVA": Math.round(totalIva * 100) / 100,
    TOTAL: Math.round((subtotal + totalIva) * 100) / 100,
  };
}

export function readLocalOperationalTable(tableName, { source = "desarrolloeg" } = {}) {
  const table = text(tableName).toUpperCase();
  if (table === "EMPRESAS") return readLocalRows("SELECT * FROM empresas").map(mapEmpresa);
  if (table === "MUNICIPIOS") return readLocalRows("SELECT * FROM municipios").map(mapCatalogRow);
  if (table === "ESTADOS") return readLocalRows("SELECT * FROM estados").map(mapCatalogRow);
  if (table === "SUCURSALES") return readSucursales();
  if (table === "EMPLEADOS") return readLocalRows("SELECT * FROM empleados").map(mapEmpleado);
  if (table === "CAPACITACIONES") return readCapacitaciones();
  if (table === "CATALOGO") return readLocalRows("SELECT * FROM catalogo").map(mapCatalogo);
  if (table === "PROVEEDORES") return readLocalRows("SELECT * FROM proveedores").map(mapProveedor);
  if (table === "COTIZACIONES" || table === "COTIZACIONES_VARIOS_CT") return readCotizaciones();
  if (table === "CONCEPTOS_COTIZACION" || table === "CONCEPTOS_VARIOS_CT") {
    return readLocalRows("SELECT * FROM conceptos_cotizacion").map(mapConceptoCotizacion);
  }
  return readMirroredRows(table, source);
}

export function readConstanciasContext() {
  return {
    empresas: readLocalOperationalTable("EMPRESAS"),
    sucursales: readLocalOperationalTable("SUCURSALES"),
    capacitaciones: readLocalOperationalTable("CAPACITACIONES"),
    estados: readLocalOperationalTable("ESTADOS"),
    municipios: readLocalOperationalTable("MUNICIPIOS"),
    empleados: readLocalOperationalTable("EMPLEADOS"),
  };
}
