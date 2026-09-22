import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { searchAuthorizedDocumentation, searchAuthorizedOperationalData } from "../src/modules/whatsapp-capacitadores/authorizedKnowledge.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("recupera documentacion pertinente para administradores", () => {
  const results = searchAuthorizedDocumentation("Como funciona la cotizacion en AppSheet", { role: "admin" }, root);
  assert.ok(results.some((item) => item.fuente === "docs/cotizaciones-appsheet.md"));
});

test("no expone documentacion tecnica a empleados sin permiso", () => {
  const results = searchAuthorizedDocumentation("cotizacion AppSheet", {
    role: "capacitador",
    accessProfile: { views: { facturacion: { actions: [] } } },
  }, root);
  assert.ok(results.every((item) => item.fuente !== "docs/cotizaciones-appsheet.md"));
});

test("recupera el modelo de negocio con sinonimos del dominio sin ampliar permisos", () => {
  const results = searchAuthorizedDocumentation("Como se relacionan PIPC, tiendas y sistema PC", {
    role: "capacitador", accessProfile: { views: {} },
  }, root);
  assert.ok(results.some((item) => item.fuente === "docs/asistente-modelo-negocio.md"));
  assert.ok(results.every((item) => item.fuente !== "docs/cotizaciones-appsheet.md"));
});

test("busca datos operativos con etiquetas y respeta el permiso del modulo", () => {
  const tables = {
    EMPRESAS: [{ ID: "1", "RAZON SOCIAL": "CASA LEY" }],
    SUCURSALES: [{ ID: "s1", TIENDA: "1366", NOMBRE: "SUPER LEY EXPRESS MENDOZA", "RAZON SOCIAL": "CASA LEY" }],
    ESTATALES: [{ SUCURSAL: "s1", FECHA: "09/03/2026", PIPC: "IMPRESO" }],
  };
  const read = (table) => tables[table] || [];
  const permitted = { role: "admin", accessProfile: { views: { gestion: { actions: ["view"] } } } };
  const denied = { role: "capacitador", accessProfile: { views: {} } };
  const results = searchAuthorizedOperationalData("Trabajos estatales de la tienda 1366 de Ley", permitted, read);
  assert.equal(results[0].registros[0].tienda, "1366");
  assert.equal(results[0].registros[0].empresa, "CASA LEY");
  assert.deepEqual(searchAuthorizedOperationalData("Trabajos estatales de Ley", denied, read), []);
});

test("filtra sucursales por Ley aunque el nombre comercial venga de empresas", () => {
  const tables = {
    EMPRESAS: [{ ID: "1", "RAZON SOCIAL": "CASA LEY" }],
    SUCURSALES: [
      { ID: "s1", TIENDA: "1366", NOMBRE: "SUPER LEY EXPRESS MENDOZA", "ID EMPRESA": "1" },
      { ID: "s2", TIENDA: "1366", NOMBRE: "OTRA EMPRESA", "RAZON SOCIAL": "OTRA EMPRESA" },
    ],
  };
  const identity = { role: "admin", accessProfile: { views: { "informacion-sucursales": { actions: ["view"] } } } };
  const results = searchAuthorizedOperationalData("Dame informacion de la tienda 1366 de Ley", identity,
    (table) => tables[table] || []);
  assert.equal(results[0].total, 1);
  assert.equal(results[0].registros[0].empresa, "CASA LEY");
});
