import test from "node:test";
import assert from "node:assert/strict";
import {
  clearJobExecutionHistory,
  classifyJobFailure,
  executeTrackedJob,
  getJobExecutionHistory,
  getLatestJobExecution,
} from "../src/modules/jobs/services/jobExecutionTracker.js";

test("job execution tracker keeps the latest executions first and caps history", async () => {
  clearJobExecutionHistory("demo-job");

  for (let index = 0; index < 12; index += 1) {
    await executeTrackedJob(
      "demo-job",
      async () => ({ ok: true, code: 0, native: false, result: { index } }),
      { source: "manual" }
    );
  }

  const history = getJobExecutionHistory("demo-job");
  assert.equal(history.length, 10);
  assert.equal(history[0].result.index, 11);
  assert.equal(history[9].result.index, 2);

  const latest = getLatestJobExecution("demo-job");
  assert.equal(latest.result.index, 11);
  clearJobExecutionHistory("demo-job");
});

test("job execution tracker records failures", async () => {
  clearJobExecutionHistory("failing-job");

  await assert.rejects(
    executeTrackedJob("failing-job", async () => {
      throw new Error("boom");
    }, { source: "scheduler" })
  );

  const latest = getLatestJobExecution("failing-job");
  assert.equal(latest.status, "failed");
  assert.equal(latest.ok, false);
  assert.match(String(latest.error || ""), /boom/);

  clearJobExecutionHistory("failing-job");
});

test("job execution tracker classifies auth and timeout failures", () => {
  const authFailure = classifyJobFailure(new Error("ClubFactura login fallo (409): La cuenta del usuario esta bloqueada"));
  assert.equal(authFailure.kind, "auth_required");
  assert.equal(authFailure.retryable, false);
  assert.match(authFailure.recommendation, /credenciales|bloquear/i);

  const timeoutFailure = classifyJobFailure(new Error("fetch failed (fetchFromAppSheet:PEDIDOS_LEY): This operation was aborted"));
  assert.equal(timeoutFailure.kind, "timeout");
  assert.equal(timeoutFailure.retryable, true);
  assert.match(timeoutFailure.recommendation, /timeout|reintentos|latencia/i);
});
