import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Encoder } from "@solana/kit";
import { encodeFunctionData, parseAbi } from "viem";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { inspectCircleV2PreflightedDraft, type CircleV2DraftInput } from "../../src/lifi/circle-v2-draft.js";
import type { CircleV2PreflightTransport } from "../../src/lifi/circle-v2-preflight.js";
import { prepareCircleV2BaseSourceReadOnly, type CircleV2BaseState, type CircleV2SourcePreparationLimits } from "../../src/lifi/circle-v2-source-preparation.js";

const abi = parseAbi(["function depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes signedQuote,address refundAddress)) payable"]);
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wrapper = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const wallet = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
const refund = "0x000000000000000000000000000000000000dEaD";
const payer = "0x000000000000000000000000000000000000bEEF";
const quote = "0x01020304";
const hash = `0x${"a".repeat(64)}`;
const hook = "0x636374702d666f72776172640000000000000000000000000000000000000000";
async function fixture(): Promise<CircleV2DraftInput> {
  const recipient = `0x${Buffer.from(getBase58Encoder().encode(await associatedUsdc(wallet))).toString("hex")}` as `0x${string}`;
  const data = encodeFunctionData({ abi, functionName: "depositForBurnWithHookAndFees", args: [1_000_000n, 5, recipient, usdc, `0x${"0".repeat(64)}`, hook, { signedQuote: quote, refundAddress: refund }] });
  return { payer, quoteEndpoint: "https://iris-api.circle.com/v2/quote/burn/usdc/6/5",
    quoteRequest: { amount: "1000000", feeToken: usdc, requests: [{ type: "FORWARD", params: { hookData: hook } }] },
    quoteResponse: { signedQuote: quote, issuedAt: 1000, expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 100 }, feeTotalAmount: "20000", feeToken: usdc, nonce: "0",
      items: [{ type: "FORWARD", amount: "18000", args: [wrapper, "5", usdc, `0x${"0".repeat(64)}`, hook], argsHash: `0x${"1".repeat(64)}` },
        { type: "PROTOCOL", amount: "2000", args: [], argsHash: `0x${"2".repeat(64)}` }] },
    transaction: { from: payer, to: wrapper, chainId: 8453, valueAtomic: "0", refundAddress: refund, data },
    recipientWallet: wallet, amountAtomic: "1000000", maxSourceFeeAtomic: "25000", recipientSetup: "existing_ata" };
}
function harness(change?: (response: any) => void, options?: { reorg?: boolean; revert?: boolean; stale?: boolean }): CircleV2PreflightTransport {
  let reads = 0;
  return async request => {
    if (request.target === "circle") {
      const response = { signedQuote: quote, feeTotalAmount: "20000", feeToken: usdc, nonce: "0", claimable: true, failedChecks: [],
        expiry: { mode: "BLOCK_NUMBER", expired: false, secondsRemaining: 60, expiresAtBlock: 100 },
        items: [{ type: "FORWARD", argsMatch: true }, { type: "PROTOCOL", argsMatch: true }] };
      change?.(response);
      return response;
    }
    if (request.method === "eth_getBlockByNumber") {
      const after = reads++ > 0;
      return { number: "0x63", hash: after && options?.reorg ? `0x${"b".repeat(64)}` : hash,
        timestamp: options?.stale ? "0x1" : `0x${Math.floor(Date.now() / 1000).toString(16)}` };
    }
    if (options?.revert) throw Error("revert");
    return "0x";
  };
}

