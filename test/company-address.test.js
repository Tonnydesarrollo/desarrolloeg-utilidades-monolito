import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DEFAULT_COMPANY_ADDRESS, getCompanyAddress } from "../src/config/company.js";

test("centraliza la direccion corporativa y permite reemplazarla por entorno", () => {
  assert.equal(
    DEFAULT_COMPANY_ADDRESS,
    "Río Tehuantepec 1704-1, Morelos, Los Pinos, 80170 Culiacán Rosales, Sin.",
  );

  const previous = process.env.COMPANY_ADDRESS;
  process.env.COMPANY_ADDRESS = "Dirección configurada";
  assert.equal(getCompanyAddress(), "Dirección configurada");
  if (previous === undefined) delete process.env.COMPANY_ADDRESS;
  else process.env.COMPANY_ADDRESS = previous;
});

test("los modulos documentales no conservan direcciones corporativas anteriores", () => {
  const files = [
    "../src/modules/facturacion/views/cotizacion.ejs",
    "../src/modules/facturacion/views/cotizacion_ley.ejs",
    "../src/modules/solventaciones/solventaciones.service.js",
    "../src/modules/solventaciones/views/solventaciones_pdf.ejs",
    "../src/modules/reportes-inspecciones/reportesInspecciones.service.js",
    "../src/modules/sucursales-docs/sucursalesDocs.service.js",
    "../standalone/sucursales-docs/generate.js",
  ];
  const sources = files.map((file) => fs.readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");

  assert.doesNotMatch(sources, /Tehuantepec\s+1397/i);
  assert.doesNotMatch(sources, /Tehuantepec\s+1704/i);
  assert.match(sources, /getCompanyAddress|companyAddress/);
});
