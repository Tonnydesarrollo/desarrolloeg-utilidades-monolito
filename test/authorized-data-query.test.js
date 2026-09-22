import test from "node:test";
import assert from "node:assert/strict";
import { executeAuthorizedDataQuery } from "../src/modules/whatsapp-capacitadores/authorizedDataQuery.js";

const tables = {
  EMPRESAS: [{ ID: "1", "RAZON SOCIAL": "CASA LEY" }, { ID: "2", "RAZON SOCIAL": "OTRA EMPRESA" }],
  SUCURSALES: [
    { ID: "a", TIENDA: "1366", NOMBRE: "MENDOZA", "ID EMPRESA": "1", "RAZON SOCIAL": "CASA LEY" },
    { ID: "b", TIENDA: "1002", NOMBRE: "RUBI", "ID EMPRESA": "1", "RAZON SOCIAL": "CASA LEY" },
    { ID: "c", TIENDA: "55", NOMBRE: "OTRA", "ID EMPRESA": "2", "RAZON SOCIAL": "OTRA EMPRESA" },
  ],
  ESTATALES: [
    { SUCURSAL: "a", FECHA: "01/07/2026", PIPC: "PENDIENTE", "SISTEMA PC": "" },
    { SUCURSAL: "a", FECHA: "15/09/2026", PIPC: "ENTREGADO", "SISTEMA PC": "EN SISTEMA PC" },
    { SUCURSAL: "b", FECHA: "12/09/2026", PIPC: "IMPRESO", "SISTEMA PC": "" },
    { SUCURSAL: "c", FECHA: "15/09/2026", PIPC: "ENTREGADO", "SISTEMA PC": "EN SISTEMA PC" },
  ],
};
const read = (table) => tables[table] || [];
const identity = { role: "admin", accessProfile: { views: {
  "informacion-sucursales": { actions: ["view"], scope: "all" }, gestion: { actions: ["view"], scope: "all" },
} } };

test("la consulta estructurada agrupa PIPC por tienda, empresa y ano", () => {
  const result = executeAuthorizedDataQuery({ entidad: "pipc", empresa: "Ley", anio: 2026, detalle: true }, identity, read);
  assert.equal(result.total, 2);
  assert.deepEqual(result.sistemaPc, { enSistema: 1, pendientes: 1 });
  assert.deepEqual(result.porEstatusPipc, [
    { estatus: "ENTREGADO", total: 1 }, { estatus: "IMPRESO", total: 1 },
  ]);
  assert.deepEqual(result.registros.map((row) => row.tienda), ["1366", "1002"]);
  const summary = executeAuthorizedDataQuery({ entidad: "pipc", empresa: "Ley", anio: 2026 }, identity, read);
  assert.equal(summary.total, 2);
  assert.equal(summary.detalleOmitido, true);
  assert.deepEqual(summary.registros, []);
});

test("la consulta no permite SQL libre ni supera los permisos del empleado", () => {
  assert.deepEqual(executeAuthorizedDataQuery({ entidad: "sqlite_master" }, identity, read), { error: "Entidad no disponible" });
  const limited = { role: "capacitador", accessProfile: { views: {
    "informacion-sucursales": { actions: ["view"], scope: "all" },
  } } };
  assert.deepEqual(executeAuthorizedDataQuery({ entidad: "pipc", empresa: "Ley" }, limited, read),
    { error: "Sin permiso para consultar esta informacion" });
  assert.equal(executeAuthorizedDataQuery({ entidad: "sucursales", tienda: "1366" }, limited, read).total, 1);
  assert.equal(executeAuthorizedDataQuery({ entidad: "empresas" }, limited, read).total, 2);
  limited.accessProfile.views["informacion-sucursales"].scope = "own";
  assert.deepEqual(executeAuthorizedDataQuery({ entidad: "sucursales" }, limited, read),
    { error: "Sin permiso para consultar esta informacion" });
});

