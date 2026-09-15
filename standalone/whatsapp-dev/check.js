import fs from "node:fs";

const tokenPath = process.env.WHATSAPP_CAP_SERVICE_TOKEN_FILE ||
  "/app/runtime/whatsapp-dev/service-token";
const token = String(process.env.WHATSAPP_CAP_SERVICE_TOKEN || fs.readFileSync(tokenPath, "utf8")).trim();
const response = await fetch(`http://127.0.0.1:${process.env.WHATSAPP_CAP_SERVICE_PORT || 7010}/status`, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(5000),
});
const status = await response.json();
console.log(JSON.stringify(status));
process.exitCode = response.ok ? 0 : 1;
