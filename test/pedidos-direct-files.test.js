import test from "node:test";
import assert from "node:assert/strict";

import { collectPedidoDirectFileIds, isPedidoDeliverableFile } from "../src/modules/pedidos-ley/services/pedidosLey.js";

test("recupera el PDF adjunto directamente al pedido aunque la carpeta de tienda este vacia", () => {
  const id = "1ZiqoqynMSuX_PQeOUYxALYrLOwomh6y-";
  assert.deepEqual(collectPedidoDirectFileIds({
    PDF: JSON.stringify({ Url: `https://drive.google.com/file/d/${id}/view?usp=drivesdk` }),
  }), [id]);
});

test("solo permite PIPC, planes de contingencia y planes de continuidad", () => {
  assert.equal(isPedidoDeliverableFile({ name: "PIPC 2026 SUC 1312.pdf" }), true);
  assert.equal(isPedidoDeliverableFile({ name: "PLAN DE CONTINGENCIA SUC 1312.pdf" }), true);
  assert.equal(isPedidoDeliverableFile({ name: "PLAN DE CONTINUIDAD DE OPERACIONES.pdf" }), true);
  assert.equal(isPedidoDeliverableFile({ name: "6001343895_1312.pdf" }), false);
  assert.equal(isPedidoDeliverableFile({ name: "1312 DICTAMEN TECNICO GAS.pdf" }), false);
});

test("deduplica enlaces directos repetidos y omite banderas que no son archivos", () => {
  const id = "1ZiqoqynMSuX_PQeOUYxALYrLOwomh6y-";
  assert.deepEqual(collectPedidoDirectFileIds({ PDF: `https://drive.google.com/file/d/${id}/view`,
    ARCHIVO: `https://drive.google.com/open?id=${id}`, PDF_EXTRAIDO: 1 }), [id]);
});
