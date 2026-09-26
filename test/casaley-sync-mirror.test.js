import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const TABLES = ["cheques_ley", "pagados_ley", "facturas_en_ley"];

test("fusiona la replica historica con filas nuevas sin perder pagos anteriores", async () => {
  const { mergeCasaLeyRowsWithReplica } = await import("../src/modules/jobs/native/casaley/syncCasaleyNative.js");
  const replicaRows = {
    anterior: { row: { Referencia: "anterior", Uuid: "uuid-anterior" } },
    reemplazado: { row: { Referencia: "reemplazado", Uuid: "uuid-viejo" } },
  };
  const merged = mergeCasaLeyRowsWithReplica([
    { Referencia: "reemplazado", Uuid: "uuid-nuevo" },
    { Referencia: "actual", Uuid: "uuid-actual" },
  ], replicaRows, "Referencia");

  assert.deepEqual(merged, [
    { Referencia: "anterior", Uuid: "uuid-anterior" },
    { Referencia: "reemplazado", Uuid: "uuid-nuevo" },
    { Referencia: "actual", Uuid: "uuid-actual" },
  ]);
});

test("limita Casa Ley a pagos, relacionados y facturas del ultimo mes", async () => {
  process.env.CASALEY_USER ||= "test-user";
  process.env.CASALEY_PASSWORD ||= "test-password";
  const { filterCasaLeyRowsToRecentWindow } = await import("../src/modules/jobs/native/casaley/syncCasaleyNative.js");
  const result = filterCasaLeyRowsToRecentWindow({
    pagos: [
      { "Referencia de pago": "REC-1", "Fecha pago": "20/09/2026" },
      { "Referencia de pago": "OLD-1", "Fecha pago": "01/07/2026" },
    ],
    relacionados: [
      { Referencia: "A", "Referencia de pago": "REC-1" },
      { Referencia: "B", "Referencia de pago": "OLD-1" },
    ],
    facturas: [
      { "Folio Uuid": "F-1", "Fecha factura": "15/09/2026" },
      { "Folio Uuid": "F-2", "Fecha factura": "15/07/2026" },
    ],
  }, { now: new Date(2026, 8, 26), windowDays: 31 });

  assert.deepEqual(result.pagos.map((row) => row["Referencia de pago"]), ["REC-1"]);
  assert.deepEqual(result.relacionados.map((row) => row.Referencia), ["A"]);
  assert.deepEqual(result.facturas.map((row) => row["Folio Uuid"]), ["F-1"]);
});

test("replica las tablas Casa Ley hacia la base persistente compartida", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desarrolloeg-casaley-mirror-"));
  const sourcePath = path.join(directory, "source.sqlite");
  const targetPath = path.join(directory, "target.sqlite");
  const previousLocalPath = process.env.DESARROLLOEG_LOCAL_DB_PATH;
  process.env.DESARROLLOEG_LOCAL_DB_PATH = sourcePath;

  const source = new DatabaseSync(sourcePath);
  const target = new DatabaseSync(targetPath);
  for (const table of TABLES) {
    source.exec(`CREATE TABLE ${table} (clave TEXT PRIMARY KEY, valor TEXT, sync_appsheet_estado TEXT)`);
    target.exec(`CREATE TABLE ${table} (clave TEXT PRIMARY KEY, valor TEXT)`);
    source.prepare(`INSERT INTO ${table} (clave, valor, sync_appsheet_estado) VALUES (?, ?, ?)`)
      .run(`${table}-1`, `dato-${table}`, "SINCRONIZADO");
    target.prepare(`INSERT INTO ${table} (clave, valor) VALUES (?, ?)`)
      .run("viejo", "obsoleto");
  }
  source.close();
  target.close();

  const service = await import(`../src/modules/jobs/services/localAppsheetDb.js?mirror=${Date.now()}`);
  try {
    const result = service.mirrorCasaLeyTablesToSyncDb({ targetPath });
    assert.equal(result.mirrored, true);
    assert.deepEqual(result.tables, {
      cheques_ley: 1,
      pagados_ley: 1,
      facturas_en_ley: 1,
    });

    const replica = new DatabaseSync(targetPath, { readOnly: true });
    for (const table of TABLES) {
      const rows = replica.prepare(`SELECT * FROM ${table}`).all();
      assert.deepEqual(rows.map((row) => ({ ...row })), [{ clave: `${table}-1`, valor: `dato-${table}` }]);
    }
    replica.close();
  } finally {
    service.closeLocalAppsheetDb();
    if (previousLocalPath === undefined) delete process.env.DESARROLLOEG_LOCAL_DB_PATH;
    else process.env.DESARROLLOEG_LOCAL_DB_PATH = previousLocalPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reemplaza relacionados de Casa Ley usando los nombres reales de sus columnas", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desarrolloeg-casaley-replace-"));
  const sourcePath = path.join(directory, "source.sqlite");
  const previousLocalPath = process.env.DESARROLLOEG_LOCAL_DB_PATH;
  process.env.DESARROLLOEG_LOCAL_DB_PATH = sourcePath;
  const service = await import(`../src/modules/jobs/services/localAppsheetDb.js?replace=${Date.now()}`);
  try {
    service.replaceCasaLeyLocalRows({
      relacionadosRows: [{
        "referencia_pago": "R100120262060543990",
        "Referencia": "R100120265115527860",
        "ClaseDocto": "RE",
        "Uuid": "aba688a1-2feb-4a6e-9820-5f5d1ed6efe4",
        "ImpPagado": "13688.00",
        "Tipodocto": "I",
        "Factura": "000000000535",
        "Asignacion": "5018440899",
        "Tienda": "1174",
      }],
    });
    const rows = service.getPagadosLeyLocalRows();
    assert.equal(rows.length, 1);
    assert.deepEqual({ ...rows[0] }, {
      referencia: "R100120265115527860",
      referencia_pago: "R100120262060543990",
      clase_docto: "RE",
      uuid: "aba688a1-2feb-4a6e-9820-5f5d1ed6efe4",
      imp_pagado: 13688,
      tipo_docto: "I",
      factura: "000000000535",
      asignacion: "5018440899",
      tienda: "1174",
      sync_appsheet_estado: "PENDIENTE",
      sync_appsheet_fecha: null,
      sync_appsheet_operacion: null,
      sync_origen_ultimo: "APPSHEET",
    });
  } finally {
    service.closeLocalAppsheetDb();
    if (previousLocalPath === undefined) delete process.env.DESARROLLOEG_LOCAL_DB_PATH;
    else process.env.DESARROLLOEG_LOCAL_DB_PATH = previousLocalPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
