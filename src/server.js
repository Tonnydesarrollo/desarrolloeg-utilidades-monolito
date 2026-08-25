import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startClusterCoordinator } from "./services/clusterCoordinator.js";
import { warmPlaneacionBranchesCache } from "./modules/planeacion/planeacion.router.js";
import { stopBackgroundServices } from "./services/backgroundServices.js";
import { bootstrapAppShellCaches } from "./services/appShellAuditReconciler.js";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`[monolito] escuchando en puerto ${env.port}`);
  bootstrapAppShellCaches();
  startClusterCoordinator();
  void warmPlaneacionBranchesCache();
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

process.on("unhandledRejection", (reason) => {
  console.error(
    "[monolito] promesa rechazada sin manejar:",
    reason instanceof Error ? reason.message : reason
  );
});

process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const isTransientBrowserError =
    message.includes("Execution context was destroyed") ||
    message.includes("Target closed") ||
    message.includes("Session closed") ||
    message.includes("most likely because of a navigation");

  console.error("[monolito] excepcion no capturada:", message);
  if (!isTransientBrowserError) {
    process.exit(1);
  }
});
