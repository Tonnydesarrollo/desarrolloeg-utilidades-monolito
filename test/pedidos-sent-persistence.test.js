import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("marcar un pedido enviado persiste el estado sin borrar el resto de la fila", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desarrolloeg-pedido-enviado-"));
  const dbPath = path.join(directory, "pedidos.sqlite");
  const previousPath = process.env.DESARROLLOEG_LOCAL_DB_PATH;
  process.env.DESARROLLOEG_LOCAL_DB_PATH = dbPath;

  const legacyDb = new DatabaseSync(dbPath);
  legacyDb.exec(`
    CREATE TABLE pedidos_ley (
      pedido TEXT PRIMARY KEY,
      tienda TEXT,
      establecimiento TEXT,
      importe REAL,
      enviado TEXT,
      sync_appsheet_estado TEXT NOT NULL DEFAULT 'PENDIENTE',
      sync_appsheet_fecha TEXT,
      sync_origen_ultimo TEXT NOT NULL DEFAULT 'APPSHEET'
    )
  `);
  legacyDb.close();

  const service = await import("../src/modules/jobs/services/localAppsheetDb.js");

  try {
    service.upsertPedidoLeyLocalRow({
      PEDIDO: "6001343897",
      TIENDA: "85",
      ESTABLECIMIENTO: "1333",
      IMPORTE: 32967.49,
      ENVIADO: "",
    });

    assert.equal(service.markPedidoLeySentLocal("6001343897", true), 1);
    const pending = service.getPedidosLeyLocalRows()[0];
    assert.equal(pending.enviado, "SI");
    assert.equal(pending.establecimiento, "1333");
    assert.equal(pending.importe, 32967.49);
    assert.equal(pending.sync_appsheet_estado, "PENDIENTE");
    assert.equal(pending.sync_appsheet_operacion, "EDIT");

    assert.equal(service.markPedidoLeySentLocal("6001343897", true, {
      syncState: "SINCRONIZADO",
      syncAt: "2026-08-28T18:18:48.463Z",
    }), 1);
    const synchronized = service.getPedidosLeyLocalRows()[0];
    assert.equal(synchronized.enviado, "SI");
    assert.equal(synchronized.sync_appsheet_estado, "SINCRONIZADO");
    assert.equal(synchronized.sync_appsheet_operacion, null);
  } finally {
    service.closeLocalAppsheetDb();
    if (previousPath === undefined) delete process.env.DESARROLLOEG_LOCAL_DB_PATH;
    else process.env.DESARROLLOEG_LOCAL_DB_PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
