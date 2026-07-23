import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlaneacionMonthFromCsv } from "../src/modules/planeacion/services/appsheet.js";

test("normalizePlaneacionMonthFromCsv preserves 1-based months", () => {
  assert.equal(normalizePlaneacionMonthFromCsv("1"), 1);
  assert.equal(normalizePlaneacionMonthFromCsv("3"), 3);
  assert.equal(normalizePlaneacionMonthFromCsv("12"), 12);
});

test("normalizePlaneacionMonthFromCsv rejects invalid month values", () => {
  assert.equal(normalizePlaneacionMonthFromCsv("0"), null);
  assert.equal(normalizePlaneacionMonthFromCsv("13"), null);
  assert.equal(normalizePlaneacionMonthFromCsv("-1"), null);
  assert.equal(normalizePlaneacionMonthFromCsv("abc"), null);
  assert.equal(normalizePlaneacionMonthFromCsv("2.5"), null);
  assert.equal(normalizePlaneacionMonthFromCsv(""), null);
});
