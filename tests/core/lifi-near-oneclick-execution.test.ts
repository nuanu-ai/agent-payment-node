import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, pad } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import { BridgeHttps } from "../../src/lifi/https.js";
import { OneClickSourceService, TtyOneClickSourceApproval } from "../../src/lifi/near-oneclick-source-service.js";
import { temporaryState } from "./helpers.js";

const key = `0x${"1".repeat(64)}` as const;
const payer = privateKeyToAccount(key).address;
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const deposit = "0x76b4c56085ED136a8744D52bE956396624a730E8";
const recipient = "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF";
const blockHash = `0x${"a".repeat(64)}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const request = { profile: "imported", expectedPayer: payer, recipient, amountAtomic: "3000000",
  minOutputAtomic: "1000000", maxQuotedLossAtomic: "2000000", maxGasLimitAtomic: "130000",
  maxFeePerGasWei: "3000000000", maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "300000000000000",
  idempotencyKey: "oneclick-once-test" };

async function harness(t: import("node:test").TestContext, sendAmbiguous = false, allowConsent = true, onApprove?: () => void) {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const state = new StateStore(tmp.root), wrapping = { async load() { return Buffer.alloc(32, 7); }, async create() { return Buffer.alloc(32, 7); } };
  await state.initialize(); await new EncryptedWalletStore(state, wrapping).importNew("imported", key, payer);
  let sends = 0, approvals = 0, nonce = 7n, actualQuote: unknown, transactionHash: string | null = null, badLog = false, badMembership = false;
  if (allowConsent) t.mock.method(TtyOneClickSourceApproval.prototype, "approve", async () => { approvals++; onApprove?.(); });
  t.mock.method(BridgeHttps.prototype, "request", async (endpoint: string, verb: string, body: string | null) => {
    if (endpoint === "https://1click.chaindefuser.com/v0/quote") {
      const quoteRequest = JSON.parse(body!);
      const quote = { amountIn: "3000000", minAmountIn: "2800000", amountOut: "1264167", minAmountOut: "1251525",
        deadline: new Date(Date.now() + 86_400_000).toISOString(), ...(quoteRequest.dry ? {} : { depositAddress: deposit, depositMemo: null }) };
      const response = { quoteRequest, quote };
      if (!quoteRequest.dry) actualQuote = response;
      return { status: 201, body: JSON.stringify(response) };
    }
    if (endpoint.startsWith("https://1click.chaindefuser.com/v0/status"))
      return { status: 200, body: JSON.stringify({ quoteResponse: actualQuote, status: "SUCCESS" }) };
    assert.equal(verb, "POST");
    const rpc = JSON.parse(body!), { method, params, id } = rpc;
    if (method === "eth_sendRawTransaction") {
      sends++; transactionHash = keccak256(params[0]);
      if (sendAmbiguous) throw Error("ambiguous send");
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result: transactionHash }) };
    }
    if (method === "eth_getTransactionReceipt") {
      const log = { address: usdc, topics: [keccak256(Buffer.from("Transfer(address,address,uint256)")),
        pad(payer as `0x${string}`).toLowerCase(), pad(deposit as `0x${string}`).toLowerCase()], data: word(badLog ? 1n : 3_000_000n), transactionHash,
        blockHash };
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result: { transactionHash, to: usdc,
        from: payer, blockNumber: "0x63", blockHash, transactionIndex: "0x0", status: "0x1", logs: [log] } }) };
    }
    const result = method === "eth_chainId" ? "0x2105" :
      method === "eth_getBlockByNumber" ? { number: "0x63", hash: blockHash, baseFeePerGas: "0x3b9aca00",
        transactions: transactionHash === null ? [] : [badMembership ? `0x${"f".repeat(64)}` : transactionHash] } :
      method === "eth_getBalance" ? "0xde0b6b3a7640000" :
      method === "eth_getTransactionCount" ? `0x${nonce.toString(16)}` :
      method === "eth_estimateGas" ? "0x186a0" :
      method === "eth_maxPriorityFeePerGas" ? "0x5f5e100" :
      method === "eth_call" ? params[0].data.startsWith("0x70a08231") ? word(3_200_000n) :
        params[0].to.toLowerCase() === usdc.toLowerCase() ? word(1n) : word(0n) : null;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result }) };
  });
  return { service: new OneClickSourceService(state, wrapping, { APN_BASE_RPC_URL: "https://base.example.org" }),
    sends: () => sends, approvals: () => approvals, changeNonce: () => { nonce = 8n; },
    badLog: () => { badLog = true; }, badMembership: () => { badMembership = true; } };
}

for (const ambiguous of [false, true]) test(`concrete 1Click service makes one ${ambiguous ? "ambiguous" : "accepted"} send`, async t => {
  const h = await harness(t, ambiguous);
  const result = await h.service.submit(request) as any;
  assert.equal(result.sourceState, ambiguous ? "unknown_finality" : "submitted_pending");
  assert.equal(result.submissionAttempts, 1); assert.equal(result.tronDestinationDelivered, false);
  assert.equal(h.sends(), 1); assert.equal(h.approvals(), 1);
  await assert.rejects(h.service.submit(request)); assert.equal(h.sends(), 1);
});
test("post-consent nonce drift fails before signing or sending", async t => {
  const h = await harness(t, false, true, () => h.changeNonce());
  await assert.rejects(h.service.submit(request), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(h.sends(), 0);
});
test("forged constructor approval argument cannot bypass concrete TTY consent", async t => {
  const h = await harness(t, false, false);
  t.mock.method(TtyOneClickSourceApproval.prototype, "approve", async () => { throw Error("real consent required"); });
  const forged = new (OneClickSourceService as any)((h.service as any).state, (h.service as any).wrapping,
    { APN_BASE_RPC_URL: "https://base.example.org" }, new BridgeHttps(), Date.now, async () => {});
  await assert.rejects(forged.submit(request), /real consent required/u);
  assert.equal(h.sends(), 0);
});
test("source receipt and provider SUCCESS remain separate from independent TRON finality", async t => {
  const h = await harness(t);
  const submitted = await h.service.submit(request) as any;
  const observed = await h.service.status(submitted.operationId) as any;
  assert.equal(observed.sourceReceipt.safe, true);
  assert.equal(observed.sourceReceipt.status, "success");
  assert.equal(observed.tronDestinationClaimed, true);
  assert.equal(observed.tronDestinationFinalized, false);
});

test("safe Base source status rejects altered Transfer amount and block membership", async t => {
  const h = await harness(t);
  const submitted = await h.service.submit(request) as any;
  h.badLog();
  await assert.rejects(h.service.status(submitted.operationId), { code: "APN_OPERATION_BLOCKED" });
  h.badMembership();
  await assert.rejects(h.service.status(submitted.operationId), { code: "APN_OPERATION_BLOCKED" });
});
