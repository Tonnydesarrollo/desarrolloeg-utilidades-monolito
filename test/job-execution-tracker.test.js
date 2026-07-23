import test from "node:test";
import assert from "node:assert/strict";
import {
  clearJobExecutionHistory,
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
