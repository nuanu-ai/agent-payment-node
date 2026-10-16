import assert from "node:assert/strict";
import test from "node:test";
import { evmFrozenFeeAdmitted } from "../../src/evm-fee-admission.js";

const envelope = { maxFeePerGasWei: 2_000n, maxPriorityFeePerGasWei: 100n };

test("a frozen envelope stays admitted while a risen base fee still fits under its signed maximum", () => {
  // Prepared at base 950: 2 × 950 + 100. The old rule refused any base above 950.
  assert.equal(evmFrozenFeeAdmitted(950n, envelope), true);
  assert.equal(evmFrozenFeeAdmitted(1_400n, envelope), true);
  assert.equal(evmFrozenFeeAdmitted(1_900n, envelope), true);
});

test("a frozen envelope that cannot be included now is refused", () => {
  assert.equal(evmFrozenFeeAdmitted(1_901n, envelope), false);
  assert.equal(evmFrozenFeeAdmitted(5_000n, envelope), false);
});

test("malformed fee fields are refused", () => {
  assert.equal(evmFrozenFeeAdmitted(-1n, envelope), false);
  assert.equal(evmFrozenFeeAdmitted(1n, { maxFeePerGasWei: 0n, maxPriorityFeePerGasWei: 0n }), false);
  assert.equal(evmFrozenFeeAdmitted(1n, { maxFeePerGasWei: 10n, maxPriorityFeePerGasWei: 11n }), false);
  assert.equal(evmFrozenFeeAdmitted(1n, { maxFeePerGasWei: 10n, maxPriorityFeePerGasWei: -1n }), false);
});
