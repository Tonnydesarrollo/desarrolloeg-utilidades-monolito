import test from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppCapacitadoresLandingHtml } from "../src/modules/whatsapp-capacitadores/whatsappCapacitadores.router.js";

test("WhatsApp Capacitadores landing exposes the key operational links", () => {
  const html = buildWhatsAppCapacitadoresLandingHtml({
    status: "ready",
    connected: true,
    qrAvailable: true,
    lastError: null,
  });

  assert.match(html, /\/whatsapp-capacitadores\/qr/);
  assert.match(html, /\/whatsapp-capacitadores\/health/);
  assert.match(html, /WhatsApp Capacitadores/);
  assert.match(html, /ready/);
});
