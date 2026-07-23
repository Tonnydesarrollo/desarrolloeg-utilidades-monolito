import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let packageVersion = "unknown";

try {
  const packageJsonPath = path.resolve(__dirname, "..", "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  packageVersion = String(packageJson?.version || "unknown");
} catch {
  packageVersion = "unknown";
}

function firstEnv(names, fallback = "unknown") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

export function getReleaseInfo() {
  const version = firstEnv(["APP_RELEASE_VERSION", "RELEASE_VERSION"], packageVersion);
  const commit = firstEnv(["APP_BUILD_SHA", "RELEASE_SHA", "GIT_COMMIT_SHA", "VCS_REF"], "unknown");
  const buildAt = firstEnv(["APP_BUILD_TIMESTAMP", "RELEASE_BUILT_AT", "BUILD_TIMESTAMP"], "unknown");

  return {
    version,
    commit,
    buildAt,
    id: `${version}@${commit}`.trim(),
  };
}

