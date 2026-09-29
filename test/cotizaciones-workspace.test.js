import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { conceptRowsFromInput, quoteRowFromInput } from "../src/modules/facturacion/services/appsheet.js";

test("crea la cabecera completa que activa el bot de conceptos en AppSheet", () => {
  const row = quoteRowFromInput({
    empresaId: "1",
    centrosTrabajo: ["2", "1", "5"],
    conceptos: [{ id: "PIPC" }, { id: "CAP" }],
    proveedorId: "FIRMA-1",
    fecha: "2026-09-10",
  }, "COT-1", {
    1: { estadoId: "25", municipioId: "1878" },
    2: { estadoId: "25", municipioId: "1874" },
    5: { estadoId: "25", municipioId: "1878" },
  });

  assert.equal(row.ESTADOS, "25");
  assert.equal(row.MUNICIPIOS, "1874 , 1878");
  assert.equal(row.CENTROS_DE_TRABAJO, "2 , 1 , 5");
  assert.equal(row.CONCEPTOS, "PIPC , CAP");
});

test("deja que AppSheet genere el Row ID de una cotizacion nueva", () => {
  const row = quoteRowFromInput({
    empresaId: "1",
    centrosTrabajo: ["1"],
    conceptos: [{ id: "PIPC" }],
    proveedorId: "FIRMA-1",
    fecha: "2026-09-10",
  }, "", {
    1: { estadoId: "25", municipioId: "1878" },
  });

  assert.equal(Object.hasOwn(row, "Row ID"), false);
});

test("deriva estados y municipios de los centros y no de los filtros visuales", () => {
  const row = quoteRowFromInput({
    empresaId: "1",
    estados: ["25", "26"],
    municipios: ["1878", "2001"],
    centrosTrabajo: ["1"],
    conceptos: [{ id: "PIPC" }],
    proveedorId: "FIRMA-1",
    fecha: "2026-09-10",
  }, "", {
    1: { estadoId: "25", municipioId: "1878" },
  });

  assert.equal(row.ESTADOS, "25");
  assert.equal(row.MUNICIPIOS, "1878");
});

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

test("calcula pagos de derechos con el precio de cada centro de trabajo", () => {
  const rows = conceptRowsFromInput({
    centrosTrabajo: ["CENTRO-A", "CENTRO-B"],
    conceptos: [
      { id: "DERECHO-ESTATAL", cantidad: 1, precio: "", precioManual: false, iva: 0.16 },
      { id: "DERECHO-MUNICIPAL", cantidad: 1, precio: "", precioManual: false, iva: 0.16 },
      { id: "SERVICIO", cantidad: 1, precio: 750, precioManual: false, iva: 0.16 },
    ],
  }, "COT-1", {
    branchesById: {
      "CENTRO-A": { precioEstatal: "32,967.49", precioMunicipal: "11,000.00" },
      "CENTRO-B": { precioEstatal: "35,000.00", precioMunicipal: "12,500.00" },
    },
    catalogById: {
      "DERECHO-ESTATAL": { nombre: "PAGO DE DERECHOS ESTATAL", precioSugerido: 16 },
      "DERECHO-MUNICIPAL": { nombre: "PAGO DE DERECHOS MUNICIPAL", precioSugerido: 16 },
      SERVICIO: { nombre: "SERVICIO", precioSugerido: 750 },
    },
  });

  const prices = Object.fromEntries(rows.map((row) => [`${row.CENTRO_DE_TRABAJO}|${row.CONCEPTO}`, row.PRECIO]));
  assert.equal(prices["CENTRO-A|DERECHO-ESTATAL"], 32967.49);
  assert.equal(prices["CENTRO-B|DERECHO-ESTATAL"], 35000);
  assert.equal(prices["CENTRO-A|DERECHO-MUNICIPAL"], 11000);
  assert.equal(prices["CENTRO-B|DERECHO-MUNICIPAL"], 12500);
  assert.equal(prices["CENTRO-A|SERVICIO"], 750);
});

