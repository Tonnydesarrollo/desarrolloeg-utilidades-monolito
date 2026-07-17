import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startClusterCoordinator } from "./services/clusterCoordinator.js";
import { warmPlaneacionBranchesCache } from "./modules/planeacion/planeacion.router.js";
import { warmPortalDashboardCaches } from "./modules/home/portalAuth.service.js";
import { stopBackgroundServices } from "./services/backgroundServices.js";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`[monolito] escuchando en puerto ${env.port}`);
  startClusterCoordinator();
  void warmPlaneacionBranchesCache();
  void warmPortalDashboardCaches().catch((error) => {
    console.warn("[monolito] no se pudo precargar el dashboard:", error instanceof Error ? error.message : error);
  });
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[monolito] apagando por ${signal}`);

  server.close(async () => {
    try {
      await stopBackgroundServices();
      process.exit(0);
    } catch (error) {
      console.error("[monolito] error durante apagado:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("[monolito] apagado forzado por timeout");
    process.exit(1);
  }, 25000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
