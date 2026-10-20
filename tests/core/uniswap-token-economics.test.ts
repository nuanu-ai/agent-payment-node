/** QA 0.5.51 follow-up: the token-input Uniswap lane's observed result carries the same shared swap economics. */
import assert from "node:assert/strict";
import test from "node:test";
import { executeUniswapCommand } from "../../src/swap/uniswap-command-service.js";

const receipt = { schemaVersion: "apn.uniswap-token-receipt.v1", operationId: "a".repeat(64), approvalGasWei: "1112215830000", swapGasWei: "5442759839880",
  cleanupGasWei: "0", nativeDebitWei: "6554975669880", inputDebitAtomic: "1000000", outputCreditAtomic: "999741", residualAllowanceAtomic: "0",
  transactionHash: `0x${"b".repeat(64)}`, observedAt: "2026-10-19T10:00:00.000Z", receiptHash: "c".repeat(64) };

for (const [phase, value] of [["observed", receipt], ["swap_submitted", null]] as const) test(`token lane ${phase}: actualEconomics is ${value === null ? "null" : "the receipt's own facts"}`, async () => {
  const record = { operationId: "a".repeat(64), phase, receipt: value };
  const runtime = { status: async () => record };
  const outcome = await executeUniswapCommand({ command: "swap.uniswap-token.status", operationId: record.operationId }, { uniswapTokenRuntime: runtime } as never);
  assert.equal(outcome.receipt, value, "the lane's own receipt is returned unchanged");
  assert.deepEqual((outcome.operation as Record<string, unknown>).actualEconomics, value === null ? null : { inputAtomic: "1000000",
    outputAtomic: "999741", networkFeeAtomic: "6554975669880", nativeDebitAtomic: "6554975669880" });
});
