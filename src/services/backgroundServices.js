import { startJobScheduler, getJobSchedulerStatus } from "../modules/jobs/services/jobScheduler.js";
import {
  getWhatsAppCapacitadoresStatus,
  startWhatsAppCapacitadoresService,
  stopWhatsAppCapacitadoresService,
} from "../modules/whatsapp-capacitadores/whatsappCapacitadores.service.js";
import {
  getCloudflaredTunnelStatus,
  startCloudflaredTunnel,
  stopCloudflaredTunnel,
} from "./cloudflaredTunnel.js";

let started = false;

export function startBackgroundServices() {
  if (started) return;
  started = true;

  startJobScheduler();

  startWhatsAppCapacitadoresService().catch((error) => {
    console.error("[whatsapp-capacitadores]", error instanceof Error ? error.message : error);
  });

  const cloudflaredResult = startCloudflaredTunnel();
  if (cloudflaredResult?.started) {
    console.log("[cloudflared] tunel ligado por arranque de servicios en segundo plano");
  }
}

export function getBackgroundServicesStatus() {
  return {
    started,
    scheduler: getJobSchedulerStatus(),
    whatsappCapacitadores: getWhatsAppCapacitadoresStatus(),
    cloudflared: getCloudflaredTunnelStatus(),
  };
}

export async function stopBackgroundServices() {
  await stopWhatsAppCapacitadoresService();
  await stopCloudflaredTunnel();
  started = false;
}
