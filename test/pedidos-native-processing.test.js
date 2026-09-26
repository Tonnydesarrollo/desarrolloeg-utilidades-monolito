import test from "node:test";
import assert from "node:assert/strict";

import {
  getLiberacionMissingFields,
  getPedidoMissingFields,
} from "../src/modules/jobs/native/pedidos/syncPedidosNative.js";

test("una liberacion completa no necesita consultar su PDF", () => {
  assert.deepEqual(getLiberacionMissingFields({
    num_pedido: "6001343895",
    fecha: "24/09/2026",
  }), {
    "NUM. DE PEDIDO": false,
    FECHA: false,
  });
});

test("una liberacion incompleta conserva solo los campos que debe extraer", () => {
  assert.deepEqual(getLiberacionMissingFields({ num_pedido: "6001343895" }), {
    "NUM. DE PEDIDO": false,
    FECHA: true,
  });
});

test("un pedido con todos sus datos no necesita consultar su PDF", () => {
  assert.deepEqual(getPedidoMissingFields({
    proveedor: "DESARROLLO EG",
    establecimiento: "1312 SUPER LEY EXPRESS ANGOSTURA",
    fecha: "24/09/2026",
    importe: "25000",
    descripcion: "PIPC ESTATAL",
  }), {
    PROVEEDOR: false,
    ESTABLECIMIENTO: false,
    FECHA: false,
    IMPORTE: false,
    DESCRIPCION: false,
  });
});

test("un proveedor invalido mantiene pendiente el procesamiento del pedido", () => {
  assert.equal(getPedidoMissingFields({
    proveedor: "DOMICILIO:",
    establecimiento: "1312 SUPER LEY EXPRESS ANGOSTURA",
    fecha: "24/09/2026",
    importe: "25000",
    descripcion: "PIPC ESTATAL",
  }).PROVEEDOR, true);
});
