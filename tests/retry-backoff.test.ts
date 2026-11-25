import assert from "node:assert/strict";
import test from "node:test";
import { backoffMs } from "../app/lib/inbox/backoff.ts";

const MINUTE = 60_000;

test("retries back off one minute, five, then fifteen", () => {
  assert.equal(backoffMs(0), 1 * MINUTE);
  assert.equal(backoffMs(1), 5 * MINUTE);
  assert.equal(backoffMs(2), 15 * MINUTE);
});

test("later attempts keep the longest wait instead of growing unbounded", () => {
  assert.equal(backoffMs(3), 15 * MINUTE);
  assert.equal(backoffMs(99), 15 * MINUTE);
});

test("a negative counter is treated like the first attempt", () => {
  assert.equal(backoffMs(-1), 1 * MINUTE);
});
