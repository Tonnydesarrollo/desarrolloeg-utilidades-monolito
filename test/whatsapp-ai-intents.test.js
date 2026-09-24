import test from "node:test";
import assert from "node:assert/strict";

import {
  extractBotPrompt,
  fetchAiResponse,
  isBulkPendingAttendanceRequest,
  isNaturalDriveRequest,
  isPendingConstanciasRequest,
  isSucursalInformationRequest,
  scoreSucursalCandidate,
  isWhatsAppAuthenticationStalled,
  isPendingSistemaPcRequest,
  selectPendingSistemaPcRows,
  isCreatedSistemaPcRequest,
  selectCreatedSistemaPcRows,
  selectSistemaPcRows,
  resolveAiSearchQuery,
  isFabricatedInfrastructureResponse,
  isTrainingStatusRequest,
  selectTrainingRowsByStatus,
} from "../src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js";

test("reintenta cuando el servidor IA esta ocupado", async () => {
  const statuses = [429, 429, 200];
  const delays = [];
  const response = await fetchAiResponse("http://ia.local/v1/respond", {}, {
    fetchImpl: async () => {
      const status = statuses.shift();
      return {
        status,
        headers: { get: () => null },
        json: async () => ({ retryAfterSeconds: 2 }),
      };
    },
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(delays, [2000, 2000]);
});

test("el asistente libre solo se activa con bot al principio", () => {
  assert.equal(extractBotPrompt("bot dame los estatus de proteccion civil"), "dame los estatus de proteccion civil");
  assert.equal(extractBotPrompt(" BOT: dame las capacitaciones"), "dame las capacitaciones");
  assert.equal(extractBotPrompt("bot"), "");
  assert.equal(extractBotPrompt("dile al bot que consulte"), null);
  assert.equal(extractBotPrompt("capacitaciones"), null);
});

test("bloquea explicaciones inventadas sobre puertos en consultas de negocio", () => {
  assert.equal(isFabricatedInfrastructureResponse("Como van los PIPC", "Usa el puerto 3000 del servidor local"), true);
  assert.equal(isFabricatedInfrastructureResponse("Que puerto usa el servidor", "El puerto es 7020"), false);
});

test("recupera el tema de la consulta anterior para preguntas de seguimiento", () => {
  const history = [{ role: "user", content: "Dame informacion de la tienda 1366 de Ley" },
    { role: "assistant", content: "Esta en Culiacan" }];
  assert.equal(resolveAiSearchQuery("Y su tipo?", history), "Dame informacion de la tienda 1366 de Ley Y su tipo?");
  assert.equal(resolveAiSearchQuery("Dame informacion de la tienda 1002", history), "Dame informacion de la tienda 1002");
});

test("consulta estados de capacitaciones y calcula cada grupo por fecha", () => {
  assert.equal(isTrainingStatusRequest("Capacitaciones programadas?"), true);
  assert.equal(isTrainingStatusRequest("Y capacitaciones finalizadas?"), true);
  assert.equal(isTrainingStatusRequest("Y finalizadas?"), true);
  const rows = [
    { ID: "1", "FECHA CAPACITACION": "09/18/2026" },
    { ID: "2", "FECHA CAPACITACION": "09/19/2026" },
    { ID: "3", "FECHA CAPACITACION": "2026-09-23" },
    { ID: "4", "FECHA CAPACITACION": "" },
  ];
  const today = new Date(2026, 8, 19);
  assert.deepEqual(selectTrainingRowsByStatus(rows, "programadas", today).map((row) => row.ID), ["2", "3"]);
  assert.deepEqual(selectTrainingRowsByStatus(rows, "finalizadas", today).map((row) => row.ID), ["1"]);
});

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

test("detecta sucursales pendientes de subir al sistema PC", () => {
  assert.equal(isPendingSistemaPcRequest("Dame todas las sucursales de casa ley que estan pendientes de subir al sistema de proteccion civil"), true);
  assert.equal(isPendingSistemaPcRequest("Dame la lista de asistencia de la tienda 1002"), false);
});

test("detecta tiendas con estatus Creada en Proteccion Civil", () => {
  assert.equal(isCreatedSistemaPcRequest("Dame todas las tiendas de ley con estatus creada en proteccion civil"), true);
  assert.equal(isCreatedSistemaPcRequest("Dame las tiendas pendientes de subir a proteccion civil"), false);
});

test("filtra estatus Creado de la ultima solicitud de Casa Ley", () => {
  const branches = [
    { key: "1", tienda: "1301", idPc: "100", raw: { EMPRESA: "ley" } },
    { key: "2", tienda: "1356", idPc: "101", raw: { EMPRESA: "ley" } },
    { key: "3", tienda: "2001", idPc: "102", raw: { EMPRESA: "otra" } },
  ];
  const rows = [
    { SUCURSAL: "1", "AÑO": "2026", estatus: "Creado", registro_fecha: "09/01/2026" },
    { SUCURSAL: "1", "AÑO": "2026", estatus: "Firmada", registro_fecha: "09/03/2026" },
    { SUCURSAL: "2", "AÑO": "2026", estatus: "Creado", registro_fecha: "09/03/2026" },
    { SUCURSAL: "3", "AÑO": "2026", estatus: "Creado", registro_fecha: "09/03/2026" },
  ];
  assert.deepEqual(selectCreatedSistemaPcRows(rows, branches, "ley", 2026).map(({ branch }) => branch.tienda), ["1356"]);
});

test("consulta tambien tiendas visitadas sin incluir otras empresas", () => {
  const branches = [
    { key: "1", tienda: "1267", raw: { EMPRESA: "ley" } },
    { key: "2", tienda: "2001", raw: { EMPRESA: "otra" } },
  ];
  const rows = [
    { SUCURSAL: "1", "AÑO": "2026", estatus: "VISITADA", registro_fecha: "09/03/2026" },
    { SUCURSAL: "2", "AÑO": "2026", estatus: "VISITADA", registro_fecha: "09/03/2026" },
  ];
  assert.deepEqual(selectSistemaPcRows(rows, branches, "ley", 2026, "visitada").map(({ branch }) => branch.tienda), ["1267"]);
});

test("filtra la empresa y conserva solo el ultimo estatus del ano", () => {
  const branches = [
    { key: "1", tienda: "1002", raw: { EMPRESA: "1" } },
    { key: "2", tienda: "1003", raw: { EMPRESA: "1" } },
    { key: "3", tienda: "2001", raw: { EMPRESA: "2" } },
  ];
  const rows = [
    { SUCURSAL: "1", FECHA: "01/02/2026", "SISTEMA PC": "", PIPC: "IMPRESO" },
    { SUCURSAL: "1", FECHA: "02/02/2026", "SISTEMA PC": "EN SISTEMA PC", PIPC: "ENTREGADO" },
    { SUCURSAL: "2", FECHA: "02/02/2026", "SISTEMA PC": "", PIPC: "PENDIENTE" },
    { SUCURSAL: "3", FECHA: "02/02/2026", "SISTEMA PC": "", PIPC: "IMPRESO" },
  ];
  assert.deepEqual(selectPendingSistemaPcRows(rows, branches, "1", 2026).map(({ branch }) => branch.tienda), ["1003"]);
});
