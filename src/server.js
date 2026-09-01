import fs from "fs";
import path from "path";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startClusterCoordinator } from "./services/clusterCoordinator.js";
import { warmPlaneacionBranchesCache } from "./modules/planeacion/planeacion.router.js";
import { stopBackgroundServices } from "./services/backgroundServices.js";
import { bootstrapAppShellCaches } from "./services/appShellAuditReconciler.js";

function ensureRuntimeDirectories() {
  const runtimeRoot = path.resolve(process.env.RUNTIME_DIR || path.join(process.cwd(), "runtime"));
  const dirs = [
    runtimeRoot,
    process.env.RUNTIME_LOGS_DIR || path.join(runtimeRoot, "logs"),
    path.dirname(process.env.PLATFORM_CACHE_DB_PATH || path.join(runtimeRoot, "cache", "platform-cache.sqlite")),
    process.env.FACTURAS_NATIVE_DUMP_DIR || path.join(runtimeRoot, "jobs", "facturas"),
    process.env.PEDIDOS_OUTPUT_DIR || path.join(runtimeRoot, "jobs", "pedidos"),
    process.env.CASALEY_OUTPUT_DIR || path.join(runtimeRoot, "jobs", "casaley"),
  ];

  for (const dir of dirs) {
    if (!dir) continue;
    try {
      fs.mkdirSync(path.resolve(dir), { recursive: true });
    } catch (error) {
      console.warn("[monolito] no se pudo preparar directorio runtime:", dir, error instanceof Error ? error.message : error);
    }
  }
}

ensureRuntimeDirectories();

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
