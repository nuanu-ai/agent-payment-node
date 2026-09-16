import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Encoder } from "@solana/kit";
import { encodeFunctionData, parseAbi } from "viem";
import { associatedUsdc } from "../../src/solana/accounts.js";
import { inspectCircleV2Preflight, type CircleV2PreflightInput, type CircleV2PreflightTransport } from "../../src/lifi/circle-v2-preflight.js";

const abi = parseAbi(["function depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes signedQuote,address refundAddress)) payable"]);
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wrapper = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const wallet = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
const refund = "0x000000000000000000000000000000000000dEaD";
const payer = "0x000000000000000000000000000000000000bEEF";
const zero = `0x${"0".repeat(64)}`;
const hook = "0x636374702d666f72776172640000000000000000000000000000000000000000";
const quote = "0x01020304";
const blockHash = `0x${"a".repeat(64)}`;
async function fixture(): Promise<CircleV2PreflightInput> {
  const recipient = `0x${Buffer.from(getBase58Encoder().encode(await associatedUsdc(wallet))).toString("hex")}` as `0x${string}`;
  const data = encodeFunctionData({ abi, functionName: "depositForBurnWithHookAndFees", args: [1_000_000n, 5, recipient, usdc, zero as `0x${string}`, hook, { signedQuote: quote, refundAddress: refund }] });
  return { payer, quoteEndpoint: "https://iris-api.circle.com/v2/quote/burn/usdc/6/5",
    quoteRequest: { amount: "1000000", feeToken: usdc, requests: [{ type: "FORWARD", params: { hookData: hook } }] },
    quoteResponse: { signedQuote: quote, issuedAt: 1000, expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 100 }, feeTotalAmount: "20000", feeToken: usdc, nonce: "0",
      items: [{ type: "FORWARD", amount: "18000", args: [wrapper, "5", usdc, zero, hook], argsHash: `0x${"1".repeat(64)}` },
        { type: "PROTOCOL", amount: "2000", args: [], argsHash: `0x${"2".repeat(64)}` }] },
    transaction: { to: wrapper, chainId: 8453, valueAtomic: "0", refundAddress: refund, data },
    recipientWallet: wallet, amountAtomic: "1000000", maxSourceFeeAtomic: "25000", recipientSetup: "existing_ata" };
}
function harness(change?: (response: Record<string, any>, request: any) => void,
  options?: { stale?: boolean; sameHeightReorg?: boolean; staleTimestamp?: boolean; unavailable?: boolean; revert?: boolean; rpcError?: boolean }) {
  const calls: any[] = [];
  let blockReads = 0;
  const timestamp = `0x${Math.floor(Date.now() / 1000).toString(16)}`;
  const transport: CircleV2PreflightTransport = async request => {
    calls.push(request);
    if (request.target === "circle") {
      if (options?.unavailable) throw Error("503");
      const response: Record<string, any> = { signedQuote: quote, feeTotalAmount: "20000", feeToken: usdc, nonce: "0", claimable: true, failedChecks: [],
        expiry: { mode: "BLOCK_NUMBER", expired: false, secondsRemaining: 60, expiresAtBlock: 100 },
        items: [{ type: "FORWARD", argsMatch: true, amount: "18000", args: [wrapper, "5", usdc, zero, hook], argsHash: `0x${"1".repeat(64)}` },
          { type: "PROTOCOL", argsMatch: true, amount: "2000", args: [], argsHash: `0x${"2".repeat(64)}` }] };
      change?.(response, request);
      return response;
    }
    if (request.method === "eth_getBlockByNumber") {
      if (options?.rpcError) throw Error("RPC unavailable");
      const later = blockReads++ > 0;
      return { number: options?.stale && later ? "0x64" : "0x63",
        hash: options?.sameHeightReorg && later ? `0x${"b".repeat(64)}` : blockHash,
        timestamp: options?.staleTimestamp ? "0x1" : timestamp };
    }
    if (options?.revert) throw Error("revert");
    return "0x";
  };
  return { transport, calls };
}
test("validates exact frozen call and simulates it from payer at one Base block", async () => {
  const { transport, calls } = harness();
  const input = await fixture();
  const result = await inspectCircleV2Preflight(input, transport);
  assert.equal(result.executionAdmitted, false);
  assert.equal(result.blockNumber, "99");
  assert.equal(result.blockHash, blockHash);
  assert.equal(calls[0].url, "https://iris-api.circle.com/v2/quote/validate/usdc/6");
  assert.equal(calls[0].body.args[0], "1000000");
  assert.deepEqual(calls[0].body.args[6], [quote, refund]);
  assert.deepEqual(calls[2].params, [{ from: payer, to: wrapper, data: (input.transaction as any).data.toLowerCase(), value: "0x0" },
    { blockHash, requireCanonical: true }]);
});
test("accepts the SDK's sparse claimable item response", async () => {
  const { transport } = harness(v => { v.items = [{ type: "FORWARD", argsMatch: true }, { type: "PROTOCOL", argsMatch: true }]; });
  assert.equal((await inspectCircleV2Preflight(await fixture(), transport)).executionAdmitted, false);
});
test("fails closed on Circle rejection or mismatched signed fields, items, and arguments", async () => {
  for (const change of [
    (v: any) => { v.claimable = false; },
    (v: any) => { v.failedChecks = ["ARGS_HASH_MISMATCH"]; },
    (v: any) => { v.signedQuote = "0xdead"; },
    (v: any) => { v.feeTotalAmount = "20001"; },
    (v: any) => { v.expiry.expiresAtBlock = 101; },
    (v: any) => { v.items[0].argsMatch = false; },
    (v: any) => { v.items[0].args = ["0xdead"]; },
  ]) await assert.rejects(inspectCircleV2Preflight(await fixture(), harness(change).transport), { code: "APN_PROVIDER_PROTOCOL" });
});
test("fails closed on unavailable endpoint, RPC error, revert, stale block, and same-height reorg", async () => {
  for (const options of [{ unavailable: true }, { rpcError: true }, { revert: true }, { stale: true },
    { sameHeightReorg: true }, { staleTimestamp: true }]) {
    await assert.rejects(inspectCircleV2Preflight(await fixture(), harness(undefined, options).transport), { code: "APN_PROVIDER_PROTOCOL" });
  }
});
test("rejects transaction arguments that differ from the frozen quote", async () => {
  const input = await fixture();
  const tx = input.transaction as { data: string };
  tx.data = tx.data.replace(/^0x[0-9a-fA-F]{8}/u, "0x00000000");
  await assert.rejects(inspectCircleV2Preflight(input, harness().transport), { code: "APN_PROVIDER_PROTOCOL" });
});
