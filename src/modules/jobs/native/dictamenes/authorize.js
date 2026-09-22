import "dotenv/config";
import { authorizeDictamenesGoogle } from "./auth.js";

authorizeDictamenesGoogle().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
