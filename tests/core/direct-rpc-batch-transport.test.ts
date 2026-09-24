import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import { decodeFunctionData, toHex } from "viem";
import { requireEvmFunding, validateEvmFeeQuote } from "../../src/evm-direct.js";
import { HttpsBaseRpc, parseRpcBatchResultEnvelope } from "../../src/rpc.js";
import { RECIPIENT, WALLET } from "./helpers.js";

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

test("batch parser rejects missing, duplicate, unexpected, malformed IDs, suberrors and duplicate JSON members", () => {
  const good = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const bad = [
    JSON.stringify([good(1, "a")]),
    JSON.stringify([good(1, "a"), good(1, "b")]),
    JSON.stringify([good(1, "a"), good(3, "b")]),
    JSON.stringify([good("2", "b"), good(1, "a")]),
    JSON.stringify([good(null, "b"), good(1, "a")]),
    JSON.stringify([good(1.5, "b"), good(2, "a")]),
    JSON.stringify([good(1, "a"), { jsonrpc: "2.0", id: 2, error: { code: -1, message: secret } }]),
    '[{"jsonrpc":"2.0","id":1,"result":"a","result":"b"},{"jsonrpc":"2.0","id":2,"result":"c"}]',
    '[{"jsonrpc":"2.0","id":1,"result":{"x":1,"x":2}},{"jsonrpc":"2.0","id":2,"result":"c"}]',
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: "a" }),
  ];
  for (const raw of bad) assert.throws(() => parseRpcBatchResultEnvelope(raw, [1, 2]), { code: "APN_RPC_PROTOCOL" });
  assert.deepEqual(parseRpcBatchResultEnvelope(JSON.stringify([good(2, "b"), good(1, "a")]), [1, 2]), ["a", "b"]);
});

