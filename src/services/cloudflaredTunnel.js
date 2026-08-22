import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLOUDFLARED_ENABLED = String(process.env.CLOUDFLARED_ENABLED ?? "1").trim() !== "0";
const CLOUDFLARED_BIN_PATH = String(process.env.CLOUDFLARED_BIN_PATH || "cloudflared").trim();
const CLOUDFLARED_CONFIG_PATH = String(process.env.CLOUDFLARED_CONFIG_PATH || path.resolve(__dirname, "..", "..", "cloudflared", "config.yml")).trim();
const CLOUDFLARED_WORKDIR = String(process.env.CLOUDFLARED_WORKDIR || path.resolve(__dirname, "..", "..")).trim();
const CLOUDFLARED_RESTART_DELAY_MS = Number(process.env.CLOUDFLARED_RESTART_DELAY_MS || 5000);

const state = {
  desired: false,
  running: false,
  pid: null,
  restartCount: 0,
  lastStartedAt: null,
  lastStoppedAt: null,
  lastExitAt: null,
  lastExitCode: null,
  lastSignal: null,
  lastError: null,
  restartTimer: null,
  process: null,
};

function log(message) {
  console.log(`[cloudflared] ${message}`);
}

function logError(message) {
  console.error(`[cloudflared] ${message}`);
}

function clearRestartTimer() {
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
}

function attachProcessListeners(child) {
  child.stdout?.on("data", (data) => {
    const text = String(data || "").trim();
    if (text) console.log(`[cloudflared] ${text}`);
  });

  child.stderr?.on("data", (data) => {
    const text = String(data || "").trim();
    if (text) console.error(`[cloudflared] ${text}`);
  });

  child.on("error", (error) => {
    state.lastError = error instanceof Error ? error.message : String(error);
    state.running = false;
    state.pid = null;
    state.lastExitAt = new Date().toISOString();
    logError(`error iniciando proceso: ${state.lastError}`);
    scheduleRestart();
  });

  child.on("exit", (code, signal) => {
    state.running = false;
    state.pid = null;
    state.process = null;
    state.lastExitAt = new Date().toISOString();
    state.lastExitCode = code;
    state.lastSignal = signal;
    log(`salio con codigo ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`);
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (!state.desired || !CLOUDFLARED_ENABLED) return;
  if (state.restartTimer) return;

  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    if (!state.desired || state.running) return;
    void startCloudflaredTunnel();
  }, CLOUDFLARED_RESTART_DELAY_MS);
}

export function startCloudflaredTunnel() {
  if (!CLOUDFLARED_ENABLED) {
    state.desired = false;
    state.lastError = "disabled";
    return { started: false, reason: "disabled" };
  }

  if (state.running && state.process) {
    return { started: true, pid: state.pid, alreadyRunning: true };
  }

  if (!fs.existsSync(CLOUDFLARED_CONFIG_PATH)) {
    state.lastError = `config no encontrado: ${CLOUDFLARED_CONFIG_PATH}`;
    logError(state.lastError);
    return { started: false, reason: state.lastError };
  }

  state.desired = true;
  clearRestartTimer();

  let child;
  try {
    child = spawn(CLOUDFLARED_BIN_PATH, ["tunnel", "--no-autoupdate", "--config", CLOUDFLARED_CONFIG_PATH, "run"], {
      cwd: CLOUDFLARED_WORKDIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CLOUDFLARED_CONFIG_PATH,
        CLOUDFLARED_WORKDIR,
      },
    });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    state.running = false;
    state.pid = null;
    state.lastExitAt = new Date().toISOString();
    logError(`no se pudo lanzar cloudflared: ${state.lastError}`);
    scheduleRestart();
    return { started: false, reason: state.lastError };
  }

  state.process = child;
  state.running = true;
  state.pid = child.pid ?? null;
  state.lastStartedAt = new Date().toISOString();
  state.lastError = null;
  state.lastExitCode = null;
  state.lastSignal = null;
  state.restartCount += 1;

  attachProcessListeners(child);
  log(`iniciado pid=${state.pid ?? "unknown"}`);

  return { started: true, pid: state.pid };
}

export async function stopCloudflaredTunnel() {
  state.desired = false;
  clearRestartTimer();

  const child = state.process;
  if (!child) {
    state.running = false;
    state.pid = null;
    state.lastStoppedAt = new Date().toISOString();
    return;
  }

  const exitPromise = new Promise((resolve) => {
    const onExit = () => resolve();
    child.once("exit", onExit);
    setTimeout(() => {
      try {
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
      }
    }, 0);
  });

  await Promise.race([
    exitPromise,
    new Promise((resolve) => setTimeout(resolve, 10000)),
  ]);

  state.running = false;
  state.pid = null;
  state.process = null;
  state.lastStoppedAt = new Date().toISOString();
}

export function getCloudflaredTunnelStatus() {
  return {
    enabled: CLOUDFLARED_ENABLED,
    desired: state.desired,
    running: state.running,
    pid: state.pid,
    restartCount: state.restartCount,
    lastStartedAt: state.lastStartedAt,
    lastStoppedAt: state.lastStoppedAt,
    lastExitAt: state.lastExitAt,
    lastExitCode: state.lastExitCode,
    lastSignal: state.lastSignal,
    lastError: state.lastError,
    configPath: CLOUDFLARED_CONFIG_PATH,
    binPath: CLOUDFLARED_BIN_PATH,
  };
}
