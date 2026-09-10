import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { conceptRowsFromInput } from "../src/modules/facturacion/services/appsheet.js";

test("crear cotizacion replica cada concepto en todos los centros seleccionados", () => {
  const rows = conceptRowsFromInput({
    centrosTrabajo: ["CENTRO-A", "CENTRO-B"],
    conceptos: [
      { id: "PIPC", cantidad: 1, precio: 1000, iva: 0.16 },
      { id: "CAP", cantidad: 2, precio: 500, iva: 0.16 },
    ],
  }, "COT-1");

  assert.equal(rows.length, 4);
  assert.deepEqual(new Set(rows.map((row) => row.CENTRO_DE_TRABAJO)), new Set(["CENTRO-A", "CENTRO-B"]));
  assert.deepEqual(new Set(rows.map((row) => row.CONCEPTO)), new Set(["PIPC", "CAP"]));
  assert.equal(new Set(rows.map((row) => row["Row ID"])).size, 4);
});

test("editar cotizacion conserva IDs y permite valores diferentes por centro", () => {
  const rows = conceptRowsFromInput({
    centrosTrabajo: ["CENTRO-A", "CENTRO-B"],
    lineas: [
      { id: "LINEA-1", centroTrabajoId: "CENTRO-A", conceptoId: "PIPC", cantidad: 1, precio: 1000, iva: 0.16 },
      { id: "LINEA-2", centroTrabajoId: "CENTRO-B", conceptoId: "PIPC", cantidad: 3, precio: 900, iva: 0.08 },
    ],
  }, "COT-1");

  assert.deepEqual(rows.map((row) => row["Row ID"]), ["LINEA-1", "LINEA-2"]);
  assert.deepEqual(rows.map((row) => row.PRECIO), [1000, 900]);
});

test("el espacio de cotizaciones carga por fetch y el menu no ofrece Facturacion", () => {
  const template = fs.readFileSync(new URL("../src/modules/facturacion/views/cotizacion_editable.ejs", import.meta.url), "utf8");
  const router = fs.readFileSync(new URL("../src/modules/facturacion/facturacion.router.js", import.meta.url), "utf8");
  const menu = fs.readFileSync(new URL("../src/public/ui/portal-shell.js", import.meta.url), "utf8");

  assert.match(template, /Empresa registrada/);
  assert.match(template, /No registrada/);
  assert.match(template, /Centros de trabajo, uno por linea|Centros de trabajo, uno por línea/);
  assert.match(template, /Conceptos por centro de trabajo/);
  assert.match(template, /Agregar concepto a todos los centros/);
  assert.match(template, /addConceptToAllCenters/);
  assert.match(template, /\/cotizaciones\/api\/workspace/);
  assert.match(router, /post\("\/api\/cotizaciones"/);
  assert.match(router, /put\("\/api\/cotizaciones\/:id"/);
  assert.doesNotMatch(menu, /label: "Facturacion"/);
});