test("batch rejects unsuccessful HTTP once with safe method and status only", async (t) => {
  const bodies = mockHttps(t, () => ({ status: 429, raw: secret }));
  const error = await new HttpsBaseRpc(endpoint).batchCall(read).then(() => undefined, (failure: unknown) => failure) as any;
  assert.equal(error?.code, "APN_RPC_PROTOCOL");
  assert.deepEqual(error?.details, { rpcMethod: "batch", httpStatus: 429 });
  assert.equal(JSON.stringify({ message: error?.message, details: error?.details }).includes(secret), false);
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

const LINEA_HASH = `0x${"b".repeat(64)}`;
function lineaRead(method: string, params: readonly unknown[], reorg = false): unknown {
  if (method === "eth_chainId") return "0xe708";
  if (method === "eth_getBlockByNumber") return { number: "0x10", hash: reorg && params[0] === "0x10" ? `0x${"c".repeat(64)}` : LINEA_HASH, baseFeePerGas: "0x2" };
  if (method === "eth_getBalance") return "0x100000000000000";
  if (method === "eth_getTransactionCount") return "0x7";
  if (method === "eth_estimateGas") return "0x5208";
  if (method === "eth_maxPriorityFeePerGas") return "0x1";
  throw new Error(`unexpected ${method}`);
}

test("opted-in Linea native prepare makes 17 logical reads in eight physical POSTs and matches scalar economics", async (t) => {
  const bodies = mockHttps(t, (body) => {
    const reads = Array.isArray(body) ? body : [body];
    const responses = reads.map((entry: any) => ({ jsonrpc: "2.0", id: entry.id, result: lineaRead(entry.method, entry.params) }));
    return { status: 200, raw: JSON.stringify(Array.isArray(body) ? responses.reverse() : responses[0]) };
  });
  const rpc = new HttpsBaseRpc(endpoint);
  const grouped = rpc.evm.prepareLineaNative();
  const balance = await grouped.balance(WALLET, { chainId: 59144, token: "native" });
  const transaction = { chainId: 59144 as const, from: WALLET, to: RECIPIENT, valueAtomic: "100", data: "0x" as const };
  const { nonce, estimated } = await grouped.nonceEstimate(WALLET, transaction);
  const economics = { nonceAtomic: nonce, ...estimated, maximumGasCostAtomic: (BigInt(estimated.gasLimitAtomic) * BigInt(estimated.maxFeePerGasAtomic)).toString() };
  const quote = await grouped.feeQuote(economics);
  assert.equal(balance.assetAtomic, BigInt("0x100000000000000").toString());
  assert.equal(estimated.maxFeePerGasAtomic, "5");
  assert.equal(quote.totalQuoteWei, economics.maximumGasCostAtomic);
  assert.equal(bodies.length, 8);
  assert.equal(bodies.flatMap((raw) => { const body = JSON.parse(raw); return Array.isArray(body) ? body : [body]; }).length, 17);
  assert.deepEqual(bodies.map((raw) => { const body = JSON.parse(raw); return (Array.isArray(body) ? body : [body]).map((call: any) => call.method); }), [
    ["eth_chainId", "eth_getBlockByNumber"], ["eth_getBalance"], ["eth_getBlockByNumber", "eth_chainId"],
    ["eth_chainId", "eth_chainId"], ["eth_getTransactionCount", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getBlockByNumber"],
    ["eth_chainId", "eth_chainId"], ["eth_chainId", "eth_getBlockByNumber"], ["eth_getBlockByNumber", "eth_chainId"],
  ]);
});

test("Linea grouped prepare rejects reorg before nonce and estimate reads", async (t) => {
  const bodies = mockHttps(t, (body) => {
    const reads = Array.isArray(body) ? body : [body];
    const responses = reads.map((entry: any) => ({ jsonrpc: "2.0", id: entry.id, result: lineaRead(entry.method, entry.params, true) }));
    return { status: 200, raw: JSON.stringify(Array.isArray(body) ? responses.reverse() : responses[0]) };
  });
  await assert.rejects(new HttpsBaseRpc(endpoint).evm.prepareLineaNative().balance(WALLET, { chainId: 59144, token: "native" }), { code: "APN_RPC_PROTOCOL" });
  assert.equal(bodies.length, 3);
});

test("Linea grouped prepare stops on provider batch rejection without scalar fallback", async (t) => {
  const bodies = mockHttps(t, () => ({ status: 429, raw: secret }));
  await assert.rejects(new HttpsBaseRpc(endpoint).evm.prepareLineaNative().balance(WALLET, { chainId: 59144, token: "native" }), { code: "APN_RPC_PROTOCOL" });
  assert.equal(bodies.length, 1);
});

test("Linea grouped prepare enforces ten physical attempts across all phases", async () => {
  const reads: string[] = [];
  const call = async (method: string, params: readonly unknown[]) => { reads.push(method); return lineaRead(method, params); };
  const batch = async (calls: readonly { method: string; params: readonly unknown[] }[]) => {
    reads.push("batch"); return await Promise.all(calls.map((item) => lineaRead(item.method, item.params)));
  };
  const { EvmRpc } = await import("../../src/evm-rpc.js");
  const grouped = new EvmRpc(call, endpoint, undefined, batch).prepareLineaNative();
  const selection = { chainId: 59144 as const, token: "native" as const };
  await grouped.balance(WALLET, selection);
  await grouped.balance(WALLET, selection);
  await grouped.nonceEstimate(WALLET, { chainId: 59144, from: WALLET, to: RECIPIENT, valueAtomic: "1", data: "0x" });
  await assert.rejects(grouped.feeQuote({ nonceAtomic: "7", gasLimitAtomic: "21000", maxFeePerGasAtomic: "5", maxPriorityFeePerGasAtomic: "1", maximumGasCostAtomic: "105000" }), { code: "APN_RPC_PROTOCOL" });
  assert.equal(reads.length, 10);
});

const UNICHAIN_HASH = `0x${"d".repeat(64)}`;
const ORACLE_ABI = [
  { type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;
function unichainRead(method: string, params: readonly unknown[]): unknown {
  if (method === "eth_chainId") return "0x82";
  if (method === "eth_getBlockByNumber") return { number: "0x10", hash: UNICHAIN_HASH, baseFeePerGas: "0x2" };
  if (method === "eth_getBalance") return "0x100000000000000";
  if (method === "eth_getTransactionCount") return "0x7";
  if (method === "eth_estimateGas") return "0x5208";
  if (method === "eth_maxPriorityFeePerGas") return "0x1";
  if (method === "eth_call") {
    const [call, block] = params as [{ to: string; data: `0x${string}` }, string];
    assert.equal(call.to, "0x420000000000000000000000000000000000000F");
    assert.equal(block, "0x10");
    const decoded = decodeFunctionData({ abi: ORACLE_ABI, data: call.data });
    assert.equal(decoded.args[0], decoded.functionName === "getL1FeeUpperBound" ? 512n : 21000n);
    return toHex(decoded.functionName === "getL1FeeUpperBound" ? 1000n : 7n, { size: 32 });
  }
  throw new Error(`unexpected ${method}`);
}

test("Unichain native opt-in matches scalar balance, nonce, estimate and OP fee quote with nine modeled POSTs", async (t) => {
  const bodies = mockHttps(t, (body) => {
    const reads = Array.isArray(body) ? body : [body];
    const responses = reads.map((entry: any) => ({ jsonrpc: "2.0", id: entry.id, result: unichainRead(entry.method, entry.params) }));
    return { status: 200, raw: JSON.stringify(Array.isArray(body) ? responses.reverse() : responses[0]) };
  });
  const rpc = new HttpsBaseRpc(endpoint).evm;
  const selection = { chainId: 130 as const, token: "native" as const };
  const transaction = { chainId: 130 as const, from: WALLET, to: RECIPIENT, valueAtomic: "100", data: "0x" as const };
  const grouped = rpc.prepareUnichainNative();
  const balance = await grouped.balance(WALLET, selection);
  const { nonce, estimated } = await grouped.nonceEstimate(WALLET, transaction);
  const economics = { nonceAtomic: nonce, ...estimated,
    maximumGasCostAtomic: (BigInt(estimated.gasLimitAtomic) * BigInt(estimated.maxFeePerGasAtomic)).toString() };
  const quote = await grouped.feeQuote(economics);
  assert.equal(bodies.length, 9);
  assert.equal(bodies.flatMap((raw) => { const body = JSON.parse(raw); return Array.isArray(body) ? body : [body]; }).length, 19);
  assert.deepEqual(bodies.map((raw) => { const body = JSON.parse(raw); return (Array.isArray(body) ? body : [body]).map((call: any) => call.method); }), [
    ["eth_chainId", "eth_getBlockByNumber"], ["eth_getBalance"], ["eth_getBlockByNumber", "eth_chainId"],
    ["eth_chainId", "eth_chainId"], ["eth_getTransactionCount", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getBlockByNumber"],
    ["eth_chainId", "eth_chainId"], ["eth_chainId", "eth_getBlockByNumber"], ["eth_call", "eth_call"],
    ["eth_getBlockByNumber", "eth_chainId"],
  ]);
  assert.equal(quote.l1DataFeeUpperWei, "1000"); assert.equal(quote.operatorFeeUpperWei, "7");
  assert.equal(validateEvmFeeQuote(quote, economics), quote);
  requireEvmFunding(balance, "100", quote, quote.totalQuoteWei);
  assert.throws(() => requireEvmFunding(balance, "100", quote, quote.maximumExecutionFeeWei), { code: "APN_FEE_BUDGET_EXCEEDED" });
  const groupedPosts = bodies.length;
  const scalarBalance = await rpc.balance(WALLET, selection);
  const scalarNonce = await rpc.nonce(130, WALLET, "pending");
  const scalarEstimate = await rpc.estimate(transaction);
  const scalarQuote = await rpc.feeQuote(130, economics);
  assert.equal(bodies.length - groupedPosts, 19);
  assert.deepEqual({ ...balance, observedAt: "fixed" }, { ...scalarBalance, observedAt: "fixed" });
  assert.equal(nonce, scalarNonce); assert.deepEqual(estimated, scalarEstimate);
  assert.deepEqual({ ...quote, observedAt: "fixed" }, { ...scalarQuote, observedAt: "fixed" });
});

for (const shape of ["missing", "duplicate", "suberror"] as const) test(`Unichain batch ${shape} aborts after one POST without scalar fallback`, async (t) => {
  const bodies = mockHttps(t, (body) => {
    assert.ok(Array.isArray(body));
    const good = body.map((entry: any) => ({ jsonrpc: "2.0", id: entry.id, result: unichainRead(entry.method, entry.params) }));
    const rows = shape === "missing" ? [good[0]] : shape === "duplicate" ? [good[0], good[0]] :
      [good[0], { jsonrpc: "2.0", id: body[1].id, error: { code: -1, message: secret } }];
    return { status: 200, raw: JSON.stringify(rows) };
  });
  const error = await new HttpsBaseRpc(endpoint).evm.prepareUnichainNative().balance(WALLET, { chainId: 130, token: "native" })
    .then(() => undefined, (failure: unknown) => failure) as any;
  assert.equal(error?.code, "APN_RPC_PROTOCOL");
  assert.equal(JSON.stringify({ message: error?.message, details: error?.details }).includes(secret), false);
  assert.equal(bodies.length, 1);
});

test("Unichain batch checks selected chain before balance and rejects a changed pinned block before nonce", async (t) => {
  let wrongChain = true;
  const bodies = mockHttps(t, (body) => {
    const reads = Array.isArray(body) ? body : [body];
    const responses = reads.map((entry: any) => ({ jsonrpc: "2.0", id: entry.id,
      result: wrongChain && entry.method === "eth_chainId" ? "0xe708" :
        entry.method === "eth_getBlockByNumber" && entry.params[0] === "0x10"
          ? { number: "0x10", hash: `0x${"e".repeat(64)}`, baseFeePerGas: "0x2" }
          : unichainRead(entry.method, entry.params) }));
    return { status: 200, raw: JSON.stringify(Array.isArray(body) ? responses.reverse() : responses[0]) };
  });
  const grouped = new HttpsBaseRpc(endpoint).evm.prepareUnichainNative();
  await assert.rejects(grouped.balance(WALLET, { chainId: 130, token: "native" }), { code: "APN_CHAIN_MISMATCH" });
  assert.equal(bodies.length, 1);
  wrongChain = false;
  await assert.rejects(grouped.balance(WALLET, { chainId: 130, token: "native" }), { code: "APN_RPC_PROTOCOL" });
  assert.equal(bodies.length, 4);
});
