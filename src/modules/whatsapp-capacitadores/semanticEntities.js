const definitions = [
  { name: "empresas", aliases: ["empresa", "clientes", "razones sociales"], description: "Clientes contratantes; una empresa agrupa sucursales y usa razon social y nombre comercial.", table: "EMPRESAS", view: "informacion-sucursales",
    fields: ["RAZON SOCIAL", "NOMBRE COMERCIAL", "RFC"], label: ["NOMBRE COMERCIAL", "RAZON SOCIAL"], relations: ["sucursales"] },
  { name: "sucursales", aliases: ["sucursal", "tiendas", "centros de trabajo"], description: "Centros de trabajo o tiendas pertenecientes a una empresa, identificados para el usuario por numero de tienda y nombre.", table: "SUCURSALES", view: "informacion-sucursales",
    fields: ["TIENDA", "NOMBRE", "RAZON SOCIAL", "TIPO", "MUNICIPIO_NOMBRE", "ESTADO_NOMBRE", "DIRECCION", "NIVEL DE RIESGO", "TRABAJOS", "VENCIMIENTO ESTATAL", "VENCIMIENTO MUNICIPAL"],
    label: ["TIENDA", "NOMBRE"], relations: ["empresas", "municipios", "estados", "capacitaciones", "pipc", "municipales", "documentos"] },
  { name: "capacitaciones", aliases: ["capacitacion", "cursos"], description: "Eventos impartidos en una fecha y sede, con sucursales participantes, capacitadores y estado derivado de la fecha.", table: "CAPACITACIONES", view: "capacitaciones", ownField: "CAPACITADORES",
    fields: ["FECHA CAPACITACION", "HORA INICIO", "HORA FIN", "CEDE", "SUCURSALES", "CAPACITADORES", "STATUS", "DIPLOMAS", "NOTAS"],
    label: ["FECHA CAPACITACION", "CEDE"], relations: ["sucursales", "empleados", "documentos"] },
  { name: "empleados", aliases: ["empleado", "personal", "capacitadores"], description: "Personal interno; contiene identidad laboral y datos de capacitadores. Solo administracion puede listar empleados.", table: "EMPLEADOS", view: "whatsapp", adminOnly: true,
    fields: ["NOMBRE", "PUESTO", "CAPACITA", "INICIALES"], label: ["NOMBRE"], relations: ["capacitaciones", "calendario"] },
  { name: "calendario", aliases: ["eventos", "agenda", "notas"], description: "Agenda interna de actividades asignadas a empleados.", table: "CALENDARIO", view: "calendario", ownField: "EMPLEADOS",
    fields: ["FECHA", "TITULO", "NOTAS", "EMPLEADOS"], label: ["TITULO", "FECHA"], relations: ["empleados"] },
  { name: "pipc", aliases: ["estatales", "trabajos estatales", "proteccion civil estatal"], description: "Trabajos estatales y avance del Programa Interno de Proteccion Civil por sucursal y ano. PIPC y Sistema PC son estados distintos.", table: "ESTATALES", view: "gestion",
    fields: ["FECHA", "TIENDA", "SUCURSAL", "PIPC", "SISTEMA PC", "VENCIMIENTO", "NOTAS"], label: ["TIENDA", "PIPC"], relations: ["sucursales", "capacitaciones", "documentos"] },
  { name: "municipales", aliases: ["trabajos municipales", "planes de contingencia"], description: "Trabajos municipales y planes de contingencia relacionados con sucursales.", table: "MUNICIPALES", view: "gestion",
    fields: ["FECHA", "TIENDA", "SUCURSAL", "PLAN DE CONTINGENCIA", "NOTAS"], label: ["TIENDA", "PLAN DE CONTINGENCIA"], relations: ["sucursales", "documentos"] },
  { name: "sistema_pc", aliases: ["status sistema pc", "solicitudes pc"], description: "Solicitudes y etapas registradas en el sistema de Proteccion Civil Estatal; no equivale al estado documental PIPC.", table: "STATUS SISTEMA PC", view: "gestion",
    fields: ["SUCURSAL", "ESTATUS", "FECHA", "AÑO"], label: ["SUCURSAL", "ESTATUS"], relations: ["sucursales", "pipc"] },
  { name: "catalogo", aliases: ["conceptos", "servicios", "precios"], description: "Catalogo comercial de servicios, conceptos, precios sugeridos e IVA.", table: "CATALOGO", view: "facturacion",
    fields: ["CODIGO", "NOMBRE", "DESCRIPCION", "TIPO", "PRECIO_SUGERIDO", "IVA"], label: ["CODIGO", "NOMBRE"], relations: ["conceptos_cotizacion"] },
  { name: "proveedores", aliases: ["proveedor"], description: "Proveedores disponibles para operaciones de facturacion y cotizaciones.", table: "PROVEEDORES", view: "facturacion",
    fields: ["NOMBRE", "PUESTO"], label: ["NOMBRE"], relations: ["cotizaciones"] },
  { name: "cotizaciones", aliases: ["cotizacion", "presupuestos"], description: "Encabezados de propuestas comerciales relacionados con empresa, proveedor y centros de trabajo.", table: "COTIZACIONES", view: "facturacion",
    fields: ["FECHA", "TITULO", "EMPRESA", "PROVEEDOR", "CENTROS_DE_TRABAJO"], label: ["TITULO", "FECHA"], relations: ["empresas", "sucursales", "proveedores", "conceptos_cotizacion"] },
  { name: "conceptos_cotizacion", aliases: ["partidas de cotizacion"], description: "Partidas de una cotizacion con concepto, cantidad, precio, IVA y totales.", table: "CONCEPTOS_COTIZACION", view: "facturacion",
    fields: ["COTIZACION", "CENTRO_DE_TRABAJO", "CONCEPTO", "CANTIDAD", "PRECIO", "IVA", "SUBTOTAL", "TOTAL IVA", "TOTAL"],
    label: ["CONCEPTO", "CENTRO_DE_TRABAJO"], relations: ["cotizaciones", "catalogo", "sucursales"] },
  { name: "estados", aliases: ["estado"], description: "Catalogo geografico de estados y responsables de Proteccion Civil.", table: "ESTADOS", view: "informacion-sucursales",
    fields: ["NOMBRE", "ENCARGADO PC", "PUESTO"], label: ["NOMBRE"], relations: ["municipios", "sucursales"] },
  { name: "municipios", aliases: ["municipio", "ciudades"], description: "Catalogo geografico de municipios y responsables de Proteccion Civil.", table: "MUNICIPIOS", view: "informacion-sucursales",
    fields: ["NOMBRE", "ENCARGADO PC", "PUESTO"], label: ["NOMBRE"], relations: ["estados", "sucursales"] },
  { name: "documentos", aliases: ["documento", "archivos", "drive"], description: "Archivos autorizados almacenados en las carpetas Drive asociadas a sucursales.", source: "GOOGLE_DRIVE", view: "documentos",
    fields: ["NOMBRE", "RUTA", "MIME_TYPE", "ENLACE"], label: ["NOMBRE"], relations: ["sucursales", "capacitaciones"] },
  { name: "pedidos", aliases: ["pedido", "pedidos ley", "ordenes de compra"], description: "Pedidos recibidos para entregar trabajos y documentos de sucursales, con tipo, estatus, facturador y archivos asociados.", table: "PEDIDOS_LEY", view: "pedidos",
    fields: ["PEDIDO", "FECHA", "TIPO", "SUCURSAL", "ESTATUS", "ENVIADO", "FACTURADOR", "PDF"], label: ["PEDIDO", "SUCURSAL"], relations: ["sucursales", "empresas", "documentos", "liberaciones"] },
  { name: "liberaciones", aliases: ["liberacion", "pedidos liberados"], description: "Liberaciones y avance de entrega o facturacion vinculados con pedidos.", table: "LIBERACIONES", view: "pedidos",
    fields: ["PEDIDO", "FECHA", "SUCURSAL", "ESTATUS", "FACTURA", "NOTAS"], label: ["PEDIDO", "ESTATUS"], relations: ["pedidos", "sucursales", "facturas"] },
  { name: "planeacion", aliases: ["planificacion", "programacion de trabajos"], description: "Planeacion operativa de trabajos por sucursal, periodo, responsable y estado.", table: "PLANEACION", view: "planeacion",
    fields: ["FECHA", "MES", "ANIO", "SUCURSAL", "TRABAJO", "RESPONSABLE", "ESTATUS", "NOTAS"], label: ["SUCURSAL", "TRABAJO", "FECHA"], relations: ["sucursales", "empleados", "pipc", "municipales"] },
  { name: "solventaciones", aliases: ["solventacion", "observaciones", "correcciones"], description: "Observaciones detectadas y seguimiento de su correccion para una sucursal o inspeccion.", table: "SOLVENTACIONES", view: "gestion",
    fields: ["FECHA", "SUCURSAL", "OBSERVACION", "RESPONSABLE", "ESTATUS", "FECHA SOLVENTACION", "EVIDENCIA"], label: ["SUCURSAL", "OBSERVACION"], relations: ["sucursales", "reportes_inspeccion", "documentos", "empleados"] },
  { name: "reportes_inspeccion", aliases: ["reporte de inspeccion", "reportes de inspeccion", "inspecciones"], description: "Reportes y resultados de inspecciones realizadas en sucursales.", table: "REPORTES_INSPECCIONES", view: "reportes",
    fields: ["FECHA", "SUCURSAL", "TIPO", "INSPECTOR", "RESULTADO", "ESTATUS", "DOCUMENTO"], label: ["SUCURSAL", "FECHA", "TIPO"], relations: ["sucursales", "solventaciones", "documentos", "empleados"] },
  { name: "polizas", aliases: ["poliza", "polizas ley"], description: "Polizas y vigencias asociadas a empresas o sucursales.", table: "POLIZAS", view: "poliza",
    fields: ["FECHA", "EMPRESA", "SUCURSAL", "POLIZA", "VIGENCIA", "ESTATUS", "DOCUMENTO"], label: ["POLIZA", "SUCURSAL"], relations: ["empresas", "sucursales", "documentos"] },
  { name: "facturas", aliases: ["factura", "cfdi", "cfdis"], description: "Comprobantes fiscales y estado de facturacion relacionados con clientes, pedidos o cotizaciones.", table: "CFDIS", view: "facturacion",
    fields: ["FECHA", "FOLIO", "UUID", "RFC", "CLIENTE", "SUBTOTAL", "IVA", "TOTAL", "ESTATUS"], label: ["FOLIO", "CLIENTE", "FECHA"], relations: ["empresas", "pedidos", "cotizaciones"] },
  { name: "notas", aliases: ["nota", "comentarios internos", "menciones"], description: "Notas internas relacionadas con registros de la plataforma y sus autores.", table: "PORTAL_NOTAS", view: "notas", ownField: "AUTOR_ID",
    fields: ["ENTIDAD", "REGISTRO", "AUTOR", "CONTENIDO", "FECHA"], label: ["CONTENIDO", "FECHA"], relations: ["empleados", "capacitaciones", "sucursales"] },
];

