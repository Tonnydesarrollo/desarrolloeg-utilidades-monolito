import test from "node:test";
import assert from "node:assert/strict";
import { getWhatsAppState } from "../src/modules/dashboard/dashboard.service.js";

test("WhatsApp dashboard state treats authenticated sessions as connected", () => {
  const state = getWhatsAppState({
    enabled: true,
    status: "authenticated",
  });

  assert.equal(state.tone, "ok");
  assert.equal(state.label, "Conectado");
});
