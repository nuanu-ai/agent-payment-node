import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { keccak256, toHex } from "viem";
import { ApnCore } from "../../src/core.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { EVM_USDC } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const cases = [
  { chainId: 8453 as const, token: EVM_USDC[8453], preparePosts: 8, approvePosts: 15 },
  { chainId: 42161 as const, token: EVM_USDC[42161], preparePosts: 5, approvePosts: 11 },
];

for (const spec of cases) for (const adverse of [false, true]) test(`canonical ${spec.chainId} USDC full HTTPS ${adverse ? "post-sign refusal" : "prepare and approve"}`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  const wallet = await ensureDirectWallet(setup);
  const envelopes: string[][] = []; let sends = 0; let signed = 0;
  let gas = 65_000n; let changedPostSignHead = false;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      const envelope = JSON.parse(body) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
      const calls = Array.isArray(envelope) ? envelope : [envelope];
      envelopes.push(calls.map(call => call.method));
      const replies = calls.map(call => ({ jsonrpc: "2.0", id: call.id, result: answer(call.method, call.params) }));
      const raw = JSON.stringify(Array.isArray(envelope) ? replies.reverse() : replies[0]);
      queueMicrotask(() => {
        const response = new EventEmitter() as any; response.statusCode = 200;
        response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => { response.emit("end"); }; receive(response);
        response.emit("data", Buffer.from(raw)); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  function answer(method: string, params: readonly unknown[]): unknown {
    if (method === "eth_chainId") return toHex(spec.chainId);
    if (method === "eth_getBlockByNumber") return { number: "0x3039",
      hash: changedPostSignHead && params[0] !== "latest" ? `0x${"1".repeat(64)}` : EVM_BLOCK_HASH,
      baseFeePerGas: toHex(spec.chainId === 8453 ? 500_000_000n : 100n), transactions: [] };
    if (method === "eth_getBalance") { assert.equal(params[1], "0x3039"); return toHex(10n ** 18n); }
    if (method === "eth_getCode") { assert.equal((params[0] as string).toLowerCase(), spec.token.toLowerCase()); return "0x6000"; }
    if (method === "eth_call") {
      const call = params[0] as { to: string; data: string }; assert.equal(params[1], "0x3039");
      if (call.to.toLowerCase() === spec.token.toLowerCase())
        return toHex(call.data === "0x313ce567" ? 6n : 1_000_000n, { size: 32 });
      assert.equal(call.to.toLowerCase(), "0x420000000000000000000000000000000000000f");
      return toHex(3n, { size: 32 });
    }
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_estimateGas") return toHex(gas);
    if (method === "eth_maxPriorityFeePerGas") return toHex(1_000_000_000n);
    if (method === "eth_sendRawTransaction") { sends++; return keccak256(params[0] as `0x${string}`); }
    throw new Error(`unexpected ${method}`);
  }
  const rpc = new HttpsBaseRpc(`https://8.8.8.8/${spec.chainId}`, { directGuardState: setup.state });
  const core = new ApnCore({ state: setup.state, rpc, clock: setup.clock, native: { request: async request => {
    const result = await setup.local.request(request);
    if (request.operation === "directTransfer.approveAndSign") {
      signed++;
      if (adverse && spec.chainId === 42161) gas = 99_999n;
      if (adverse && spec.chainId === 8453) changedPostSignHead = true;
    }
    return result;
  } } });
  const prepared = await core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: spec.chainId, token: spec.token, decimals: 6 },
    amount: "0.1", idempotencyKey: `usdc-batch-${spec.chainId}` }) as { operation_id: string };
  assert.equal(envelopes.length, spec.preparePosts);
  assert.ok(envelopes.some(methods => methods.includes("eth_getCode") && methods.includes("eth_call")));
  if (adverse) {
    await assert.rejects(core.transfer.approve(prepared.operation_id),
      { code: spec.chainId === 42161 ? "APN_FEE_BUDGET_EXCEEDED" : "APN_RPC_PROTOCOL" });
    assert.equal(signed, 1); assert.equal(sends, 0);
    assert.equal((await setup.state.findOperation(prepared.operation_id))?.state, "signed_not_submitted");
    assert.ok(envelopes.length - spec.preparePosts < spec.approvePosts);
    return;
  }
  const approved = await core.transfer.approve(prepared.operation_id) as { state: string };
  assert.equal(approved.state, "submitted_pending"); assert.equal(signed, 1); assert.equal(sends, 1);
  assert.equal(envelopes.length - spec.preparePosts, spec.approvePosts);
  assert.deepEqual(envelopes.at(-1), ["eth_sendRawTransaction"]);
  assert.ok(!envelopes.some(methods => methods.includes("eth_getTransactionReceipt")));
  assert.ok(envelopes.slice(spec.preparePosts).every(methods => methods.length > 1 || methods[0] === "eth_sendRawTransaction"));
});
