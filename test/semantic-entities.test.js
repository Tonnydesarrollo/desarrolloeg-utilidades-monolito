import test from "node:test";
import assert from "node:assert/strict";

import {
  canReadSemanticEntity,
  resolveSemanticEntity,
  semanticCatalogForIdentity,
} from "../src/modules/whatsapp-capacitadores/semanticEntities.js";

const admin = { role: "admin", accessProfile: { views: new Proxy({}, {
  get: () => ({ actions: ["view"], scope: "all" }),
}) } };

test("resuelve sinonimos del negocio a una entidad canonica", () => {
  assert.equal(resolveSemanticEntity("tiendas").name, "sucursales");
  assert.equal(resolveSemanticEntity("trabajos estatales").name, "pipc");
  assert.equal(resolveSemanticEntity("planes de contingencia").name, "municipales");
});

test("el catalogo declara fuentes, campos y relaciones sin exponer IDs", () => {
  const catalog = semanticCatalogForIdentity(admin);
  assert.ok(catalog.length >= 15);
  const training = catalog.find((item) => item.entidad === "capacitaciones");
  assert.equal(training.fuente, "CAPACITACIONES");
  assert.ok(training.relaciones.includes("sucursales"));
  assert.ok(training.campos.includes("FECHA CAPACITACION"));
  assert.match(training.descripcion, /Eventos impartidos/);
  assert.ok(!training.campos.includes("ID"));
});

test("respeta permisos y reserva empleados para administradores", () => {
  const trainer = { role: "capacitador", accessProfile: { views: {
    capacitaciones: { actions: ["view"], scope: "own" },
    whatsapp: { actions: ["view"], scope: "all" },
  } } };
  assert.equal(canReadSemanticEntity(trainer, resolveSemanticEntity("capacitaciones")), true);
  assert.equal(canReadSemanticEntity(trainer, resolveSemanticEntity("empleados")), false);
});

test("cubre los modulos operativos principales con una fuente y permiso explicitos", () => {
  const catalog = semanticCatalogForIdentity(admin);
  for (const name of ["pedidos", "liberaciones", "planeacion", "solventaciones",
    "reportes_inspeccion", "polizas", "facturas", "notas"]) {
    const entity = catalog.find((item) => item.entidad === name);
    assert.ok(entity, `falta ${name}`);
    assert.ok(entity.fuente);
    assert.ok(entity.campos.length > 0);
  }
  assert.equal(resolveSemanticEntity("pedidos ley").name, "pedidos");
  assert.equal(resolveSemanticEntity("inspecciones").name, "reportes_inspeccion");
});
