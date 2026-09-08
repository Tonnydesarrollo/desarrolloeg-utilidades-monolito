import assert from "node:assert/strict";
import test from "node:test";
import { getTrabajoTableName, obtenerTrabajosResumen } from "../src/modules/trabajos/trabajos.service.js";

test("municipales y estatales consultan sus tablas persistentes reales", () => {
  assert.equal(getTrabajoTableName("municipales"), "MUNICIPALES");
  assert.equal(getTrabajoTableName("estatales"), "ESTATALES");
  const municipales = obtenerTrabajosResumen("municipales");
  const estatales = obtenerTrabajosResumen("estatales");
  assert.equal(municipales.table, "MUNICIPALES");
  assert.equal(estatales.table, "ESTATALES");
  assert.ok(municipales.items.length > 0);
  assert.ok(estatales.items.length > 0);
  assert.ok(municipales.items.every((item) => Object.hasOwn(item, "drive")));
  assert.ok(estatales.items.every((item) => Object.hasOwn(item, "drive")));
  assert.ok(municipales.companies.some((company) => company.label && company.label !== company.id));
  assert.ok(municipales.groups.every((group) => group.name && Array.isArray(group.items)));
  assert.ok(municipales.statuses.some((status) => status.value === "PENDIENTE DE CREAR"));
  assert.ok(municipales.statuses.every((status) => Number.isInteger(status.count)));
  assert.ok(municipales.companies.every((company) => company.count > 0));
  assert.ok(municipales.items.every((item) => Object.hasOwn(item, "capacitacionStatus")));
});
