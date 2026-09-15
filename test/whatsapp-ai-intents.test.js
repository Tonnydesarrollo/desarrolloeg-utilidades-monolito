import test from "node:test";
import assert from "node:assert/strict";

import {
  isNaturalDriveRequest,
  isPendingConstanciasRequest,
} from "../src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js";

test("detecta la consulta natural de constancias pendientes", () => {
  assert.equal(isPendingConstanciasRequest("Dame la lista de constancias pendientes de Gilberto"), true);
  assert.equal(isPendingConstanciasRequest("Cuales son mis diplomas faltantes?"), true);
  assert.equal(isPendingConstanciasRequest("Siguientes capacitaciones"), false);
});

test("detecta solicitudes de documentos de sucursal", () => {
  assert.equal(isNaturalDriveRequest("Dame los documentos de la sucursal Las Torres"), true);
  assert.equal(isNaturalDriveRequest("Busca archivos de la tienda 1197"), true);
  assert.equal(isNaturalDriveRequest("Dame la lista de asistencia de la 1366"), true);
  assert.equal(isNaturalDriveRequest("Necesito la DC3 de la sucursal 1240"), true);
  assert.equal(isNaturalDriveRequest("Dame las capacitaciones"), false);
});