test("limita el detalle sin alterar el total agregado", () => {
  const many = { ...tables,
    SUCURSALES: Array.from({ length: 12 }, (_, index) => ({
      ID: `s${index}`, TIENDA: String(1000 + index), NOMBRE: `TIENDA ${index}`,
      "ID EMPRESA": "1", "RAZON SOCIAL": "CASA LEY",
    })),
  };
  const result = executeAuthorizedDataQuery({ entidad: "sucursales", empresa: "Ley", detalle: true },
    identity, (table) => many[table] || []);
  assert.equal(result.total, 12);
  assert.equal(result.registros.length, 8);
  assert.equal(result.truncado, true);
});

test("consulta trabajos municipales por nombre comercial y ano sin inventar sucursales", () => {
  const data = {
    EMPRESAS: [{ ID: "m", "RAZON SOCIAL": "OPERADORA DE ROPA SA", "NOMBRE COMERCIAL": "MILANO" }],
    SUCURSALES: [
      { ID: "a", TIENDA: "10", NOMBRE: "MILANO CENTRO", "ID EMPRESA": "m", MUNICIPIO_NOMBRE: "CULIACAN" },
      { ID: "b", TIENDA: "11", NOMBRE: "MILANO NORTE", "ID EMPRESA": "m", MUNICIPIO_NOMBRE: "MAZATLAN" },
    ],
    MUNICIPALES: [
      { SUCURSAL: "a", FECHA: "01/02/2026" },
      { SUCURSAL: "a", FECHA: "02/02/2026" },
      { SUCURSAL: "b", FECHA: "01/02/2025" },
    ],
  };
  const source = (table) => data[table] || [];
  const result = executeAuthorizedDataQuery({ entidad: "municipales", empresa: "Milano", anio: 2026,
    detalle: true }, identity, source);
  assert.equal(result.total, 1);
  assert.deepEqual(result.registros.map((row) => row.sucursal), ["MILANO CENTRO"]);
  const city = executeAuthorizedDataQuery({ entidad: "sucursales", empresa: "Milano", municipio: "Culiacan",
    detalle: true }, identity, source);
  assert.equal(city.total, 1);
  assert.deepEqual(city.registros.map((row) => row.nombre), ["MILANO CENTRO"]);
});

test("lista empresas desde el catalogo sin convertir sucursales en empresas", () => {
  const data = { EMPRESAS: [
    { ID: "a", "RAZON SOCIAL": "CASA LEY SAPI", "NOMBRE COMERCIAL": "CASA LEY" },
    { ID: "b", "RAZON SOCIAL": "MILANO OPERADORA", "NOMBRE COMERCIAL": "MILANO" },
  ], SUCURSALES: Array.from({ length: 9 }, (_, index) => ({ ID: String(index), "ID EMPRESA": "a" })) };
  const result = executeAuthorizedDataQuery({ entidad: "empresas", detalle: true, limite: 100 },
    identity, (table) => data[table] || []);
  assert.equal(result.total, 2);
  assert.deepEqual(result.registros.map((row) => row.nombre), ["CASA LEY", "MILANO"]);
  assert.equal(result.truncado, false);
});

test("consulta una entidad semantica con etiquetas y alcance propio", () => {
  const data = { ...tables,
    EMPLEADOS: [{ ID: "e1", NOMBRE: "GILBERTO" }, { ID: "e2", NOMBRE: "OTRO" }],
    CAPACITACIONES: [
      { "FECHA CAPACITACION": "09/23/2026", CEDE: "a", SUCURSALES: "a, b", CAPACITADORES: "e1", STATUS: "PROGRAMADA" },
      { "FECHA CAPACITACION": "09/24/2026", CEDE: "b", SUCURSALES: "b", CAPACITADORES: "e2", STATUS: "PROGRAMADA" },
    ],
  };
  const trainer = { id: "e1", role: "capacitador", accessProfile: { views: {
    capacitaciones: { actions: ["view"], scope: "own" },
  } } };
  const result = executeAuthorizedDataQuery({ entidad: "capacitaciones", detalle: true }, trainer,
    (table) => data[table] || []);
  assert.equal(result.total, 1);
  assert.equal(result.registros[0].CEDE, "1366 MENDOZA");
  assert.equal(result.registros[0].CAPACITADORES, "GILBERTO");
});

