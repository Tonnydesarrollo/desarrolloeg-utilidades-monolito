import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function evaluateBypass(appEnvironment) {
  const source = `
    import('./src/modules/home/portalAuth.service.js').then((module) => {
      const hosts = ['localhost:7001', '127.0.0.1:7001', '[::1]:7001', 'apps.desarrolloeg.com'];
      console.log(JSON.stringify(hosts.map((host) => module.isDevelopmentAuthBypassRequest({ headers: { host } }))));
    });
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      APP_ENVIRONMENT: appEnvironment,
      PORTAL_DEV_AUTH_BYPASS: "1",
      PORTAL_AUTH_SECRET: "development-auth-test-secret",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test("el bypass de login solo admite hosts locales en desarrollo", () => {
  assert.deepEqual(evaluateBypass("dev"), [true, true, true, false]);
});

test("el bypass de login permanece desactivado en produccion", () => {
  assert.deepEqual(evaluateBypass("prod"), [false, false, false, false]);
});
