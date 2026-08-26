import assert from "node:assert/strict";
import test from "node:test";
import { formatAtomic, parseAtomic, parseDecimal } from "../../src/money.js";

test("money codec accepts only canonical exact strings", () => {
  assert.deepEqual(parseDecimal("1.25", 6, { positive: true }), { atomic: "1250000", decimal: "1.25" });
  assert.equal(formatAtomic("1250000", 6), "1.25");
  assert.equal(parseAtomic("0"), 0n);
  for (const value of [1, "1.0", "01", "+1", "-1", "1e2", "1,000", "NaN", "0.0000001", "0"]) {
    assert.throws(() => parseDecimal(value, 6, { positive: true }));
  }
  for (const value of [1, "01", "+1", "-1", "1e2", "1.0", "NaN"]) {
    assert.throws(() => parseAtomic(value));
  }
});
