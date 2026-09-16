import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi } from "viem";
import { prepareCircleV2BaseUsdcApprovalReadOnly, type CircleV2ApprovalState } from "../../src/lifi/circle-v2-approval-preparation.js";

const payer = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const spender = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const input = { chainId: 8453 as const, payer, token, spender, approvalCapAtomic: "430000" };
const limits = { maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000",
  maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", ttlMs: 60000 };
const abi = parseAbi(["function approve(address spender,uint256 value) returns (bool)"]);
function reader(change?: (state: CircleV2ApprovalState) => void) {
  return async (query: any): Promise<CircleV2ApprovalState> => {
    assert.equal(query.data.slice(0, 10), "0x095ea7b3");
    const state: CircleV2ApprovalState = { chainId: 8453, payer, token, spender,
      blockNumber: "12345", blockHash: `0x${"a".repeat(64)}`, latestNonceAtomic: "7", pendingNonceAtomic: "7",
      usdcBalanceAtomic: "434611", usdcAllowanceAtomic: "0", nativeBalanceWei: "200000000000000",
      gasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000" };
    change?.(state);
    return state;
  };
}
test("freezes deterministic bounded unsigned approval intent with exact token and spender", async () => {
  const a = await prepareCircleV2BaseUsdcApprovalReadOnly(input, reader(), limits, () => 1_800_000_000_000);
  const b = await prepareCircleV2BaseUsdcApprovalReadOnly(input, reader(), limits, () => 1_800_000_000_000);
  assert.deepEqual(a, b);
  assert.equal(a.executionAdmitted, false);
  assert.equal(a.quoteIndicativeOnly, true);
  assert.equal(a.maximumNativeDebitWei, "200000000000000");
  assert.equal(a.transaction.to, token);
  assert.deepEqual(decodeFunctionData({ abi, data: a.transaction.data as `0x${string}` }).args, [spender, 430000n]);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.transaction) && Object.isFrozen(a.sourceBlock));
});
test("rejects wrong target, unbounded cap, nonce, balance, gas, and fee drift", async () => {
  for (const invalid of [
    { ...input, spender: payer }, { ...input, token: payer }, { ...input, chainId: 1 as 8453 },
    { ...input, approvalCapAtomic: ((1n << 256n) - 1n).toString() },
    { ...input, approvalCapAtomic: "1000001" }, { ...input, approvalCapAtomic: "434612" },
  ]) await assert.rejects(prepareCircleV2BaseUsdcApprovalReadOnly(invalid, reader(), limits), { code: "APN_PROVIDER_PROTOCOL" });
  for (const change of [
    (v: any) => { v.token = payer; }, (v: any) => { v.spender = payer; },
    (v: any) => { v.pendingNonceAtomic = "8"; }, (v: any) => { v.usdcBalanceAtomic = "429999"; },
    (v: any) => { v.usdcAllowanceAtomic = "430001"; }, (v: any) => { v.gasLimitAtomic = "100001"; },
    (v: any) => { v.maxFeePerGasWei = "2000000001"; },
    (v: any) => { v.nativeBalanceWei = "199999999999999"; },
  ]) await assert.rejects(prepareCircleV2BaseUsdcApprovalReadOnly(input, reader(change), limits), { code: "APN_PROVIDER_PROTOCOL" });
  await assert.rejects(prepareCircleV2BaseUsdcApprovalReadOnly(input, reader(), { ...limits, maxFeePerGasWei: "2" }),
    { code: "APN_PROVIDER_PROTOCOL" });
  await assert.rejects(prepareCircleV2BaseUsdcApprovalReadOnly(input, reader(v => {
    (v as any).maxFeePerGasWei = ((1n << 256n) - 1n).toString();
  }), { ...limits, maxFeePerGasWei: ((1n << 256n) - 1n).toString(), maxNativeDebitWei: ((1n << 256n) - 1n).toString() }),
  { code: "APN_PROVIDER_PROTOCOL" });
});
