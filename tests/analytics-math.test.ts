import assert from "node:assert/strict";
import test from "node:test";
import { median } from "../app/lib/analytics/math.ts";

test("an empty list has no median rather than a fake zero", () => {
  assert.equal(median([]), null);
});

test("odd counts take the middle value", () => {
  assert.equal(median([4]), 4);
  assert.equal(median([9, 1, 5]), 5);
});

test("even counts average the two middle values", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([10, 2]), 6);
});

test("the input order does not change the result", () => {
  assert.equal(median([5, 1, 3, 9, 7]), 5);
  assert.equal(median([9, 7, 5, 3, 1]), 5);
});
