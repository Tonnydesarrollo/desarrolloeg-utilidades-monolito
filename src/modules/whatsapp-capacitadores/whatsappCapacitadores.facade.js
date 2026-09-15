import fs from "node:fs";
import * as localService from "./whatsappCapacitadores.service.js";

let externalStatus = null;
let refreshPromise = null;
let refreshedAt = 0;

function externalUrl() {
  return String(process.env.WHATSAPP_CAP_SERVICE_URL || "").trim().replace(/\/$/, "");
}

function isExternal() {
  return Boolean(externalUrl());
}

function disconnectedStatus(error = null) {
  return {
    enabled: true,
    external: true,
    status: "disconnected",
    startedAt: null,
    readyAt: null,
    qrGeneratedAt: null,
    qrAvailable: false,
    lastError: error,
    sessionDir: "external",
    connected: false,
  };
}

function serviceToken() {
  const configured = String(process.env.WHATSAPP_CAP_SERVICE_TOKEN || "").trim();
  if (configured) return configured;
  const tokenPath = process.env.WHATSAPP_CAP_SERVICE_TOKEN_FILE ||
    "/app/runtime/whatsapp-dev/service-token";
  return fs.readFileSync(tokenPath, "utf8").trim();
}

async function requestExternal(path, options = {}) {
  const response = await fetch(`${externalUrl()}${path}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${serviceToken()}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Servicio WhatsApp respondio HTTP ${response.status}`);
  }
  return response;
}

export async function refreshWhatsAppCapacitadoresStatus() {
  if (!isExternal()) return localService.getWhatsAppCapacitadoresStatus();
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const response = await requestExternal("/status");
      externalStatus = { ...await response.json(), external: true };
    } catch (error) {
      externalStatus = disconnectedStatus(error instanceof Error ? error.message : String(error));
    } finally {
      refreshedAt = Date.now();
      refreshPromise = null;
    }
    return externalStatus;
  })();
  return refreshPromise;
}

export function getWhatsAppCapacitadoresStatus() {
  if (!isExternal()) return localService.getWhatsAppCapacitadoresStatus();
  if (Date.now() - refreshedAt > 5000) void refreshWhatsAppCapacitadoresStatus();
  return externalStatus || disconnectedStatus("Esperando al servicio WhatsApp");
}

export async function startWhatsAppCapacitadoresService() {
  return isExternal()
    ? refreshWhatsAppCapacitadoresStatus()
    : localService.startWhatsAppCapacitadoresService();
}

export async function stopWhatsAppCapacitadoresService() {
  if (!isExternal()) return localService.stopWhatsAppCapacitadoresService();
}

export async function getWhatsAppCapacitadoresQrScreenshot() {
  if (!isExternal()) return localService.getWhatsAppCapacitadoresQrScreenshot();
  const response = await requestExternal("/qr.png");
  return response.status === 404 ? null : Buffer.from(await response.arrayBuffer());
}

export async function restartWhatsAppCapacitadoresForQr() {
  if (!isExternal()) return localService.restartWhatsAppCapacitadoresForQr();
  const response = await requestExternal("/restart", { method: "POST" });
  if (!response.ok) throw new Error("No se pudo reiniciar el servicio WhatsApp");
  return refreshWhatsAppCapacitadoresStatus();
}
