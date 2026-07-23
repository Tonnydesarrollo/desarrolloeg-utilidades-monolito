const MAX_HISTORY_PER_JOB = 10;

const executionHistoryByJob = new Map();

function pushExecution(jobId, entry) {
  const key = String(jobId || "job").trim() || "job";
  const current = executionHistoryByJob.get(key) || [];
  const next = [entry, ...current].slice(0, MAX_HISTORY_PER_JOB);
  executionHistoryByJob.set(key, next);
  return next;
}

export function recordJobExecution(jobId, entry) {
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
    });
    return result;
  } catch (error) {
    const finishedAt = new Date();
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
