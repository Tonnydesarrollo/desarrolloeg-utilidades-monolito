import { startJobScheduler, getJobSchedulerStatus } from "../modules/jobs/services/jobScheduler.js";
import {
  getWhatsAppCapacitadoresStatus,
  startWhatsAppCapacitadoresService,
  stopWhatsAppCapacitadoresService,
} from "../modules/whatsapp-capacitadores/whatsappCapacitadores.service.js";

let started = false;

export function startBackgroundServices() {
  if (started) return;
  started = true;

  startJobScheduler();

  startWhatsAppCapacitadoresService().catch((error) => {
    console.error("[whatsapp-capacitadores]", error instanceof Error ? error.message : error);
  });
}

export function getBackgroundServicesStatus() {
  return {
    started,
    scheduler: getJobSchedulerStatus(),
    whatsappCapacitadores: getWhatsAppCapacitadoresStatus(),
  };
}

export async function stopBackgroundServices() {
  await stopWhatsAppCapacitadoresService();
  started = false;
}
