import fs from "fs";
import path from "path";

function resolveStateDir() {
  const configured = process.env.JOBS_STATE_DIR || process.env.JOB_STATE_DIR;
  if (configured && String(configured).trim()) {
    return String(configured).trim();
  }
  return path.resolve(process.cwd(), "runtime", "jobs", "state");
}

function resolveStatePath(jobId) {
  const safeJobId = String(jobId || "job").replace(/[^a-z0-9._-]/gi, "_");
  const stateDir = resolveStateDir();
  fs.mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, `${safeJobId}.json`);
}

export function loadJobState(jobId) {
  const statePath = resolveStatePath(jobId);
  if (!fs.existsSync(statePath)) {
    return {
      version: 1,
      updatedAt: null,
      data: {},
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      version: Number(parsed?.version || 1),
      updatedAt: parsed?.updatedAt || null,
      data: parsed?.data && typeof parsed.data === "object" ? parsed.data : {},
    };
  } catch {
    return {
      version: 1,
      updatedAt: null,
      data: {},
    };
  }
}

export function saveJobState(jobId, data) {
  const statePath = resolveStatePath(jobId);
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data: data && typeof data === "object" ? data : {},
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), "utf8");
  return statePath;
}

