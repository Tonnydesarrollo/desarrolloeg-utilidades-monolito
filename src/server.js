import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startBackgroundServices } from "./services/backgroundServices.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`[monolito] escuchando en puerto ${env.port}`);
  startBackgroundServices();
});
