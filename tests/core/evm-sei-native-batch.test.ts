import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { toHex } from "viem";
import { resolveEvmAsset } from "../../src/evm-asset.js";
import { EvmRpc } from "../../src/evm-rpc.js";
import { checkEvmTransferFunding } from "../../src/evm-transfer-approval.js";
import type { OperationRecord } from "../../src/model.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import { EVM_BLOCK_HASH } from "./evm-helpers.js";
import { RECIPIENT, WALLET, temporaryState } from "./helpers.js";

const selection = { chainId: 1329 as const, token: "native" as const, decimals: 18 };
const transaction = { chainId: 1329 as const, from: WALLET, to: RECIPIENT, valueAtomic: "1", data: "0x" as const };
const block = { number: "0x3039", hash: EVM_BLOCK_HASH, baseFeePerGas: "0x7", transactions: [] };
const fundingOperation = {
  chainId: 1329, walletAddress: WALLET, recipient: RECIPIENT, amountAtomic: "1",
  economics: { nonceAtomic: "7", gasLimitAtomic: "21000", maxFeePerGasAtomic: "23",
    maxPriorityFeePerGasAtomic: "9", maximumGasCostAtomic: "483000" },
  evm: { asset: resolveEvmAsset(selection), maxFeeWei: "1000000000000000" },
} as unknown as OperationRecord;

function answer(method: string, params: readonly unknown[], reorg = false): unknown {
  if (method === "eth_chainId") return toHex(1329);
  if (method === "eth_getBlockByNumber") return reorg && params[0] === block.number ? { ...block, hash: `0x${"1".repeat(64)}` } : block;
  if (method === "eth_getBalance") { assert.equal(params[1], block.number); return toHex(10n ** 18n); }
  if (method === "eth_getTransactionCount") return "0x7";
  if (method === "eth_estimateGas") return "0x5208";
  if (method === "eth_maxPriorityFeePerGas") return "0x9";
  throw new Error(`Unexpected ${method}`);
}

test("Sei native prepare makes 17 logical reads in 8 HTTPS batch POSTs with reversed response IDs", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const bodies: { id: number; method: string; params: unknown[] }[][] = [];
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      const batch = JSON.parse(body) as { id: number; method: string; params: unknown[] }[];
      assert.ok(Array.isArray(batch), "Sei native prepare requires grouped reads");
      bodies.push(batch);
      const raw = JSON.stringify(batch.map(item => ({ jsonrpc: "2.0", id: item.id, result: answer(item.method, item.params) })).reverse());
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
  const rpc = new HttpsBaseRpc("https://8.8.8.8/sei", { directGuardState: state }); rpc.armEvmDirectRpcGuard();
  const reads = rpc.evm.prepareSeiNative();
  const balance = await reads.balance(WALLET, selection);
  const { nonce, estimated } = await reads.nonceEstimate(WALLET, transaction);
  const quote = await reads.feeQuote({ nonceAtomic: nonce, ...estimated,
    maximumGasCostAtomic: (BigInt(estimated.gasLimitAtomic) * BigInt(estimated.maxFeePerGasAtomic)).toString() });
  assert.equal(bodies.length, 8);
  assert.equal(bodies.flat().length, 17);
  assert.equal(bodies[0]?.[1]?.params[0], "safe");
  assert.equal(balance.blockHash, EVM_BLOCK_HASH);
  assert.equal(estimated.maxFeePerGasAtomic, "23");
  assert.equal(quote.chainId, 1329); assert.equal(quote.l1DataFeeUpperWei, "0");
});

