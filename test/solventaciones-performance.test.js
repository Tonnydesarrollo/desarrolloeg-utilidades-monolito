import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  mapWithConcurrency,
  normalizeSistemaPcStage,
  obtenerSistemaPcResumen,
} from "../src/modules/solventaciones/solventaciones.service.js";

test("normaliza el flujo de Sistema PC en seis etapas de negocio", () => {
  assert.equal(normalizeSistemaPcStage("Creado").key, "creada");
  assert.equal(normalizeSistemaPcStage("En captura").key, "captura");
  assert.equal(normalizeSistemaPcStage("Revision campo").key, "revision");
  assert.equal(normalizeSistemaPcStage("VISITADA").key, "visitada");
  assert.deepEqual(normalizeSistemaPcStage("RECHAZADA"), {
    key: "visitada",
    label: "Visitada",
    detail: "Rechazada",
  });
  assert.equal(normalizeSistemaPcStage("Autorizada").key, "autorizada");
  assert.equal(normalizeSistemaPcStage("Firmada").key, "firmada");
});

test("el resumen general se obtiene desde SQLite sin cargar incidencias", async () => {
  const startedAt = performance.now();
  const data = await obtenerSistemaPcResumen({ section: "proceso", year: "2026" });
  assert.equal(data.source, "sqlite-local");
  assert.equal(data.selectedYear, 2026);
  assert.equal(data.stages.length, 6);
  assert.ok(Array.isArray(data.groups));
  assert.ok(performance.now() - startedAt < 2000);
});

test("historico abre el ano anterior y las firmadas exponen su opinion favorable", async () => {
  const data = await obtenerSistemaPcResumen({ section: "historico" });
  assert.equal(data.selectedYear, data.currentYear - 1);
  const signed = data.groups.flatMap((group) => group.items).filter((item) => item.stageKey === "firmada");
  assert.ok(signed.length > 0);
  assert.ok(signed.some((item) => /^https:\/\/pcsinaloa\.gob\.mx\//.test(item.opinionFavorableUrl)));
});

test("listos para crear cruza trabajo estatal e ID_PC sin mezclar expedientes", async () => {
  const data = await obtenerSistemaPcResumen({ section: "listos", year: "2026" });
  assert.equal(data.section, "listos");
  assert.deepEqual(data.stages, [{ key: "lista", label: "Lista para crear" }]);
  assert.ok(data.groups.flatMap((group) => group.items).every((item) => (
    item.readyToCreate === true
    && item.sistemaPcSucursalId
    && ["EN DRIVE", "IMPRESO", "ENTREGADO"].includes(item.estatus)
  )));
});

test("procesa evidencias con concurrencia acotada y conserva el orden", async () => {
  let active = 0;
  let maxActive = 0;
  const values = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(values, [10, 20, 30, 40, 50]);
  assert.equal(maxActive, 2);
});

test("el PDF no espera red inactiva y reutiliza Chromium", () => {
  const service = fs.readFileSync(
    new URL("../src/modules/solventaciones/solventaciones.service.js", import.meta.url),
    "utf8",
  );
  const router = fs.readFileSync(
    new URL("../src/modules/solventaciones/solventaciones.router.js", import.meta.url),
    "utf8",
  );
  const template = fs.readFileSync(
    new URL("../src/modules/solventaciones/views/solventaciones_pdf.ejs", import.meta.url),
    "utf8",
  );
  const htmlTemplate = fs.readFileSync(
    new URL("../src/modules/solventaciones/views/solventaciones.ejs", import.meta.url),
    "utf8",
  );
  const systemTemplate = fs.readFileSync(
    new URL("../src/modules/solventaciones/views/solventaciones_system.ejs", import.meta.url),
    "utf8",
  );

  assert.match(router, /let pdfBrowserPromise = null/);
  assert.match(router, /waitUntil: "load"/);
  assert.doesNotMatch(router, /waitUntil: "networkidle0"/);
  assert.match(router, /Server-Timing/);
  assert.match(service, /refreshCachesForDatabaseRevision/);
  assert.match(service, /REPORT_CACHE\.clear\(\)/);
  assert.match(service, /PCSINALOA_READ_CACHE\.clear\(\)/);
  assert.match(service, /width: 340, height: 255, quality: 34/);
  assert.match(service, /solicitudIds/);
  assert.match(router, /\/api\/overview/);
  assert.match(router, /res\.render\("solventaciones_system"/);
  assert.match(router, /res\.render\("solventaciones"/);
  assert.doesNotMatch(template, /portal-shell\.css/);
  assert.doesNotMatch(template, /portal-shell\.js/);
  assert.match(template, /pdfPreviewUnavailable/);
  assert.match(htmlTemplate, /loading="lazy" decoding="async" fetchpriority="low"/);
  assert.match(systemTemplate, /data-section="proceso"/);
  assert.match(systemTemplate, /data-section="historico"/);
  assert.match(systemTemplate, /data-section="pendientes"/);
  assert.match(systemTemplate, /data-section="listos"/);
  assert.match(systemTemplate, /opinionFavorableUrl/);
  assert.match(systemTemplate, /currentYear - 1/);
  assert.match(systemTemplate, /fetch\(`\/solventaciones\/api\/overview/);
  assert.match(systemTemplate, /selected: new Set\(\)/);
  assert.match(systemTemplate, /<details class="pc-company">/);
  assert.doesNotMatch(systemTemplate, /<details class="pc-company" open/);
  assert.doesNotMatch(htmlTemplate, /Saltar al contenido principal/);
  assert.doesNotMatch(template, /Saltar al contenido principal/);
});
