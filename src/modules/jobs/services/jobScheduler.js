import { runJob } from "./jobRunner.js";

const schedulerState = {
  initialized: false,
  started: false,
  jobs: new Map(),
};

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parsePositiveMinutes(value, fallbackMinutes) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMinutes;
  return parsed;
}

function ensureJobsRegistered() {
  if (schedulerState.initialized) return;
  schedulerState.initialized = true;

  registerIntervalJob({
    jobId: "facturas-native-sync",
    label: "Facturas ClubFactura",
    enabled: parseBoolean(process.env.FACTURAS_SYNC_ENABLED, false),
    intervalMinutes: parsePositiveMinutes(process.env.FACTURAS_SYNC_INTERVAL_MINUTES, 5),
    runOnStart: parseBoolean(process.env.FACTURAS_SYNC_RUN_ON_START, true),
  });

  registerIntervalJob({
    jobId: "casaley-sync-appsheet",
    label: "CasaLey AppSheet",
    enabled: parseBoolean(process.env.CASALEY_SYNC_ENABLED, false),
    intervalMinutes: parsePositiveMinutes(process.env.CASALEY_SYNC_INTERVAL_MINUTES, 5),
    runOnStart: parseBoolean(process.env.CASALEY_SYNC_RUN_ON_START, true),
  });

  registerIntervalJob({
    jobId: "pedidos-native-sync",
    label: "Pedidos y Liberaciones",
    enabled: parseBoolean(process.env.PEDIDOS_SYNC_ENABLED, false),
    intervalMinutes: parsePositiveMinutes(process.env.PEDIDOS_SYNC_INTERVAL_MINUTES, 5),
    runOnStart: parseBoolean(process.env.PEDIDOS_SYNC_RUN_ON_START, false),
  });
}

function scheduleNext(entry, delayMs) {
  clearTimeout(entry.timeout);
  entry.nextRunAt = new Date(Date.now() + delayMs).toISOString();
  entry.timeout = setTimeout(async () => {
    await executeScheduledJob(entry.jobId);
  }, delayMs);
}

async function executeScheduledJob(jobId) {
  const entry = schedulerState.jobs.get(jobId);
  if (!entry || !entry.enabled || !schedulerState.started) return;
  if (entry.running) return;

  entry.running = true;
  entry.lastStartedAt = new Date().toISOString();
  entry.lastError = null;

  try {
    const result = await runJob(jobId);
    entry.lastFinishedAt = new Date().toISOString();
    entry.lastResult = {
      ok: result?.ok ?? true,
      code: result?.code ?? 0,
      native: Boolean(result?.native),
      result: result?.result ?? null,
    };
    if (!result?.ok) {
      entry.lastError = result?.stderr || result?.error || "El job termino con error";
    }
  } catch (error) {
    entry.lastFinishedAt = new Date().toISOString();
    entry.lastError = error instanceof Error ? error.message : String(error);
    entry.lastResult = { ok: false };
  } finally {
    entry.running = false;
    if (schedulerState.started && entry.enabled) {
      scheduleNext(entry, entry.intervalMs);
    } else {
      entry.nextRunAt = null;
    }
  }
}

function registerIntervalJob({ jobId, label, enabled, intervalMinutes, runOnStart }) {
  const intervalMs = intervalMinutes * 60 * 1000;
  const entry = {
    jobId,
    label,
    enabled,
    intervalMinutes,
    intervalMs,
    runOnStart,
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastResult: null,
    lastError: null,
    nextRunAt: null,
    timeout: null,
  };

  schedulerState.jobs.set(jobId, entry);

  if (!enabled) return entry;
  return entry;
}

export function startJobScheduler() {
  ensureJobsRegistered();
  if (schedulerState.started) return;
  schedulerState.started = true;

  for (const entry of schedulerState.jobs.values()) {
    if (!entry.enabled) continue;
    if (entry.timeout) clearTimeout(entry.timeout);
    scheduleNext(entry, entry.runOnStart ? 0 : entry.intervalMs);
  }
}

export function getJobSchedulerStatus() {
  ensureJobsRegistered();
  return Array.from(schedulerState.jobs.values()).map((entry) => ({
    jobId: entry.jobId,
    label: entry.label,
    enabled: entry.enabled,
    intervalMinutes: entry.intervalMinutes,
    runOnStart: entry.runOnStart,
    running: entry.running,
    lastStartedAt: entry.lastStartedAt,
    lastFinishedAt: entry.lastFinishedAt,
    lastResult: entry.lastResult,
    lastError: entry.lastError,
    nextRunAt: entry.nextRunAt,
  }));
}