export const SEMANTIC_ENTITIES = Object.freeze(Object.fromEntries(definitions.map((item) => [item.name, Object.freeze(item)])));

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function resolveSemanticEntity(value) {
  const query = normalize(value).replace(/[\s-]+/g, "_");
  return definitions.find((item) => item.name === query
    || item.aliases.some((alias) => normalize(alias).replace(/[\s-]+/g, "_") === query)) || null;
}

export function canReadSemanticEntity(identity, entity) {
  if (!identity || identity.role === "sin-acceso" || !entity) return false;
  if (entity.adminOnly && identity.role !== "admin") return false;
  const permission = identity.accessProfile?.views?.[entity.view];
  if (permission?.actions?.includes("view") !== true || permission.scope === "none") return false;
  return permission.scope !== "own" || Boolean(entity.ownField);
}

export function semanticCatalogForIdentity(identity) {
  return definitions.filter((entity) => canReadSemanticEntity(identity, entity)).map((entity) => ({
    entidad: entity.name,
    descripcion: entity.description,
    sinonimos: entity.aliases,
    fuente: entity.table || entity.source,
    campos: entity.fields,
    etiqueta: entity.label,
    relaciones: entity.relations,
    alcance: identity.accessProfile?.views?.[entity.view]?.scope || "none",
  }));
}

export function projectSemanticRow(entity, row) {
  return Object.fromEntries(entity.fields.flatMap((field) => {
    const expected = normalize(field).replace(/[^a-z0-9]/g, "");
    const key = Object.keys(row || {}).find((candidate) =>
      normalize(candidate).replace(/[^a-z0-9]/g, "") === expected
    );
    const value = key ? row[key] : undefined;
    return value === undefined || value === null || String(value).trim() === "" ? [] : [[field, value]];
  }));
}
