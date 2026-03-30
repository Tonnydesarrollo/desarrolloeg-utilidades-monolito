import { startJobScheduler, getJobSchedulerStatus } from "../modules/jobs/services/jobScheduler.js";
import {
  getWhatsAppCapacitadoresStatus,
  startWhatsAppCapacitadoresService,
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
