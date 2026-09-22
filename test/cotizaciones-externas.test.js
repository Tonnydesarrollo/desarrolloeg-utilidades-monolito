import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  externalCentersMap,
  getExternalConceptRows,
  getExternalQuote,
  listExternalQuotes,
  saveExternalQuote,
} from "../src/modules/facturacion/services/cotizacionesExternas.js";
import { construirDataHTML } from "../src/modules/facturacion/services/construirDataHTML.js";

function memoryDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

test("guarda una cotizacion externa sin referencias de AppSheet", () => {
  const db = memoryDb();
  const result = saveExternalQuote({
    destinatario: "Cliente de mostrador",
    fecha: "2026-09-22",
    proveedorId: "PROV-1",
    centrosTrabajo: ["Obra norte", "Obra sur"],
    conceptos: [{ id: "CON-1", cantidad: 2, precio: 100, iva: 0.16 }],
  }, "", db);

  assert.match(result.id, /^EXT-/);
  assert.equal(result.created, true);
  assert.equal(result.conceptos, 2);
  assert.equal(result.lineas[0].centroTrabajoId, "Obra norte");
  assert.equal(getExternalQuote(result.id, db)["RAZON SOCIAL"], "Cliente de mostrador");
  assert.deepEqual(Object.values(externalCentersMap(result.id, db)).map((item) => item.nombre), ["Obra norte", "Obra sur"]);
  assert.equal(getExternalConceptRows(result.id, db)[0].TOTAL, 232);
  assert.equal(listExternalQuotes(db).length, 1);
  db.close();
});

test("edita cabecera, centros y conceptos externos en una transaccion", () => {
  const db = memoryDb();
  const created = saveExternalQuote({
    destinatario: "Cliente inicial",
    fecha: "2026-09-22",
    proveedorId: "PROV-1",
    centrosTrabajo: ["Sucursal temporal"],
    conceptos: [{ id: "CON-1", cantidad: 1, precio: 50, iva: 0.16 }],
  }, "", db);
  const center = Object.values(externalCentersMap(created.id, db))[0];
  const line = getExternalConceptRows(created.id, db)[0];

  const updated = saveExternalQuote({
    destinatario: "Cliente definitivo",
    fecha: "2026-09-23",
    proveedorId: "PROV-2",
    centrosTrabajo: [center.nombre],
    lineas: [{ id: line["Row ID"], centroTrabajoId: center.id, centroTrabajoNombre: center.nombre,
      conceptoId: "CON-2", cantidad: 3, precio: 80, iva: 8 }],
  }, created.id, db);

  assert.equal(updated.created, false);
  assert.equal(getExternalQuote(created.id, db)["RAZON SOCIAL"], "Cliente definitivo");
  const savedLine = getExternalConceptRows(created.id, db)[0];
  assert.equal(savedLine.CONCEPTO, "CON-2");
  assert.equal(savedLine.IVA, 0.08);
  assert.equal(savedLine.TOTAL, 259.2);
  db.close();
});

test("separa la tasa de IVA de su importe en el documento", () => {
  const data = construirDataHTML({
    empresa: {}, cotizacion: {}, conceptos_por_centro: {
      centro: { centro_nombre: "Centro", conceptos: [{
        concepto_nombre: "Servicio", cantidad: 1, precio: 20000,
        subtotal: 20000, iva: 0.16, ivaImporte: 3200, total: 23200,
      }] },
    },
  });
  assert.equal(data.centros[0].lineas[0].ivaPorcentaje, 16);
  assert.equal(data.centros[0].lineas[0].ivaLinea, 3200);
  assert.equal(data.totales.ivaGlobal, 3200);
  assert.equal(data.totales.totalGlobal, 23200);
});

test("sanea tasas historicas contaminadas con el importe del IVA", () => {
  const db = memoryDb();
  const created = saveExternalQuote({
    destinatario: "Cliente", fecha: "2026-09-22", proveedorId: "PROV-1",
    centrosTrabajo: ["Centro"], conceptos: [{ id: "CON-1", cantidad: 1, precio: 2500, iva: 16 }],
  }, "", db);
  db.prepare("UPDATE conceptos_cotizacion_externa SET iva = 1000000 WHERE cotizacion_id = ?").run(created.id);
  const line = getExternalConceptRows(created.id, db)[0];
  assert.equal(line.IVA, 0.16);
  assert.equal(line["TOTAL IVA"], 400);
  assert.equal(line.TOTAL, 2900);
  db.close();
});
