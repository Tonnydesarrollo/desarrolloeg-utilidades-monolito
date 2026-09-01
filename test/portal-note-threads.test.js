import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("las notas del portal se guardan como entradas de hilo con autor y menciones", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desarrolloeg-note-thread-"));
  const databasePath = path.join(directory, "desarrolloeg.sqlite");
  const previousPath = process.env.DESARROLLOEG_SYNC_DB_PATH;
  process.env.DESARROLLOEG_SYNC_DB_PATH = databasePath;
  new DatabaseSync(databasePath).close();
  const service = await import(`../src/services/desarrolloegLocalDb.js?thread=${Date.now()}`);

  try {
    const note = service.createPortalNoteEntry({
      entityType: "capacitacion",
      entityId: "cap-1",
      body: "Primera observacion",
      author: { rowId: "emp-1", nombre: "Persona Autora", correo: "AUTOR@EXAMPLE.COM" },
      mentions: ["emp-2"],
    });

    assert.equal(note.entityType, "capacitacion");
    assert.equal(note.entityId, "cap-1");
    assert.equal(note.authorName, "Persona Autora");
    assert.equal(note.authorEmail, "autor@example.com");
    assert.deepEqual(note.mentions, ["emp-2"]);

    service.updatePortalNoteEntry(note.id, "Observacion corregida");
    assert.equal(service.listPortalNoteEntries({ entityType: "capacitacion", entityIds: ["cap-1"] })[0].body, "Observacion corregida");

    service.deletePortalNoteEntry(note.id);
    assert.deepEqual(service.listPortalNoteEntries({ entityType: "capacitacion", entityIds: ["cap-1"] }), []);
  } finally {
    service.closeDesarrolloegSyncDb();
    if (previousPath === undefined) delete process.env.DESARROLLOEG_SYNC_DB_PATH;
    else process.env.DESARROLLOEG_SYNC_DB_PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
