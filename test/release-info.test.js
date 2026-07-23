import test from "node:test";
import assert from "node:assert/strict";
import { getReleaseInfo } from "../src/services/releaseInfo.js";

test("release info prefers runtime environment variables", () => {
  const previousVersion = process.env.APP_RELEASE_VERSION;
  const previousSha = process.env.APP_BUILD_SHA;
  const previousBuiltAt = process.env.APP_BUILD_TIMESTAMP;

  process.env.APP_RELEASE_VERSION = "9.9.9";
  process.env.APP_BUILD_SHA = "abc123";
  process.env.APP_BUILD_TIMESTAMP = "2026-07-23T12:00:00Z";

  try {
    const info = getReleaseInfo();
    assert.equal(info.version, "9.9.9");
    assert.equal(info.commit, "abc123");
    assert.equal(info.buildAt, "2026-07-23T12:00:00Z");
    assert.equal(info.id, "9.9.9@abc123");
  } finally {
    if (previousVersion === undefined) delete process.env.APP_RELEASE_VERSION;
    else process.env.APP_RELEASE_VERSION = previousVersion;

    if (previousSha === undefined) delete process.env.APP_BUILD_SHA;
    else process.env.APP_BUILD_SHA = previousSha;

    if (previousBuiltAt === undefined) delete process.env.APP_BUILD_TIMESTAMP;
    else process.env.APP_BUILD_TIMESTAMP = previousBuiltAt;
  }
});

