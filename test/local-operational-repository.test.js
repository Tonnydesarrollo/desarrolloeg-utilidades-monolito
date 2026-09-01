import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("normaliza sucursales y calcula razon social y label desde SQLite", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desarrolloeg-local-repo-"));
  const dbPath = path.join(dir, "test.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE empresas (id TEXT PRIMARY KEY, row_id TEXT, razon_social TEXT, nombre_comercial TEXT, logo TEXT, logo_url TEXT);
    CREATE TABLE municipios (id TEXT PRIMARY KEY, nombre TEXT, escudo TEXT);
    CREATE TABLE estados (id TEXT PRIMARY KEY, nombre TEXT, escudo TEXT);
    CREATE TABLE sucursales (
      id TEXT PRIMARY KEY, row_id TEXT, tienda TEXT, nombre TEXT, empresa_id TEXT,
      municipio_id TEXT, estado_id TEXT, direccion TEXT, lat REAL, lng REAL, drive TEXT,
      mes_planeacion INTEGER, capacitadores TEXT
    );
    CREATE TABLE empleados (row_id TEXT PRIMARY KEY, id TEXT, nombre TEXT, iniciales TEXT, color TEXT, puesto TEXT, correo TEXT, capacita TEXT, permiso TEXT, firma TEXT, cumpleanos TEXT, telefono TEXT, telefono_2 TEXT);
    CREATE TABLE capacitaciones (id TEXT PRIMARY KEY, row_id TEXT, fecha_capacitacion TEXT, hora_inicio TEXT, hora_fin TEXT, cede_sucursal_id TEXT, sucursales TEXT, capacitadores TEXT, status TEXT, diplomas TEXT, notas TEXT, sync_appsheet_fecha TEXT);
    CREATE TABLE capacitacion_sucursales (capacitacion_id TEXT, sucursal_id TEXT, orden INTEGER);
    CREATE TABLE capacitacion_capacitadores (capacitacion_id TEXT, empleado_id TEXT, orden INTEGER);
    CREATE TABLE catalogo (id TEXT PRIMARY KEY, row_id TEXT, codigo TEXT, nombre TEXT, precio_sugerido REAL, tipo TEXT, iva REAL, descripcion TEXT);
    CREATE TABLE proveedores (id TEXT PRIMARY KEY, row_id TEXT, nombre TEXT, banco TEXT, cuenta_bancaria TEXT, clabe TEXT, pie_de_firma TEXT, puesto TEXT, firma TEXT);
    CREATE TABLE cotizaciones (id TEXT PRIMARY KEY, row_id TEXT, empresa_id TEXT, fecha TEXT, proveedor_id TEXT, titulo TEXT);
    CREATE TABLE cotizacion_centros_trabajo (cotizacion_id TEXT, sucursal_id TEXT, orden INTEGER);
    CREATE TABLE conceptos_cotizacion (id TEXT PRIMARY KEY, row_id TEXT, cotizacion_id TEXT, centro_trabajo_id TEXT, concepto_id TEXT, cantidad REAL, precio REAL, iva REAL);
    CREATE TABLE operational_rows (source TEXT, table_name TEXT, row_id TEXT, data_json TEXT, content_hash TEXT, updated_at TEXT, PRIMARY KEY (source, table_name, row_id));
    INSERT INTO empresas VALUES ('1', '1', 'CASA LEY S.A.P.I. DE C.V.', 'CASA LEY', '', '');
    INSERT INTO municipios VALUES ('10', 'Culiacan', '');
    INSERT INTO estados VALUES ('25', 'Sinaloa', '');
    INSERT INTO sucursales VALUES ('98', '98', '1362', 'LA CONQUISTA', '1', '10', '25', '', 24.8, -107.4, '', 4, 'EMP-1');
    INSERT INTO cotizaciones VALUES ('COT-1', 'COT-1', '1', '2026-08-31', 'PROV-1', 'Cotizacion de prueba');
    INSERT INTO cotizacion_centros_trabajo VALUES ('COT-1', '98', 1);
    INSERT INTO conceptos_cotizacion VALUES ('CON-1', 'CON-1', 'COT-1', '98', 'CAT-1', 2, 100, 0.16);
  `);
  db.close();

  process.env.DESARROLLOEG_SYNC_DB_PATH = dbPath;
  const repository = await import(`../src/services/localOperationalRepository.js?test=${Date.now()}`);
  const row = repository.readLocalOperationalTable("SUCURSALES")[0];

  assert.equal(row.EMPRESA, "1");
  assert.equal(row["RAZON SOCIAL"], "CASA LEY S.A.P.I. DE C.V.");
  assert.equal(row.LABEL, "1362 LA CONQUISTA");
  assert.equal(row.MUNICIPIO_NOMBRE, "Culiacan");
  assert.equal(row.ESTADO_NOMBRE, "Sinaloa");
  assert.equal(row.DOMICILIO, row.DIRECCION);
  assert.equal(row["MES PLANEACION"], 4);

  const cotizacion = repository.readLocalOperationalTable("COTIZACIONES_VARIOS_CT", { source: "finance" })[0];
  assert.equal(cotizacion.CENTRO_DE_TRABAJO, "98");
  assert.equal(cotizacion.CENTROS_DE_TRABAJO, "98");
  const concepto = repository.readLocalOperationalTable("CONCEPTOS_VARIOS_CT", { source: "finance" })[0];
  assert.equal(concepto.SUBTOTAL, 200);
  assert.equal(concepto["TOTAL IVA"], 32);
  assert.equal(concepto.TOTAL, 232);

  const localDb = await import("../src/services/desarrolloegLocalDb.js");
  localDb.closeDesarrolloegSyncDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("lee tablas operativas sin columnas virtuales", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desarrolloeg-mirror-"));
  const dbPath = path.join(dir, "test.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE operational_rows (source TEXT, table_name TEXT, row_id TEXT, data_json TEXT, content_hash TEXT, updated_at TEXT, PRIMARY KEY (source, table_name, row_id));
    INSERT INTO operational_rows VALUES ('desarrolloeg', 'INSPECCIONES', 'R1', '{"FECHA":"2026-08-25","SUCURSAL":"98","NOTA":"OK"}', 'hash', '2026-08-25T00:00:00Z');
  `);
  db.close();

  process.env.DESARROLLOEG_SYNC_DB_PATH = dbPath;
  const dbModule = await import("../src/services/desarrolloegLocalDb.js");
  const rows = dbModule.readLocalRows(
    "SELECT row_id, data_json FROM operational_rows WHERE source = ? AND table_name = ?",
    ["desarrolloeg", "INSPECCIONES"],
  );
  const parsed = JSON.parse(rows[0].data_json);

  assert.deepEqual(Object.keys(parsed).sort(), ["FECHA", "NOTA", "SUCURSAL"]);
  assert.equal(parsed.LABEL, undefined);

  dbModule.closeDesarrolloegSyncDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
