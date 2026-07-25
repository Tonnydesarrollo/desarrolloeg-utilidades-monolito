const MAX_HISTORY_PER_JOB = 10;
const AUTH_REQUIRED_PATTERNS = [
  /login fallo/i,
  /credencial/i,
  /bloquead[oa]/i,
  /unauthorized/i,
  /\b401\b/,
  /\b403\b/,
  /\b409\b/,
];
const TIMEOUT_PATTERNS = [
  /abort(?:ed|error)/i,
  /timed?\s*out/i,
  /this operation was aborted/i,
  /operation was aborted/i,
];
const TRANSIENT_PATTERNS = [
  /\b429\b/,
  /\b5\d\d\b/,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
];

const executionHistoryByJob = new Map();

function extractErrorMessage(error) {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name || "";
  if (typeof error === "object") {
    const responseStatus = error?.response?.status;
    const responseMessage = error?.response?.data?.Message || error?.response?.data?.message;
    const responseText = error?.response?.data?.error || error?.response?.data?.Error;
    const statusText = Number.isFinite(Number(responseStatus)) ? `HTTP ${responseStatus}` : "";
    return [error.message, error.name, responseMessage, responseText, statusText]
      .filter(Boolean)
      .map((part) => String(part))
      .join(" ");
  }
  return String(error);
}

export function classifyJobFailure(error) {
  const message = extractErrorMessage(error).trim();
  const normalized = message.toLowerCase();
  const status = Number(error?.response?.status || error?.status || error?.code || NaN);

  const authRequired =
    AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(message)) ||
    (Number.isFinite(status) && [401, 403, 409].includes(status));
  if (authRequired) {
    return {
      kind: "auth_required",
      retryable: false,
      label: "Accion requerida",
      recommendation: "Revisar credenciales o desbloquear la cuenta antes de volver a programar el job.",
      message: message || "Autenticacion requerida",
    };
  }

  const timeout =
    TIMEOUT_PATTERNS.some((pattern) => pattern.test(message)) ||
    (error?.name === "AbortError") ||
    normalized.includes("timeout");
  if (timeout) {
    return {
      kind: "timeout",
      retryable: true,
      label: "Timeout",
      recommendation: "Subir el timeout o revisar latencia aguas abajo. Si persiste, ajustar reintentos y particionar la carga.",
      message: message || "Operacion abortada por timeout",
    };
  }

  const transient =
    TRANSIENT_PATTERNS.some((pattern) => pattern.test(message)) ||
    (Number.isFinite(status) && status >= 500);
  if (transient) {
    return {
      kind: "transient",
      retryable: true,
      label: "Transitorio",
      recommendation: "Reintentar la ejecucion y revisar dependencias externas o latencia de red.",
      message: message || "Fallo transitorio",
    };
  }

  return {
    kind: "unknown",
    retryable: true,
    label: "Sin clasificar",
    recommendation: "Revisar el log completo del job para definir la correccion.",
    message: message || "Error desconocido",
  };
}

function pushExecution(jobId, entry) {
  const key = String(jobId || "job").trim() || "job";
  const current = executionHistoryByJob.get(key) || [];
  const next = [entry, ...current].slice(0, MAX_HISTORY_PER_JOB);
  executionHistoryByJob.set(key, next);
  return next;
}

export function recordJobExecution(jobId, entry) {
  const classification = entry?.classification || classifyJobFailure(entry?.error);
  return pushExecution(jobId, {
    jobId: String(jobId || "job"),
    source: String(entry?.source || "manual"),
    status: String(entry?.status || "unknown"),
    ok: Boolean(entry?.ok),
    code: Number.isFinite(Number(entry?.code)) ? Number(entry.code) : null,
    native: Boolean(entry?.native),
    startedAt: entry?.startedAt || null,
    finishedAt: entry?.finishedAt || null,
    durationMs: Number.isFinite(Number(entry?.durationMs)) ? Number(entry.durationMs) : null,
    error: entry?.error ? String(entry.error) : null,
    result: entry?.result ?? null,
    failureKind: classification?.kind || null,
    failureLabel: classification?.label || null,
    failureRetryable: Boolean(classification?.retryable),
    failureRecommendation: classification?.recommendation || null,
  });
}

export async function executeTrackedJob(jobId, executor, context = {}) {
  const startedAt = new Date();
  try {
    const result = await executor();
    const finishedAt = new Date();
    recordJobExecution(jobId, {
      source: context.source || "manual",
      status: result?.ok === false ? "failed" : "done",
      ok: Boolean(result?.ok ?? true),
      code: Number.isFinite(Number(result?.code)) ? Number(result.code) : null,
      native: Boolean(result?.native),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: result?.stderr || result?.error || null,
      result: result?.result ?? null,
      classification: result?.ok === false ? classifyJobFailure(result?.stderr || result?.error || null) : null,
    });
    return result;
  } catch (error) {
    const finishedAt = new Date();
    const classification = classifyJobFailure(error);
    recordJobExecution(jobId, {
      source: context.source || "manual",
      status: "failed",
      ok: false,
      code: null,
      native: false,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
      result: null,
      classification,
    });
    throw error;
  }
}

export function getLatestJobExecution(jobId) {
  const key = String(jobId || "job").trim() || "job";
  const entries = executionHistoryByJob.get(key) || [];
  return entries[0] || null;
}

export function getJobExecutionHistory(jobId) {
  const key = String(jobId || "job").trim() || "job";
  return [...(executionHistoryByJob.get(key) || [])];
}

export function getJobExecutionSnapshot() {
  return Array.from(executionHistoryByJob.entries()).reduce((acc, [jobId, entries]) => {
    acc[jobId] = [...entries];
    return acc;
  }, {});
}

export function clearJobExecutionHistory(jobId) {
  if (jobId === undefined || jobId === null) {
    executionHistoryByJob.clear();
    return;
  }

  const key = String(jobId || "job").trim() || "job";
  executionHistoryByJob.delete(key);
}
