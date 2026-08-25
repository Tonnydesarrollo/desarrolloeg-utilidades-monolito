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
import { bootstrapAppShellCaches } from "./appShellAuditReconciler.js";
import { refreshAppShellCaches } from "./appShellRefresh.js";
import { warmPedidosLeySinLiberacionCache } from "../modules/pedidos-ley/services/pedidosLey.js";

let started = false;
let appShellCacheRefreshTimer = null;
let pedidosLeyCacheWarmTimer = null;

function parsePositiveSeconds(value, fallbackSeconds) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackSeconds;
  return parsed;
}

export function startBackgroundServices() {
  if (started) return;
  started = true;

  bootstrapAppShellCaches();
  startJobScheduler();

  const cacheRefreshIntervalMs = parsePositiveSeconds(
    process.env.APP_SHELL_CACHE_REFRESH_INTERVAL_SECONDS || process.env.PORTAL_CACHE_REFRESH_INTERVAL_SECONDS,
    300
  ) * 1000;

  if (!appShellCacheRefreshTimer) {
    const refresh = () => {
      void refreshAppShellCaches({ scope: "all", mode: "auto" }).catch((error) => {
        console.warn(
          "[cache] no se pudo reconciliar la caché compartida:",
          error instanceof Error ? error.message : error
        );
      });
    };

    setImmediate(refresh);
    appShellCacheRefreshTimer = setInterval(refresh, cacheRefreshIntervalMs);
    appShellCacheRefreshTimer.unref?.();
  }

  const pedidosLeyWarmIntervalMs = parsePositiveSeconds(
    process.env.PEDIDOS_LEY_CACHE_WARM_INTERVAL_SECONDS,
    300
  ) * 1000;

  if (!pedidosLeyCacheWarmTimer) {
    const warmPedidosLey = () => {
      void warmPedidosLeySinLiberacionCache().then((result) => {
        console.log(
          `[pedidos-ley] cache sin liberacion caliente: filas=${result.rows} ms=${result.elapsedMs}`
        );
      }).catch((error) => {
        console.warn(
          "[pedidos-ley] no se pudo calentar cache sin liberacion:",
          error instanceof Error ? error.message : error
        );
      });
    };

    setTimeout(warmPedidosLey, 5000).unref?.();
    pedidosLeyCacheWarmTimer = setInterval(warmPedidosLey, pedidosLeyWarmIntervalMs);
    pedidosLeyCacheWarmTimer.unref?.();
  }

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
  if (appShellCacheRefreshTimer) {
    clearInterval(appShellCacheRefreshTimer);
    appShellCacheRefreshTimer = null;
  }
  if (pedidosLeyCacheWarmTimer) {
    clearInterval(pedidosLeyCacheWarmTimer);
    pedidosLeyCacheWarmTimer = null;
  }
  await stopWhatsAppCapacitadoresService();
  await stopCloudflaredTunnel();
  started = false;
}
