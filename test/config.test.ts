import assert from "node:assert/strict";
import { test } from "node:test";
import { clampInt, DEFAULT_HISTORY_DAYS, parseHistoryDays } from "../src/config.ts";

test("history days accept only offered choices", () => {
  assert.equal(parseHistoryDays(90), 90);
  assert.equal(parseHistoryDays(730), 730);
  assert.equal(parseHistoryDays(9999), DEFAULT_HISTORY_DAYS);
  assert.equal(parseHistoryDays("90"), DEFAULT_HISTORY_DAYS);
  assert.equal(parseHistoryDays(undefined), DEFAULT_HISTORY_DAYS);
});

test("clampInt", () => {
  assert.equal(clampInt("500", 60, 3600, 180), 500);
  assert.equal(clampInt("10", 60, 3600, 180), 60);
  assert.equal(clampInt("abc", 60, 3600, 180), 180);
  assert.equal(clampInt(undefined, 60, 3600, 180), 180);
});
