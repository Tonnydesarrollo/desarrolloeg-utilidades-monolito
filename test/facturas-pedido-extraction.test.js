import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPedidoFromXmlText,
  normalizeFacturaPedidoValue,
  resolveFacturaPedidoValue,
} from "../src/modules/jobs/native/facturas/syncFacturasNative.js";

test("extrae el pedido desde el atributo Descripcion del XML de ClubFactura", () => {
  const xml = '<cfdi:Concepto ClaveProdServ="80101500" NoIdentificacion="003" Cantidad="1.00" ClaveUnidad="E48" Unidad="SERVICIO" Descripcion="ELABORACION DEL PROGRAMA INTERNO EN MATERIA DE PROTECCION CIVIL Y CAPACITACION TIENDA 1301 SENDERO MOCHIS LEY PEDIDO 6001335070" ValorUnitario="32967.49" Importe="32967.49" ObjetoImp="02">';
  assert.equal(extractPedidoFromXmlText(xml), "6001335070");
});

test("no acepta valores vacios o texto no numerico como pedido", () => {
  assert.equal(normalizeFacturaPedidoValue(""), null);
  assert.equal(normalizeFacturaPedidoValue("   "), null);
  assert.equal(normalizeFacturaPedidoValue("PENDIENTE"), null);
});

test("normaliza un pedido numerico o embebido en texto", () => {
  assert.equal(normalizeFacturaPedidoValue("6001335070"), "6001335070");
  assert.equal(normalizeFacturaPedidoValue("PEDIDO 6001335070"), "6001335070");
  assert.equal(normalizeFacturaPedidoValue("No. de pedido: 6001335070"), "6001335070");
});

test("deja PENDIENTE cuando no hay pedido ni en el XML", () => {
  assert.equal(resolveFacturaPedidoValue("", ""), "PENDIENTE");
  assert.equal(resolveFacturaPedidoValue(null, "<xml sin pedido>"), "PENDIENTE");
});