test("filtra por etiquetas relacionadas y devuelve la capacitacion mas reciente", () => {
  const data = { ...tables,
    SUCURSALES: [
      { ID: "f", TIENDA: "20", NOMBRE: "FARMACIA CENTRO", "ID EMPRESA": "1" },
      { ID: "o", TIENDA: "21", NOMBRE: "OTRA SUCURSAL", "ID EMPRESA": "1" },
    ],
    EMPLEADOS: [{ ID: "e1", NOMBRE: "GILBERTO" }],
    CAPACITACIONES: [
      { "FECHA CAPACITACION": "01/16/2026", CEDE: "f", SUCURSALES: "f", CAPACITADORES: "e1", STATUS: "FINALIZADA" },
      { "FECHA CAPACITACION": "09/18/2026", CEDE: "f", SUCURSALES: "f", CAPACITADORES: "e1", STATUS: "FINALIZADA" },
      { "FECHA CAPACITACION": "09/20/2026", CEDE: "o", SUCURSALES: "o", CAPACITADORES: "e1", STATUS: "FINALIZADA" },
    ],
  };
  const admin = { role: "admin", accessProfile: { views: {
    capacitaciones: { actions: ["view"], scope: "all" },
  } } };
  const result = executeAuthorizedDataQuery({ entidad: "capacitaciones", texto: "farmacia",
    orden: "reciente", detalle: true, limite: 1 }, admin, (table) => data[table] || []);
  assert.equal(result.total, 2);
  assert.equal(result.registros.length, 1);
  assert.equal(result.registros[0]["FECHA CAPACITACION"], "09/18/2026");
  assert.equal(result.registros[0].CEDE, "20 FARMACIA CENTRO");
});

test("consulta pedidos por empresa y reemplaza relaciones internas por etiquetas", () => {
  const data = {
    EMPRESAS: [{ ID: "1", "NOMBRE COMERCIAL": "CASA LEY" }],
    SUCURSALES: [{ ID: "s1", TIENDA: "1312", NOMBRE: "ANGOSTURA", "ID EMPRESA": "1" }],
    EMPLEADOS: [{ ID: "e1", NOMBRE: "PALOMA" }],
    PEDIDOS_LEY: [{ PEDIDO: "6001343895", FECHA: "2026-09-21", TIPO: "ESTATAL",
      SUCURSAL: "s1", ESTATUS: "RECIBIDO", FACTURADOR: "e1" }],
  };
  const admin = { role: "admin", accessProfile: { views: {
    pedidos: { actions: ["view"], scope: "all" },
  } } };
  const result = executeAuthorizedDataQuery({ entidad: "pedidos", empresa: "Ley", detalle: true }, admin,
    (table) => data[table] || []);
  assert.equal(result.total, 1);
  assert.equal(result.fuente, "PEDIDOS_LEY");
  assert.equal(result.registros[0].SUCURSAL, "1312 ANGOSTURA");
  assert.equal(result.registros[0].PEDIDO, "6001343895");
});

test("aplica rango de fechas y no expone columnas fuera de la lista autorizada", () => {
  const data = {
    EMPRESAS: [], SUCURSALES: [], EMPLEADOS: [], PROVEEDORES: [],
    REPORTES_INSPECCIONES: [
      { FECHA: "2026-08-01", TIPO: "VISITA", RESULTADO: "CORRECTO", SECRETO: "no mostrar" },
      { FECHA: "2026-09-10", TIPO: "VISITA", RESULTADO: "OBSERVACIONES", SECRETO: "no mostrar" },
    ],
  };
  const admin = { role: "admin", accessProfile: { views: {
    reportes: { actions: ["view"], scope: "all" },
  } } };
  const result = executeAuthorizedDataQuery({ entidad: "reportes_inspeccion", fechaDesde: "2026-09-01",
    fechaHasta: "2026-09-30", detalle: true }, admin, (table) => data[table] || []);
  assert.equal(result.total, 1);
  assert.equal(result.registros[0].RESULTADO, "OBSERVACIONES");
  assert.equal(result.registros[0].SECRETO, undefined);
});
