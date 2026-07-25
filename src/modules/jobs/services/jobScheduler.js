import { runJob } from "./jobRunner.js";
import { executeTrackedJob } from "./jobExecutionTracker.js";
import { classifyJobFailure } from "./jobExecutionTracker.js";
import { getJobConfigurationState } from "./jobRegistry.js";

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

function parsePositiveSeconds(value, fallbackSeconds) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackSeconds;
  return parsed;
}

function resolveTargetBoolean(targetEnvName, legacyEnvName, fallback, allowLegacy = true) {
  if (process.env[targetEnvName] !== undefined && process.env[targetEnvName] !== null && String(process.env[targetEnvName]).trim() !== "") {
    return parseBoolean(process.env[targetEnvName], fallback);
  }
  if (
    allowLegacy &&
    process.env[legacyEnvName] !== undefined &&
    process.env[legacyEnvName] !== null &&
    String(process.env[legacyEnvName]).trim() !== ""
  ) {
    return parseBoolean(process.env[legacyEnvName], fallback);
  }
  return fallback;
}

function resolveTargetSeconds(targetEnvName, legacyEnvName, fallbackSeconds) {
  if (process.env[targetEnvName] !== undefined && process.env[targetEnvName] !== null && String(process.env[targetEnvName]).trim() !== "") {
    return parsePositiveSeconds(process.env[targetEnvName], fallbackSeconds);
  }
  if (process.env[legacyEnvName] !== undefined && process.env[legacyEnvName] !== null && String(process.env[legacyEnvName]).trim() !== "") {
    return parsePositiveSeconds(process.env[legacyEnvName], fallbackSeconds);
  }
  return fallbackSeconds;
}

