import test from "node:test";
import assert from "node:assert/strict";

import {
  isBulkPendingAttendanceRequest,
  isNaturalDriveRequest,
  isPendingConstanciasRequest,
  isSucursalInformationRequest,
  scoreSucursalCandidate,
  isWhatsAppAuthenticationStalled,
} from "../src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js";

test("detecta la consulta natural de constancias pendientes", () => {
  assert.equal(isPendingConstanciasRequest("Dame la lista de constancias pendientes de Gilberto"), true);
  assert.equal(isPendingConstanciasRequest("Cuales son mis diplomas faltantes?"), true);
  assert.equal(isPendingConstanciasRequest("Siguientes capacitaciones"), false);
});

test("detecta la solicitud compuesta de listas pendientes por capacitador", () => {
  assert.equal(
    isBulkPendingAttendanceRequest("DAME TODAS LAS LISTAS DE ASISTENCIA DE TODAS LAS SUCURSALES QUE ESTAN PEDNIENTES DE CONSTANCIA Y QUE FUERON CAPACITADAS POR GILBERTO"),
    true
  );
});

test("detecta solicitudes de documentos de sucursal", () => {
  assert.equal(isNaturalDriveRequest("Dame los documentos de la sucursal Las Torres"), true);
  assert.equal(isNaturalDriveRequest("Busca archivos de la tienda 1197"), true);
  assert.equal(isNaturalDriveRequest("Dame la lista de asistencia de la 1366"), true);
  assert.equal(isNaturalDriveRequest("Necesito la DC3 de la sucursal 1240"), true);
  assert.equal(isNaturalDriveRequest("Dame el link de drive de la tienda 1366"), true);
  assert.equal(isNaturalDriveRequest("Dame las capacitaciones"), false);
});

test("detecta solicitudes de informacion general de sucursal sin confundir documentos", () => {
  assert.equal(isSucursalInformationRequest("Quiero informacion de la tienda 1366"), true);
  assert.equal(isSucursalInformationRequest("Dame los datos de la sucursal Mendoza"), true);
  assert.equal(isSucursalInformationRequest("Dame el link de Drive de la tienda 1366"), false);
});

test("prioriza un numero de tienda incluido en una frase completa", () => {
  const score = scoreSucursalCandidate("Dame informacion sobre la tienda 1002", {
    tienda: "1002",
    key: "1",
    searchText: "casa ley ley 1002 rubi",
    tokens: ["casa", "ley", "1002", "rubi"],
  });
  assert.equal(score, 1);
});

test("detecta autenticacion atascada sin reiniciar sesiones listas", () => {
  const now = 1_000_000;
  assert.equal(isWhatsAppAuthenticationStalled("authenticated", now - 119_999, now), false);
  assert.equal(isWhatsAppAuthenticationStalled("authenticated", now - 120_000, now), true);
  assert.equal(isWhatsAppAuthenticationStalled("ready", now - 200_000, now), false);
  assert.equal(isWhatsAppAuthenticationStalled("awaiting_qr", now - 200_000, now), false);
});
