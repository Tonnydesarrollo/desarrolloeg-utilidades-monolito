import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startClusterCoordinator } from "./services/clusterCoordinator.js";
import { warmPlaneacionBranchesCache } from "./modules/planeacion/planeacion.router.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`[monolito] escuchando en puerto ${env.port}`);
  startClusterCoordinator();
  void warmPlaneacionBranchesCache();
});