function ensureJobsRegistered() {
  if (schedulerState.initialized) return;
  schedulerState.initialized = true;

  registerIntervalJob({
    jobId: "facturas-native-sync",
    label: "Facturas ClubFactura",
    enabled: parseBoolean(process.env.FACTURAS_SYNC_ENABLED, false),
    intervalSeconds: parsePositiveSeconds(
      process.env.FACTURAS_SYNC_INTERVAL_SECONDS,
      parsePositiveMinutes(process.env.FACTURAS_SYNC_INTERVAL_MINUTES, 1) * 60
    ),
    runOnStart: parseBoolean(process.env.FACTURAS_SYNC_RUN_ON_START, true),
  });

  registerIntervalJob({
    jobId: "casaley-sync-appsheet",
    label: "CasaLey AppSheet",
    enabled: parseBoolean(process.env.CASALEY_SYNC_ALL_ENABLED, false),
    intervalSeconds: parsePositiveSeconds(
      process.env.CASALEY_SYNC_ALL_INTERVAL_SECONDS || process.env.CASALEY_SYNC_INTERVAL_SECONDS,
      parsePositiveMinutes(process.env.CASALEY_SYNC_INTERVAL_MINUTES, 1) * 60
    ),
    runOnStart: parseBoolean(process.env.CASALEY_SYNC_ALL_RUN_ON_START, true),
  });

  registerIntervalJob({
    jobId: "pagos-ley",
    label: "CasaLey Pagos",
    enabled: resolveTargetBoolean("CASALEY_PAGOS_LEY_ENABLED", "CASALEY_SYNC_ENABLED", false),
    intervalSeconds: resolveTargetSeconds(
      "CASALEY_PAGOS_LEY_INTERVAL_SECONDS",
      "CASALEY_SYNC_INTERVAL_SECONDS",
      30
    ),
    runOnStart: resolveTargetBoolean("CASALEY_PAGOS_LEY_RUN_ON_START", "CASALEY_SYNC_RUN_ON_START", true),
  });

  registerIntervalJob({
    jobId: "cheques-ley",
    label: "CasaLey Cheques",
    enabled: resolveTargetBoolean("CASALEY_CHEQUES_LEY_ENABLED", "CASALEY_SYNC_ENABLED", false),
    intervalSeconds: resolveTargetSeconds(
      "CASALEY_CHEQUES_LEY_INTERVAL_SECONDS",
      "CASALEY_SYNC_INTERVAL_SECONDS",
      300
    ),
    runOnStart: resolveTargetBoolean("CASALEY_CHEQUES_LEY_RUN_ON_START", "CASALEY_SYNC_RUN_ON_START", false, false),
  });

  registerIntervalJob({
    jobId: "facturas-ley",
    label: "CasaLey Facturas",
    enabled: resolveTargetBoolean("CASALEY_FACTURAS_LEY_ENABLED", "CASALEY_SYNC_ENABLED", false),
    intervalSeconds: resolveTargetSeconds(
      "CASALEY_FACTURAS_LEY_INTERVAL_SECONDS",
      "CASALEY_SYNC_INTERVAL_SECONDS",
      60
    ),
    runOnStart: resolveTargetBoolean("CASALEY_FACTURAS_LEY_RUN_ON_START", "CASALEY_SYNC_RUN_ON_START", false, false),
  });

  registerIntervalJob({
    jobId: "pedidos-native-sync",
    label: "Pedidos y Liberaciones",
    enabled: parseBoolean(process.env.PEDIDOS_SYNC_ENABLED, false),
    intervalSeconds: parsePositiveSeconds(
      process.env.PEDIDOS_SYNC_INTERVAL_SECONDS,
      parsePositiveMinutes(process.env.PEDIDOS_SYNC_INTERVAL_MINUTES, 5) * 60
    ),
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

  const configuration = getJobConfigurationState(jobId);
  entry.configured = configuration.configured;
  entry.requiredEnv = configuration.requiredEnv;
  entry.missingEnv = configuration.missingEnv;
  if (!configuration.configured) {
    const missingText = configuration.missingEnv.length > 0 ? configuration.missingEnv.join(", ") : "variables requeridas";
    entry.lastStartedAt = new Date().toISOString();
    entry.lastFinishedAt = new Date().toISOString();
    entry.lastError = `Faltan credenciales: ${missingText}`;
    entry.lastErrorKind = "auth_required";
    entry.lastErrorRetryable = false;
    entry.lastErrorRecommendation = "Configurar las variables de entorno requeridas antes de reactivar el job.";
    entry.lastResult = { ok: false };
    entry.pausedUntil = null;
    entry.running = false;
    entry.nextRunAt = null;
    return;
  }

  entry.running = true;
  entry.lastStartedAt = new Date().toISOString();
  entry.lastError = null;
  entry.lastErrorKind = null;
  entry.lastErrorRetryable = null;
  entry.lastErrorRecommendation = null;
  entry.pausedUntil = null;

  try {
    const result = await executeTrackedJob(jobId, () => runJob(jobId), { source: "scheduler" });
    entry.lastFinishedAt = new Date().toISOString();
    entry.lastResult = {
      ok: result?.ok ?? true,
      code: result?.code ?? 0,
      native: Boolean(result?.native),
      result: result?.result ?? null,
    };
    if (!result?.ok) {
      const failure = classifyJobFailure(result?.stderr || result?.error || null);
      entry.lastError = result?.stderr || result?.error || failure.message || "El job termino con error";
      entry.lastErrorKind = failure.kind;
      entry.lastErrorRetryable = failure.retryable;
      entry.lastErrorRecommendation = failure.recommendation;
      if (!failure.retryable) {
        entry.pausedUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
      }
    }
  } catch (error) {
    entry.lastFinishedAt = new Date().toISOString();
    const failure = classifyJobFailure(error);
    entry.lastError = failure.message || (error instanceof Error ? error.message : String(error));
    entry.lastErrorKind = failure.kind;
    entry.lastErrorRetryable = failure.retryable;
    entry.lastErrorRecommendation = failure.recommendation;
    entry.lastResult = { ok: false };
    if (!failure.retryable) {
      entry.pausedUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    }
  } finally {
    entry.running = false;
    if (schedulerState.started && entry.enabled) {
      const pausedUntil = entry.pausedUntil ? new Date(entry.pausedUntil).getTime() : 0;
      const delayMs = pausedUntil > Date.now()
        ? Math.max(pausedUntil - Date.now(), entry.intervalMs)
        : entry.intervalMs;
      scheduleNext(entry, delayMs);
    } else {
      entry.nextRunAt = null;
    }
  }
}

function registerIntervalJob({ jobId, label, enabled, intervalSeconds, runOnStart }) {
  const configuration = getJobConfigurationState(jobId);
  const intervalMs = intervalSeconds * 1000;
  const entry = {
    jobId,
    label,
    enabled,
    configured: configuration.configured,
    requiredEnv: configuration.requiredEnv,
    missingEnv: configuration.missingEnv,
    intervalSeconds,
    intervalMinutes: Math.round((intervalSeconds / 60) * 100) / 100,
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
    if (!entry.enabled || !entry.configured) continue;
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
    intervalSeconds: entry.intervalSeconds,
    intervalMinutes: entry.intervalMinutes,
    runOnStart: entry.runOnStart,
    running: entry.running,
    lastStartedAt: entry.lastStartedAt,
    lastFinishedAt: entry.lastFinishedAt,
    lastResult: entry.lastResult,
    lastError: entry.lastError,
    lastErrorKind: entry.lastErrorKind || null,
    lastErrorRetryable: entry.lastErrorRetryable ?? null,
    lastErrorRecommendation: entry.lastErrorRecommendation || null,
    pausedUntil: entry.pausedUntil || null,
    nextRunAt: entry.nextRunAt,
  }));
}
