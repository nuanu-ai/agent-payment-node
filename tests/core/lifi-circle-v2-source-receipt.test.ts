import assert from "node:assert/strict";
import test from "node:test";
import { circleV2BurnTermsFromQuote } from "../../src/lifi/circle-v2-source-receipt.js";

test("standard FORWARD quote has zero CCTP maxFee and finalized threshold, separate from wrapper fee", () => {
  const terms = circleV2BurnTermsFromQuote({ items: [{ type: "FORWARD", amount: "134620" }], feeTotalAmount: "134620" });
  assert.deepEqual(terms, { maxFeeAtomic: "0", minFinalityThreshold: 2000 });
});
test("live standard quote rejects unsupported fee items and malformed fee totals", () => {
  for (const q of [
    { items: [{ type: "PROTOCOL", amount: "2" }], feeTotalAmount: "2" },
    { items: [{ type: "FORWARD", amount: "10" }, { type: "PROTOCOL", amount: "2" }], feeTotalAmount: "12" },
    { items: [{ type: "FORWARD", amount: "10" }, { type: "PRE_FINALITY", amount: "2" }], feeTotalAmount: "12" },
    { items: [{ type: "FORWARD", amount: "10" }], feeTotalAmount: "11" },
  ]) assert.throws(() => circleV2BurnTermsFromQuote(q));
});
