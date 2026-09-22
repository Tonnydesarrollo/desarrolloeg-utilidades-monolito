import test from "node:test";
import assert from "node:assert/strict";
import { addOneYear, extractDocumentDates, isStructuralReportFilename, nextUniqueTimestamp, parseDocumentDate, resolveBranch } from "../src/modules/jobs/native/dictamenes/syncDictamenes.js";

test("reconoce nombres de dictamen estructural", () => {
  assert.equal(isStructuralReportFilename("DICTAMEN ESTR_LEY CARRANZA_15.May.2026.pdf"), true);
  assert.equal(isStructuralReportFilename("dictamen estructural sucursal.pdf"), true);
  assert.equal(isStructuralReportFilename("plano estructural.pdf"), false);
});

test("calcula vencimiento un ano despues de la fecha del nombre", () => {
  const dates = extractDocumentDates("", "DICTAMEN ESTR_LEY CARRANZA_15.May.2026.pdf");
  assert.equal(dates.issuanceDate.toISOString().slice(0, 10), "2026-05-15");
  assert.equal(dates.expirationDate.toISOString().slice(0, 10), "2027-05-15");
  assert.equal(addOneYear(parseDocumentDate("29/02/2028")).toISOString().slice(0, 10), "2029-02-28");
});

test("usa el fin de vigencia contenido en el PDF", () => {
  const dates = extractDocumentDates("VIGENCIA DEL DICTAMEN Del 15 de mayo de 2026 al 15 de mayo de 2027");
  assert.equal(dates.expirationDate.toISOString().slice(0, 10), "2027-05-15");
});

test("relaciona LEY CARRANZA con la tienda 1374", () => {
  const branch = resolveBranch("DICTAMEN ESTR_LEY CARRANZA_15.May.2026.pdf", "", [
    { TIENDA: "1312", NOMBRE: "SUPER LEY EXPRESS ANGOSTURA" },
    { TIENDA: "1374", NOMBRE: "LEY CARRANZA" },
  ]);
  assert.equal(branch.TIENDA, "1374");
});

test("ignora numeros tecnicos sin etiqueta de sucursal", () => {
  const branch = resolveBranch("DICTAMEN ESTR_LEY SALVADOR ALVARADO_20.Abr.2026.pdf", "Cedula profesional 1363", [
    { TIENDA: "1363", NOMBRE: "ALMADA NAVOLATO" },
    { TIENDA: "1364", NOMBRE: "SALVADOR ALVARADO" },
  ]);
  assert.equal(branch.TIENDA, "1364");
});

test("no confunde el numero del domicilio con la tienda corporativa", () => {
  const branch = resolveBranch("DICTAMEN ESTR_LEY CORPORATIVO_25.May.2026.pdf", "EDIFICIO CORPORATIVO CASA LEY, Calzada Jose Limon, No. 2031", [
    { TIENDA: "2031", NOMBRE: "OTRA SUCURSAL" },
    { TIENDA: "5901", NOMBRE: "CORPORATIVO LEY" },
  ]);
  assert.equal(branch.TIENDA, "5901");
});

test("resuelve la abreviatura Mayoreo CLN", () => {
  const branch = resolveBranch("DICTAMEN ESTR_LEY MAYOREO CLN_11.May.2026.pdf", "LEY MAYOREO CULIACAN", [
    { TIENDA: "2009", NOMBRE: "MAYOREO LEY" },
    { TIENDA: "2038", NOMBRE: "MAYOREO HERMOSILLO" },
  ]);
  assert.equal(branch.TIENDA, "2009");
});

test("la marca temporal conserva segundos y no se repite", () => {
  const value = nextUniqueTimestamp("22/09/2026 10:00:00", new Date("2026-09-22T10:00:00Z"), "UTC");
  assert.equal(value, "22/09/2026 10:00:01");
});
