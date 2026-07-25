import test from "node:test";
import assert from "node:assert/strict";
import { getJobConfigurationState } from "../src/modules/jobs/services/jobRegistry.js";
import { listJobs, runJob } from "../src/modules/jobs/services/jobRunner.js";

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of keys) {
        const previousValue = previous.get(key);
        if (previousValue === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previousValue;
        }
      }
    });
}

test("facturas-native-sync queda como auth_required cuando faltan credenciales", async () => {
  await withEnv(
    {
      FACTURAS_CLUBFACTURA_USER: "",
      FACTURAS_CLUBFACTURA_PASSWORD: "",
      FACTURAS_CLUBFACTURA_BASE: "",
      FACTURAS_APPSHEET_API_KEY: "",
      FACTURAS_APPSHEET_APP_ID: "",
    },
    async () => {
      const configuration = getJobConfigurationState("facturas-native-sync");
      assert.equal(configuration.configured, false);
      assert.deepEqual(
        configuration.missingEnv.sort(),
        [
          "FACTURAS_APPSHEET_API_KEY",
          "FACTURAS_APPSHEET_APP_ID",
          "FACTURAS_CLUBFACTURA_BASE",
          "FACTURAS_CLUBFACTURA_PASSWORD",
          "FACTURAS_CLUBFACTURA_USER",
        ]
      );

      const jobs = listJobs();
      const facturasJob = jobs.find((job) => job.id === "facturas-native-sync");
      assert.ok(facturasJob);
      assert.equal(facturasJob.configured, false);
      assert.deepEqual(
        [...(facturasJob.missingEnv || [])].sort(),
        configuration.missingEnv.sort()
      );

      await assert.rejects(
        async () => runJob("facturas-native-sync"),
        /Faltan credenciales/i
      );
    }
  );
});
