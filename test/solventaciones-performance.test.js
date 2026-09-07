import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { mapWithConcurrency } from "../src/modules/solventaciones/solventaciones.service.js";

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

  assert.match(router, /let pdfBrowserPromise = null/);
  assert.match(router, /waitUntil: "load"/);
  assert.doesNotMatch(router, /waitUntil: "networkidle0"/);
  assert.match(router, /Server-Timing/);
  assert.match(service, /refreshCachesForDatabaseRevision/);
  assert.match(service, /REPORT_CACHE\.clear\(\)/);
  assert.match(service, /PCSINALOA_READ_CACHE\.clear\(\)/);
  assert.doesNotMatch(template, /portal-shell\.css/);
  assert.doesNotMatch(template, /portal-shell\.js/);
  assert.match(template, /pdfPreviewUnavailable/);
  assert.match(htmlTemplate, /loading="lazy" decoding="async" fetchpriority="low"/);
});
