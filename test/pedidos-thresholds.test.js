import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAssignmentRelationKeys,
  getPedidosLeyAdminDefaultThresholds,
} from "../src/modules/pedidos-ley/services/pedidosLey.js";

test("pedidos usa los precios base estatal y municipal", () => {
  const previousState = process.env.PEDIDOS_LEY_STATE_THRESHOLD;
  const previousMunicipal = process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD;
  const previousMunicipal2026 = process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD_2026;
  delete process.env.PEDIDOS_LEY_STATE_THRESHOLD;
  delete process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD;
  delete process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD_2026;
  try {
    assert.deepEqual(getPedidosLeyAdminDefaultThresholds(2026), {
      estatalMin: 32967.49,
      municipalMin: 11000,
    });
  } finally {
    if (previousState === undefined) delete process.env.PEDIDOS_LEY_STATE_THRESHOLD;
    else process.env.PEDIDOS_LEY_STATE_THRESHOLD = previousState;
    if (previousMunicipal === undefined) delete process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD;
    else process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD = previousMunicipal;
    if (previousMunicipal2026 === undefined) delete process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD_2026;
    else process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD_2026 = previousMunicipal2026;
  }
});

test("pedidos permite variar el precio municipal por anio", () => {
  process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD_2027 = "12500.50";
  try {
    assert.equal(getPedidosLeyAdminDefaultThresholds(2027).municipalMin, 12500.5);
  } finally {
    delete process.env.PEDIDOS_LEY_MUNICIPAL_THRESHOLD_2027;
  }
});

test("asignaciones pagadas se separan como identificadores exactos", () => {
  const keys = extractAssignmentRelationKeys('["LIB-100", "LIB-1000"]');
  assert.equal(keys.has("LIB100"), true);
  assert.equal(keys.has("LIB1000"), true);
  assert.equal(keys.has("LIB10"), false);
});