const fixedNow = Date.now();
const limits: CircleV2SourcePreparationLimits = { maxAllowanceAtomic: "1020000", maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000",
  maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", ttlMs: 60000 };
function state(change?: (value: CircleV2BaseState) => void): (query: any) => Promise<CircleV2BaseState> {
  return async query => {
    const value: CircleV2BaseState = { chainId: 8453, payer, draftBlockHash: hash, blockNumber: query.freshBlockNumber,
      blockHash: query.freshBlockHash, latestNonceAtomic: "7", pendingNonceAtomic: "7",
      usdcBalanceAtomic: "1020000", usdcAllowanceAtomic: "1020000", nativeBalanceWei: "200000000000000",
      gasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000" };
    change?.(value);
    return value;
  };
}
async function prepared(change?: (value: CircleV2BaseState) => void) {
  const draft = await inspectCircleV2PreflightedDraft(await fixture(), harness());
  return prepareCircleV2BaseSourceReadOnly(draft, harness(), state(change), limits, () => fixedNow);
}
test("freezes deterministic read-only EIP-1559 envelope and quote binding", async () => {
  const a = await prepared(), b = await prepared();
  assert.equal(a.preparationDigest, b.preparationDigest);
  assert.equal(a.executionAdmitted, false);
  assert.equal(a.quoteAuthenticityVerified, false);
  assert.equal(a.baseStateSourceVerified, false);
  assert.match(a.blockers.join(" "), /caller-controlled inputs or transports/);
  assert.match(a.blockers.join(" "), /BLOCK_NUMBER quote can expire sooner/);
  assert.equal(a.transaction.nonceAtomic, "7");
  assert.equal(a.requiredUsdcDebitAtomic, "1020000");
  assert.equal(a.maximumNativeDebitWei, "200000000000000");
  assert.equal(a.quote.feeToken, usdc);
  assert.equal(a.recipient.setup, "existing_ata");
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.transaction) && Object.isFrozen(a.quote));
  assert.ok(Object.isFrozen(a.blockers));
});
test("rejects endpoint outage, payer, nonce, allowance, balance, fee and gas drift", async () => {
  const draft = await inspectCircleV2PreflightedDraft(await fixture(), harness());
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, async () => { throw Error("offline"); }, state(), limits));
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(), async () => { throw Error("offline"); }, limits));
  for (const change of [
    (v: any) => { v.payer = refund; }, (v: any) => { v.pendingNonceAtomic = "8"; },
    (v: any) => { v.usdcAllowanceAtomic = "1000000"; }, (v: any) => { v.usdcBalanceAtomic = "1019999"; },
    (v: any) => { v.nativeBalanceWei = "199999999999999"; }, (v: any) => { v.gasLimitAtomic = "100001"; },
    (v: any) => { v.maxFeePerGasWei = "2000000001"; }, (v: any) => { v.blockHash = `0x${"b".repeat(64)}`; },
    (v: any) => { v.draftBlockHash = `0x${"b".repeat(64)}`; },
  ]) await assert.rejects(prepared(change), { code: "APN_PROVIDER_PROTOCOL" });
});
test("accepts a bounded approval above debit, but rejects allowance beyond the frozen cap", async () => {
  const draft = await inspectCircleV2PreflightedDraft(await fixture(), harness());
  const bounded = state(v => { (v as any).usdcBalanceAtomic = "1030000"; (v as any).usdcAllowanceAtomic = "1025000"; });
  const approved = await prepareCircleV2BaseSourceReadOnly(draft, harness(), bounded,
    { ...limits, maxAllowanceAtomic: "1025000" }, () => fixedNow);
  assert.equal(approved.requiredUsdcDebitAtomic, "1020000");
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(), bounded,
    { ...limits, maxAllowanceAtomic: "1024999" }), { code: "APN_PROVIDER_PROTOCOL" });
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(), bounded,
    { ...limits, maxAllowanceAtomic: ((1n << 256n) - 1n).toString() }), { code: "APN_PROVIDER_PROTOCOL" });
});
test("rejects changed signed quote, expiry, fee, recipient setup and calldata in draft", async () => {
  for (const change of [
    (v: any) => { v.quoteResponse.signedQuote = "0xbeef"; },
    (v: any) => { v.quoteResponse.expiry.expiresAtBlock = 101; },
    (v: any) => { v.quoteResponse.feeTotalAmount = "20001"; },
    (v: any) => { v.recipientSetup = "create_ata"; },
    (v: any) => { v.sourceTransaction.data = "0x"; },
  ]) {
    const draft: any = await inspectCircleV2PreflightedDraft(await fixture(), harness()); change(draft);
    await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(), state(), limits), { code: "APN_PROVIDER_PROTOCOL" });
  }
  const draft = await inspectCircleV2PreflightedDraft(await fixture(), harness());
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(undefined, { reorg: true }), state(), limits));
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(), state(), { ...limits, ttlMs: 1000 }));
});
test("rejects stale quote and gas prices in wrong units or beyond uint256 native debit", async () => {
  const draft = await inspectCircleV2PreflightedDraft(await fixture(), harness());
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(v => { v.expiry.expiresAtBlock = 99; }), state(), limits),
    { code: "APN_PROVIDER_PROTOCOL" });
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(), state(),
    { ...limits, maxFeePerGasWei: "2" }), { code: "APN_PROVIDER_PROTOCOL" });
  await assert.rejects(prepareCircleV2BaseSourceReadOnly(draft, harness(), state(v => { (v as any).maxFeePerGasWei = ((1n << 256n) - 1n).toString(); }),
    { ...limits, maxFeePerGasWei: ((1n << 256n) - 1n).toString(), maxNativeDebitWei: ((1n << 256n) - 1n).toString() }),
    { code: "APN_PROVIDER_PROTOCOL" });
});
