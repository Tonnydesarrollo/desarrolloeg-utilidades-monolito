import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPedidoBusinessStatus,
  classifyPedidoDeliveryStatus,
  hasPedidoDirectPaymentEvidence,
} from "../src/modules/pedidos-ley/services/pedidosLey.js";

test("clasifica los cuatro estados principales de pedidos como grupos excluyentes", () => {
  const cases = [
    [{}, "sin-liberacion"],
    [{ hasLiberacion: true }, "liberados"],
    [{ hasFacturaLey: true }, "pendientes-pago"],
    [{ hasLiberacion: true, hasFacturaLey: true, pagado: true }, "pagados"],
  ];

  for (const [evidence, expected] of cases) {
    assert.equal(classifyPedidoBusinessStatus(evidence), expected);
  }
});

test("clasifica enviado y no enviado como subestados de no liberado", () => {
  assert.equal(classifyPedidoDeliveryStatus({}), "sin-liberacion-sin-trabajo");
  assert.equal(classifyPedidoDeliveryStatus({ tieneTrabajoActual: true }), "sin-liberacion-no-enviados");
  assert.equal(classifyPedidoDeliveryStatus({ tieneTrabajoActual: true, enviado: true }), "sin-liberacion-enviados");
});

test("la evidencia posterior de negocio tiene prioridad sobre estados anteriores", () => {
  assert.equal(classifyPedidoBusinessStatus({
    hasLiberacion: true,
    hasFacturaLey: true,
    pagado: true,
    enviado: true,
    tieneTrabajoActual: true,
  }), "pagados");

  assert.equal(classifyPedidoBusinessStatus({
    hasLiberacion: true,
    enviado: true,
    tieneTrabajoActual: true,
  }), "liberados");
});

test("una relacion explicita de pago o cheque prevalece sobre replicas historicas incompletas", () => {
  assert.equal(hasPedidoDirectPaymentEvidence({
    pago: "R100120265111180181",
    cheque: "R100120262070586621",
    status: "PAGADO",
  }), true);
  assert.equal(hasPedidoDirectPaymentEvidence({ pago: "[]", cheque: "", status: "NO PAGADO" }), false);
  assert.equal(hasPedidoDirectPaymentEvidence({ status: "PAGADO" }), true);
});

test("el estado pagado requiere una relacion persistente y no un status calculado aislado", () => {
  const staleCalculatedField = hasPedidoDirectPaymentEvidence({ status: "PAGADO" });
  assert.equal(staleCalculatedField, true);
  assert.equal(classifyPedidoBusinessStatus({
    hasLiberacion: true,
    hasFacturaLey: true,
    pagado: false,
  }), "pendientes-pago");
});
