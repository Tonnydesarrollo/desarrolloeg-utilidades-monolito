import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import {
  getWhatsAppCapacitadoresQrScreenshot,
  getWhatsAppCapacitadoresStatus,
  restartWhatsAppCapacitadoresForQr,
  startWhatsAppCapacitadoresService,
  stopWhatsAppCapacitadoresService,
} from "../../src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js";

const port = Number(process.env.WHATSAPP_CAP_SERVICE_PORT || 7010);
const tokenPath = process.env.WHATSAPP_CAP_SERVICE_TOKEN_FILE ||
  "/app/runtime/whatsapp-dev/service-token";
fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
try {
  fs.writeFileSync(tokenPath, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
const token = String(process.env.WHATSAPP_CAP_SERVICE_TOKEN || fs.readFileSync(tokenPath, "utf8")).trim();

const app = express();
app.disable("x-powered-by");
app.get("/health", (_req, res) => {
  const whatsapp = getWhatsAppCapacitadoresStatus();
  const healthy = !whatsapp.enabled || whatsapp.status === "ready" || whatsapp.status === "awaiting_qr";
  res.status(healthy ? 200 : 503).json({
    service: "desarrolloeg-whatsapp",
    status: healthy ? "ok" : "starting",
    whatsapp,
  });
});
app.use((req, res, next) => {
  const provided = Buffer.from(req.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${token}`);
  res.set("Cache-Control", "no-store");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});
app.get("/status", (_req, res) => res.json(getWhatsAppCapacitadoresStatus()));
app.get("/qr.png", async (_req, res) => {
  const image = await getWhatsAppCapacitadoresQrScreenshot();
  if (!image) return res.status(404).json({ error: "qr_not_available" });
  res.type("png").send(image);
});
let restarting = false;
app.post("/restart", (_req, res) => {
  if (!restarting) {
    restarting = true;
    Promise.resolve().then(restartWhatsAppCapacitadoresForQr)
      .catch((error) => console.error("[whatsapp-dev] restart failed:", error.message))
      .finally(() => { restarting = false; });
  }
  res.status(202).json({ status: "restarting" });
});
app.use((error, _req, res, _next) => {
  console.error("[whatsapp-dev] request failed:", error.message);
  res.status(503).json({ error: "whatsapp_unavailable" });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[whatsapp-dev] listening on ${port}`);
  void startWhatsAppCapacitadoresService().catch((error) => {
    console.error("[whatsapp-dev] startup failed:", error.message);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 1000).unref();
  });
});

const startedAt = Date.now();
const startupWatchdog = setInterval(() => {
  const status = getWhatsAppCapacitadoresStatus();
  if (!status.enabled || status.status === "ready" || status.status === "awaiting_qr") {
    clearInterval(startupWatchdog);
    return;
  }
  if (Date.now() - startedAt < 4 * 60 * 1000) return;
  console.error(`[whatsapp-dev] startup watchdog: WhatsApp remained ${status.status}; restarting container`);
  process.exit(1);
}, 15000);
startupWatchdog.unref();

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 25000).unref();
  server.close();
  await stopWhatsAppCapacitadoresService().catch((error) => {
    console.error("[whatsapp-dev] shutdown failed:", error.message);
  });
  clearTimeout(timeout);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
