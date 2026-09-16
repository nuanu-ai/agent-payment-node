import assert from "node:assert/strict";
import test from "node:test";
import { submitCircleV2BaseSourceBurn } from "../../src/lifi/circle-v2-source-execution.js";

/** A public caller can forge every structural port, including the claimed Circle and Base origin. */
test("forged Circle admission ports cannot reach an effect", async () => {
  let signs = 0, sends = 0, stages = 0;
  const forgedPorts = {
    freshDraft: async () => ({ quoteResponse: { signedQuote: "0x1234" } }),
    preflight: async () => ({ claimable: true, failedChecks: [] }),
    readBase: async () => ({ chainId: 8453 }),
    approve: async () => {},
    admitLive: async () => ({ kind: "circle_v2_live_transport_v1", circleOrigin: "https://iris-api.circle.com",
      rpcOrigin: "https://base.example.org", validationHash: "1".repeat(64) }),
    signer: { kind: "imported_evm_signer", signTransaction: async () => { signs++; return "0x1234"; } },
    sendRawTransaction: async () => { sends++; return "0x1234"; },
    journal: { stageLiveCircle: async () => { stages++; return {}; } },
  };
  await assert.rejects(submitCircleV2BaseSourceBurn({ payer: "0x000000000000000000000000000000000000bEEF" }, forgedPorts),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal(signs, 0); assert.equal(sends, 0); assert.equal(stages, 0);
});

import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import { BridgeHttps } from "../../src/lifi/https.js";
import { CircleV2SourceService } from "../../src/lifi/circle-v2-source-service.js";
import { TtyCircleV2SourceApproval } from "../../src/lifi/circle-v2-source-tty.js";
import { temporaryState } from "./helpers.js";

const key = `0x${"1".repeat(64)}` as const;
const payer = privateKeyToAccount(key).address;
const wallet = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wrapper = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const hook = "0x636374702d666f72776172640000000000000000000000000000000000000000";
const blockHash = `0x${"a".repeat(64)}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const quote = () => ({ signedQuote: "0x01020304", issuedAt: Math.floor(Date.now() / 1000),
  expiry: { mode: "BLOCK_NUMBER", expiresAtBlock: 110 }, feeTotalAmount: "20000", feeToken: usdc, nonce: "0",
  items: [{ type: "FORWARD", amount: "18000", args: [wrapper, "5", usdc, `0x${"0".repeat(64)}`, hook], argsHash: `0x${"1".repeat(64)}` },
    { type: "PROTOCOL", amount: "2000", args: [], argsHash: `0x${"2".repeat(64)}` }] });
const validation = () => ({ signedQuote: "0x01020304", feeTotalAmount: "20000", feeToken: usdc, nonce: "0",
  claimable: true, failedChecks: [], expiry: { mode: "BLOCK_NUMBER", expired: false, secondsRemaining: 60, expiresAtBlock: 110 },
  items: [{ type: "FORWARD", argsMatch: true }, { type: "PROTOCOL", argsMatch: true }] });
const request = { profile: "imported", expectedPayer: payer, recipientOwner: wallet, recipientSetup: "existing_ata" as const,
  amountAtomic: "1000000", maxSourceFeeAtomic: "25000", maxAllowanceAtomic: "1020000", maxGasLimitAtomic: "130000",
  maxFeePerGasWei: "3000000000", maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "300000000000000",
  idempotencyKey: "circle-one-shot-test" };
async function liveHarness(t: import("node:test").TestContext, ambiguous: boolean) {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const state = new StateStore(tmp.root), wrapping = { async load() { return Buffer.alloc(32, 7); }, async create() { return Buffer.alloc(32, 7); } };
  await state.initialize(); await new EncryptedWalletStore(state, wrapping).importNew("imported", key, payer);
  let sends = 0, approvals = 0;
  t.mock.method(TtyCircleV2SourceApproval.prototype, "approve", async () => { approvals++; });
  t.mock.method(BridgeHttps.prototype, "request", async (endpoint: string, _verb: string, body: string | null) => {
    if (endpoint.endsWith("/v2/quote/burn/usdc/6/5")) return { status: 200, body: JSON.stringify(quote()) };
    if (endpoint.endsWith("/v2/quote/validate/usdc/6")) return { status: 200, body: JSON.stringify(validation()) };
    const rpc = JSON.parse(body!); const { method, params, id } = rpc;
    if (method === "eth_sendRawTransaction") {
      sends++;
      if (ambiguous) throw Error("ambiguous send");
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result: keccak256(params[0]) }) };
    }
    const result = method === "eth_chainId" ? "0x2105" :
      method === "eth_getBlockByNumber" ? { number: "0x63", hash: blockHash, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, baseFeePerGas: "0x3b9aca00" } :
      method === "eth_getBalance" ? "0xde0b6b3a7640000" :
      method === "eth_getTransactionCount" ? "0x7" :
      method === "eth_estimateGas" ? "0x186a0" :
      method === "eth_maxPriorityFeePerGas" ? "0x5f5e100" :
      method === "eth_call" ? params[0].data.startsWith("0x70a08231") || params[0].data.startsWith("0xdd62ed3e") ? word(1_020_000n) :
        params[0].to.toLowerCase() === wrapper.toLowerCase() ? "0x" : word(0n) : null;
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result }) };
  });
  return { service: new CircleV2SourceService(state, wrapping, { APN_BASE_RPC_URL: "https://base.example.org" }),
    sends: () => sends, approvals: () => approvals };
}

for (const ambiguous of [false, true]) test(`concrete Circle effect makes one durable ${ambiguous ? "ambiguous" : "accepted"} send`, async t => {
  const h = await liveHarness(t, ambiguous);
  const result = await h.service.submit(request);
  assert.equal(result.sourceState, ambiguous ? "unknown_finality" : "submitted_pending");
  assert.equal(result.submissionAttempts, 1);
  assert.equal(result.bridgeCompletion, false);
  assert.equal(result.circleAttestationObserved, false);
  assert.equal(result.solanaDestinationFinalized, false);
  assert.equal(h.sends(), 1); assert.equal(h.approvals(), 1);
  await assert.rejects(h.service.submit(request));
  assert.equal(h.sends(), 1);
});
