import test from "node:test";
import assert from "node:assert/strict";
import { isFacturaCancelada } from "../src/modules/jobs/native/facturas/syncFacturasNative.js";

test("facturas native filtra facturas canceladas por estatus de cancelacion", () => {
  assert.equal(isFacturaCancelada({
    estatusCancelacion: 1,
    estatusPagoDesc: "Pendiente cobrar",
  }), true);

  assert.equal(isFacturaCancelada({
    estatusCancelacion: 0,
    estatusPagoDesc: "Pendiente cobrar",
  }), false);

  assert.equal(isFacturaCancelada({
    estatusCancelacion: null,
    estatusPagoDesc: "Factura cancelada por sustitucion",
  }), true);
});
