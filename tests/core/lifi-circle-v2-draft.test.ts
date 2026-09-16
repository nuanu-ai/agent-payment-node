import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Encoder } from "@solana/kit";
import { encodeFunctionData, parseAbi } from "viem";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { inspectCircleV2PreflightedDraft, type CircleV2DraftInput } from "../../src/lifi/circle-v2-draft.js";
import type { CircleV2PreflightTransport } from "../../src/lifi/circle-v2-preflight.js";

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
test("produces a deterministic non-executable draft bound to quote, payer, calldata, ATA, fee, and fresh Base hash", async () => {
  const input = await fixture();
  const a = await inspectCircleV2PreflightedDraft(input, harness());
  const b = await inspectCircleV2PreflightedDraft(input, harness());
  assert.equal(a.integrityDigest, b.integrityDigest);
  assert.equal(a.state, "preflighted_unsubmitted");
  assert.equal(a.executionAdmitted, false);
  assert.equal(a.sourcePayer, payer);
  assert.equal(a.sourceTransaction.data, (input.transaction as { data: string }).data.toLowerCase());
  assert.equal(a.preflight.blockHash, hash);
  assert.equal(a.amountAtomic, "1000000");
  assert.equal(a.quotedFeeAtomic, "20000");
  assert.equal(a.maxSourceFeeAtomic, "25000");
  assert.equal(a.recipientAta, await associatedUsdc(wallet));
  assert.equal(a.blockers.length, 4);
  assert.deepEqual(a.quoteRequest, input.quoteRequest);
  assert.deepEqual(a.quoteResponse, input.quoteResponse);
});
test("binds all supplied quote fields, payer, and fee ceiling in digest", async () => {
  const original = await fixture();
  const base = await inspectCircleV2PreflightedDraft(original, harness());
  const quote = await fixture();
  (quote.quoteResponse as any).opaqueProviderField = "changed";
  assert.notEqual((await inspectCircleV2PreflightedDraft(quote, harness())).integrityDigest, base.integrityDigest);
  const ceiling = await fixture();
  (ceiling as any).maxSourceFeeAtomic = "25001";
  assert.notEqual((await inspectCircleV2PreflightedDraft(ceiling, harness())).integrityDigest, base.integrityDigest);
});
test("rejects payer, signed quote, fee, calldata, executable flags, stale and reverted preflight", async () => {
  const mutate = async (change: (value: any) => void) => {
    const value = await fixture(); change(value);
    await assert.rejects(inspectCircleV2PreflightedDraft(value, harness()), { code: "APN_PROVIDER_PROTOCOL" });
  };
  await mutate(v => { v.transaction.from = refund; });
  await mutate(v => { v.quoteResponse.signedQuote = "0xdead"; });
  await mutate(v => { v.quoteResponse.feeTotalAmount = "25001"; });
  await mutate(v => { v.transaction.data = `0x00000000${v.transaction.data.slice(10)}`; });
  await mutate(v => { v.executable = true; });
  await mutate(v => { v.transaction.executable = true; });
  await assert.rejects(inspectCircleV2PreflightedDraft(await fixture(), harness(v => { v.claimable = false; })), { code: "APN_PROVIDER_PROTOCOL" });
  for (const options of [{ stale: true }, { reorg: true }, { revert: true }])
    await assert.rejects(inspectCircleV2PreflightedDraft(await fixture(), harness(undefined, options)), { code: "APN_PROVIDER_PROTOCOL" });
});
