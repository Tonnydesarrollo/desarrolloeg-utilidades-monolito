import assert from "node:assert/strict";
import test from "node:test";
import { formatSignerDisplayName } from "../src/modules/sucursales-docs/sucursalesDocs.service.js";

test("agrega los grados solicitados a los firmantes de cartas", () => {
  assert.equal(formatSignerDisplayName("SERGIO GONZALEZ GAMEZ"), "M.C. SERGIO GONZALES GAMEZ");
  assert.equal(formatSignerDisplayName("SERGIO GONZALES GAMEZ"), "M.C. SERGIO GONZALES GAMEZ");
  assert.equal(formatSignerDisplayName("MORELOS ENRIQUE PEREZ PICOS"), "LIC. MORELOS ENRIQUE PEREZ PICOS");
  assert.equal(formatSignerDisplayName("OTRO FIRMANTE"), "OTRO FIRMANTE");
});
