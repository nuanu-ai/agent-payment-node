import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import { HttpsBaseRpc, parseRpcBatchResultEnvelope } from "../../src/rpc.js";
import { RelayNativeSourceRuntime } from "../../src/relay/native-source.js";
import type { RelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { StateStore } from "../../src/state.js";
import { RECIPIENT, WALLET, temporaryState } from "./helpers.js";

const secret = "private-rpc-url-token";
const endpoint = `https://8.8.8.8/${secret}?key=${secret}`;
const read = [{ method: "eth_chainId", params: [] }, { method: "eth_getBalance", params: ["0xabc", "latest"] }];

function mockHttps(t: TestContext, responder: (body: any) => { status: number; raw: string }) {
  const bodies: string[] = [];
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any;
    request.setTimeout = () => request;
    request.end = (body: string) => {
      bodies.push(body);
      queueMicrotask(() => {
        const { status, raw } = responder(JSON.parse(body));
        const response = new EventEmitter() as any;
        response.statusCode = status;
        response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => { response.emit("end"); };
        receive(response);
        if (status === 200) { response.emit("data", Buffer.from(raw)); response.emit("end"); }
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return bodies;
}

test("batch transport sends one read-only POST and restores request order from reversed numeric IDs", async (t) => {
  const bodies = mockHttps(t, (body) => {
    assert.ok(Array.isArray(body));
    assert.deepEqual(body.map((item) => item.method), ["eth_chainId", "eth_getBalance"]);
    assert.ok(body.every((item) => typeof item.id === "number" && Number.isSafeInteger(item.id)));
    return { status: 200, raw: JSON.stringify([
      { jsonrpc: "2.0", id: body[1].id, result: "0x10" },
      { jsonrpc: "2.0", id: body[0].id, result: "0x1" },
    ]) };
  });
  assert.deepEqual(await new HttpsBaseRpc(endpoint).batchCall(read), ["0x1", "0x10"]);
  assert.equal(bodies.length, 1);
});

test("BNB native funding admits the frozen fee envelope against the block base fee and blocks an inadmissible one without a send", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const hash = `0x${"a".repeat(64)}`;
  const op = { sourceChainId: 56, sourceAccount: WALLET, nativeQuote: { deposit: { value: "100", maxFeePerGas: "10", maxPriorityFeePerGas: "5" } },
    depositNetworkFeeCeilingWei: "100" } as RelayUnsignedOperation;
  let baseFeePerGas = "0x5", sends = 0;
  const bodies = mockHttps(t, (body) => {
    assert.ok(Array.isArray(body));
    const methods = body.map((item: { method: string }) => item.method), head = methods[0] === "eth_chainId";
    // Chain and head, then the balance pinned to that head hash and the pending nonce (no header re-read, P2).
    const results = head ? ["0x38", { number: "0x10", hash, baseFeePerGas }] : ["0xc9", "0x1"];
    assert.deepEqual(methods, head ? ["eth_chainId", "eth_getBlockByNumber"] : ["eth_getBalance", "eth_getTransactionCount"]);
    return { status: 200, raw: JSON.stringify(body.map((item: { id: number }, index: number) =>
      ({ jsonrpc: "2.0", id: item.id, result: results[index] })).reverse()) };
  });
  const rpc = new HttpsBaseRpc(endpoint);
  const runtime = new RelayNativeSourceRuntime(new StateStore(temp.root),
    { load: async () => Buffer.alloc(32), create: async () => Buffer.alloc(32) },
    { confirm: async () => true, rpc: { batchCall: calls => rpc.batchCall(calls),
      submitRawTransaction: async () => { sends++; throw new Error("unexpected send"); } } });
  assert.equal(await runtime["funding"](op, rpc), 1n);
  assert.equal(bodies.length, 2);
  baseFeePerGas = "0x6";
  await assert.rejects(runtime["funding"](op, rpc), { code: "APN_OPERATION_BLOCKED",
    details: { reason: "native_funding_or_fee" } });
  assert.equal(bodies.length, 4);
  assert.equal(sends, 0);
});

test("batch parser accepts only identical duplicate envelopes and preserves request order", () => {
  const first = { jsonrpc: "2.0", id: 1, result: { transactionHash: "0xabc", block: { number: "0x2", hash: "0xdef" } } };
  const second = { jsonrpc: "2.0", id: 2, result: "0x10" };
  assert.deepEqual(parseRpcBatchResultEnvelope(JSON.stringify([second, first, structuredClone(first)]), [1, 2]),
    [first.result, second.result]);
  assert.deepEqual(parseRpcBatchResultEnvelope(JSON.stringify([first, ...Array(22).fill(first), second]), [1, 2]),
    [first.result, second.result], "24 envelopes remain within the fixed cap");
});

test("batch parser rejects conflicting duplicates, missing and unknown IDs, oversized extras, errors and malformed members", () => {
  const good = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const bad = [
    JSON.stringify([good(1, "a")]),
    JSON.stringify([good(1, "a"), good(1, "b")]),
    JSON.stringify([good(1, { block: "0x1" }), good(2, "b"), good(1, { block: "0x2" })]),
    JSON.stringify([good(1, "a"), good(1, "a"), good(1, "a")]),
    JSON.stringify([good(1, "a"), good(3, "b")]),
    JSON.stringify([good(1, "a"), good(2, "b"), good(3, "c")]),
    JSON.stringify([good(1, "a"), ...Array(23).fill(good(1, "a")), good(2, "b")]),
    JSON.stringify([good("2", "b"), good(1, "a")]),
    JSON.stringify([good(null, "b"), good(1, "a")]),
    JSON.stringify([good(1.5, "b"), good(2, "a")]),
    JSON.stringify([good(1, "a"), { jsonrpc: "2.0", id: 2, error: { code: -1, message: secret } }]),
    JSON.stringify([good(1, "a"), good(2, "b"), { jsonrpc: "2.0", id: 1, error: { code: -1, message: secret } }]),
    '[{"jsonrpc":"2.0","id":1,"result":"a","result":"b"},{"jsonrpc":"2.0","id":2,"result":"c"}]',
    '[{"jsonrpc":"2.0","id":1,"result":{"x":1,"x":2}},{"jsonrpc":"2.0","id":2,"result":"c"}]',
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: "a" }),
  ];
  for (const raw of bad) assert.throws(() => parseRpcBatchResultEnvelope(raw, [1, 2]), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => parseRpcBatchResultEnvelope(" ".repeat(1024 * 1024 + 1), [1, 2]),
    { code: "APN_RPC_PROTOCOL" }, "the parser retains the transport byte bound");
  assert.deepEqual(parseRpcBatchResultEnvelope(JSON.stringify([good(2, "b"), good(1, "a")]), [1, 2]), ["a", "b"]);
});

test("batch transport accepts an identical repeated response in one POST", async (t) => {
  const bodies = mockHttps(t, (body) => ({ status: 200, raw: JSON.stringify([
    { jsonrpc: "2.0", id: body[0].id, result: "0x1" },
    { jsonrpc: "2.0", id: body[0].id, result: "0x1" },
    { jsonrpc: "2.0", id: body[1].id, result: "0x10" },
  ]) }));
  assert.deepEqual(await new HttpsBaseRpc(endpoint).batchCall(read), ["0x1", "0x10"]);
  assert.equal(bodies.length, 1);
});

test("batch rejects unsuccessful HTTP once with safe method and status only", async (t) => {
  const bodies = mockHttps(t, () => ({ status: 429, raw: secret }));
  const error = await new HttpsBaseRpc(endpoint).batchCall(read).then(() => undefined, (failure: unknown) => failure) as any;
  assert.equal(error?.code, "APN_RPC_PROTOCOL");
  assert.deepEqual(error?.details, { rpcMethod: "batch", httpStatus: 429 });
  assert.equal(JSON.stringify({ message: error?.message, details: error?.details }).includes(secret), false);
  assert.equal(bodies.length, 1);
});

test("guarded Base raw send makes one POST on 429 and rejects the next attempt from persisted cooldown", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  const bodies = mockHttps(t, () => ({ status: 429, raw: secret }));
  const first = new HttpsBaseRpc(endpoint, { directGuardState: state });
  first.armEvmDirectRpcGuard();
  await assert.rejects(first.submitRawTransaction("0x01"), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(bodies.length, 1);
  assert.equal(JSON.parse(bodies[0]!).method, "eth_sendRawTransaction");
  const second = new HttpsBaseRpc(endpoint, { directGuardState: state });
  second.armEvmDirectRpcGuard();
  await assert.rejects(second.submitRawTransaction("0x01"), { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.equal(bodies.length, 1);
});

test("batch refuses write methods before network and scalar calls retain string IDs", async (t) => {
  const bodies = mockHttps(t, (body) => {
    assert.equal(Array.isArray(body), false);
    assert.equal(typeof body.id, "string");
    return { status: 200, raw: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: "0x2105" }) };
  });
  const rpc = new HttpsBaseRpc(endpoint);
  await assert.rejects(rpc.batchCall([{ method: "eth_sendRawTransaction", params: ["0x01"] }]), { code: "APN_INVALID_INPUT" });
  await assert.rejects(rpc.batchCall([]), { code: "APN_INVALID_INPUT" });
  await assert.rejects(rpc.batchCall(Array(17).fill(read[0])), { code: "APN_INVALID_INPUT" });
  assert.equal(bodies.length, 0);
  assert.deepEqual(await rpc.assertBaseChain(), { chainId: 8453, rpcOrigin: "https://8.8.8.8" });
  assert.equal(bodies.length, 1);
});

test("an endpoint that answers a batch with one object is named as not supporting batches, after one POST", async (t) => {
  const bodies = mockHttps(t, () => ({ status: 200, raw: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch requests are not supported" } }) }));
  const error = await new HttpsBaseRpc(endpoint).batchCall(read).then(() => undefined, (failure: unknown) => failure) as { code?: string; details?: unknown } | undefined;
  assert.equal(error?.code, "APN_RPC_PROTOCOL");
  assert.deepEqual(error?.details, { reason: "rpc_batch_unsupported" });
  assert.equal(bodies.length, 1, "there is no per-call retry behind the refusal");
});
