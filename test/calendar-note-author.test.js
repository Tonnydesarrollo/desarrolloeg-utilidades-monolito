import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

test("persiste el creador original de una nota de calendario", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desarrolloeg-calendar-author-"));
  const databasePath = path.join(directory, "desarrolloeg.sqlite");
  const previousPath = process.env.DESARROLLOEG_SYNC_DB_PATH;
  process.env.DESARROLLOEG_SYNC_DB_PATH = databasePath;
  new DatabaseSync(databasePath).close();

  const service = await import(`../src/services/desarrolloegLocalDb.js?test=${Date.now()}`);
  try {
    service.upsertCalendarNoteAuthor("nota-1", {
      rowId: "empleado-1",
      nombre: "Autora Original",
      correo: "AUTORA@EXAMPLE.COM",
    }, { isNew: true });
    service.upsertCalendarNoteAuthor("nota-1", {
      rowId: "empleado-2",
      nombre: "Persona Editora",
      correo: "editor@example.com",
    });

    const db = new DatabaseSync(databasePath, { readOnly: true });
    const row = db.prepare("SELECT * FROM calendario_autores WHERE calendario_id = ?").get("nota-1");
    db.close();

    assert.equal(row.creado_por_nombre, "Autora Original");
    assert.equal(row.creado_por_correo, "autora@example.com");
    assert.equal(row.actualizado_por_nombre, "Persona Editora");
  } finally {
    service.closeDesarrolloegSyncDb();
    if (previousPath === undefined) delete process.env.DESARROLLOEG_SYNC_DB_PATH;
    else process.env.DESARROLLOEG_SYNC_DB_PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("la vista de notas usa el titulo de calendario cuando NOTAS esta vacio", () => {
  const source = fs.readFileSync(new URL("../src/modules/home/home.router.js", import.meta.url), "utf8");
  assert.match(source, /body:\s*note\.notes\s*\|\|\s*note\.title\s*\|\|\s*note\.noteTitle/);
  assert.match(source, /author:\s*note\.author\s*\|\|\s*note\.authorName\s*\|\|\s*note\.authorEmail/);
  assert.match(source, /<strong>Creada por<\/strong>/);
  assert.match(source, /<strong>Empleados etiquetados<\/strong>/);
});

test("el calendario usa iniciales personales y estatus calculado en su etiqueta", () => {
  const serviceSource = fs.readFileSync(new URL("../src/modules/home/portalAuth.service.js", import.meta.url), "utf8");
  const routerSource = fs.readFileSync(new URL("../src/modules/home/home.router.js", import.meta.url), "utf8");
  assert.match(serviceSource, /firstSurname\s*=\s*parts\.length\s*>=\s*3\s*\?\s*parts\[parts\.length\s*-\s*2\]/);
  assert.match(serviceSource, /toLocalDateKey\(new Date\(\)\)\s*>\s*toLocalDateKey\(date\)\s*\?\s*"FINALIZADA"\s*:\s*"PROGRAMADA"/);
  assert.match(routerSource, /title:\s*capacitacion\.statusLabel\s*\|\|\s*"Sin estado"/);
});