test("el espacio de cotizaciones carga por fetch y el menu no ofrece Facturacion", () => {
  const template = fs.readFileSync(new URL("../src/modules/facturacion/views/cotizacion_editable.ejs", import.meta.url), "utf8");
  const router = fs.readFileSync(new URL("../src/modules/facturacion/facturacion.router.js", import.meta.url), "utf8");
  const menu = fs.readFileSync(new URL("../src/public/ui/portal-shell.js", import.meta.url), "utf8");
  const service = fs.readFileSync(new URL("../src/modules/facturacion/services/appsheet.js", import.meta.url), "utf8");

  assert.match(template, /Empresa registrada/);
  assert.match(template, /No registrada/);
  assert.match(template, /Centros de trabajo, uno por linea|Centros de trabajo, uno por línea/);
  assert.match(template, /Conceptos por centro de trabajo/);
  assert.match(template, /Agregar concepto a todos los centros/);
  assert.match(template, /addConceptToAllCenters/);
  assert.match(template, /selectedStates:new Set/);
  assert.match(template, /selectedMunicipalities:new Set/);
  assert.match(template, /Seleccionar todas las resultantes/);
  assert.match(template, /clearVisibleCenters/);
  assert.match(template, /id="withoutMunicipalOrder"[\s\S]*Sin pedido municipal/);
  assert.match(template, /id="withoutStateOrder"[\s\S]*Sin pedido estatal/);
  assert.match(template, /withoutMunicipalOrder\.checked\|\|\(x\.requierePedidoMunicipal===true&&x\.tienePedidoMunicipal!==true\)/);
  assert.match(template, /withoutStateOrder\.checked\|\|\(x\.requierePedidoEstatal===true&&x\.tienePedidoEstatal!==true\)/);
  assert.match(template, /x\.activa!==false/);
  assert.doesNotMatch(template, /estados:\[\.\.\.state\.selectedStates\]/);
  assert.doesNotMatch(template, /municipios:\[\.\.\.state\.selectedMunicipalities\]/);
  assert.match(template, /selectedConcepts:new Map/);
  assert.match(template, /conceptos:\[\.\.\.state\.selectedConcepts\.values\(\)\]/);
  assert.match(template, /Según sucursal/);
  assert.match(template, /body\.portal-shell a\.quote-button--dark[^\{]*\{[^}]*color:#fff/);
  assert.match(template, /quote-card-action--view/);
  assert.match(template, />Ver cotización<\/a>/);
  assert.match(template, /data-edit-quote/);
  assert.match(template, /showSavedQuote\(p\.data\)/);
  assert.doesNotMatch(template, /<button class="quote-card"/);
  assert.match(template, /quote-form-actions/);
  assert.match(template, /\/cotizaciones\/api\/workspace/);
  assert.match(router, /post\("\/api\/cotizaciones"/);
  assert.match(router, /put\("\/api\/cotizaciones\/:id"/);
  assert.match(service, /conceptosGestionadosPor: "plataforma"/);
  assert.match(service, /MUNICIPIOS: "",[\s\S]*CENTROS_DE_TRABAJO: "",[\s\S]*CONCEPTOS: ""/);
  assert.match(service, /"Edit", \[\{ "Row ID": id, MUNICIPIOS: quoteRow\.MUNICIPIOS \}\]/);
  assert.match(service, /"Edit", \[\{ "Row ID": id, CENTROS_DE_TRABAJO: quoteRow\.CENTROS_DE_TRABAJO \}\]/);
  assert.doesNotMatch(service, /centrosTrabajo: \[firstCenterId\]/);
  assert.match(service, /cachedBranchPrices/);
  assert.match(service, /notifyLocalReplicas/);
  assert.match(service, /writeAppSheetRowsPartitioned/);
  assert.doesNotMatch(service, /waitForGeneratedConcepts/);
  assert.doesNotMatch(template, /await loadWorkspace\(\);await loadQuote/);
  assert.doesNotMatch(template, /await loadQuote\(p\.data\.id\)/);
  assert.doesNotMatch(menu, /label: "Facturacion"/);
});