test("Sei approval and pre-send funding use 8 then 5 grouped HTTPS POSTs without scalar fallback", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const bodies: { id: number; method: string; params: unknown[] }[][] = [];
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      const batch = JSON.parse(body) as { id: number; method: string; params: unknown[] }[];
      assert.ok(Array.isArray(batch), "Sei funding must never issue a scalar POST");
      bodies.push(batch);
      const raw = JSON.stringify(batch.map(item => ({ jsonrpc: "2.0", id: item.id, result: answer(item.method, item.params) })).reverse());
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
  const rpc = new HttpsBaseRpc("https://8.8.8.8/sei", { directGuardState: state });
  await checkEvmTransferFunding(rpc, fundingOperation, true);
  assert.equal(bodies.length, 8);
  assert.equal(bodies.flat().length, 17);
  await checkEvmTransferFunding(rpc, fundingOperation, false);
  assert.equal(bodies.length, 13);
  assert.equal(bodies.slice(8).flat().length, 9);
});

test("Sei resume superseding scan stops at the guarded 24 physical HTTPS POST cap", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let posts = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      posts += 1;
      const call = JSON.parse(body) as { id: string; method: string; params: unknown[] };
      assert.ok(!Array.isArray(call));
      const result = call.method === "eth_getBlockByNumber" && call.params[0] !== "safe"
        ? { ...block, number: call.params[0], transactions: [] }
        : answer(call.method, call.params);
      const raw = JSON.stringify({ jsonrpc: "2.0", id: call.id, result });
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
  const rpc = new HttpsBaseRpc("https://8.8.8.8/sei", { directGuardState: state }); rpc.armEvmDirectRpcGuard();
  await assert.rejects(rpc.evm.confirmedAtNonce(1329, WALLET, "7", "0"), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(posts, 24);
});

test("Sei grouped reads fail closed on reorg and wrong chain without scalar fallback", async () => {
  for (const scenario of ["reorg", "chain"] as const) {
    let posts = 0, scalar = 0;
    const rpc = new EvmRpc(async () => { scalar += 1; throw Error("scalar fallback"); }, "https://rpc.example", undefined, async calls => {
      posts += 1;
      return calls.map(({ method, params }) => scenario === "chain" && method === "eth_chainId" ? "0x1" : answer(method, params, scenario === "reorg"));
    });
    await assert.rejects(rpc.prepareSeiNative().balance(WALLET, selection),
      { code: scenario === "chain" ? "APN_CHAIN_MISMATCH" : "APN_RPC_PROTOCOL" });
    assert.equal(scalar, 0); assert.ok(posts <= 3);
  }
});

test("Sei HTTPS rejects a substituted batch response ID without another POST", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let posts = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      posts += 1;
      const batch = JSON.parse(body) as { id: number; method: string; params: unknown[] }[];
      assert.ok(Array.isArray(batch));
      const raw = JSON.stringify(batch.map(item => ({ jsonrpc: "2.0", id: item.id + 1000, result: answer(item.method, item.params) })));
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
  const rpc = new HttpsBaseRpc("https://8.8.8.8/sei", { directGuardState: state }); rpc.armEvmDirectRpcGuard();
  await assert.rejects(rpc.evm.prepareSeiNative().balance(WALLET, selection), { code: "APN_RPC_PROTOCOL" });
  assert.equal(posts, 1);
});

for (const status of [429, 403]) test(`Sei HTTPS batch HTTP ${status} ends after one POST`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let posts = 0;
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    posts += 1;
    const request = new EventEmitter() as any; request.setTimeout = () => request;
    request.end = (body: string) => {
      assert.ok(Array.isArray(JSON.parse(body)));
      queueMicrotask(() => {
        const response = new EventEmitter() as any; response.statusCode = status;
        response.headers = { "content-length": "0" };
        response.resume = () => { response.emit("end"); }; receive(response); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const rpc = new HttpsBaseRpc("https://8.8.8.8/sei", { directGuardState: state }); rpc.armEvmDirectRpcGuard();
  await assert.rejects(rpc.evm.prepareSeiNative().balance(WALLET, selection),
    { code: status === 429 ? "APN_RPC_RATE_LIMITED" : "APN_RPC_PROTOCOL" });
  assert.equal(posts, 1);
});
