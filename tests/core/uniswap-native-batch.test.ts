import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { SavedUniswapQuoteStore } from "../../src/swap/uniswap-v3/material.js";
import { KeylessUniswapQuoteBuilder } from "../../src/swap/uniswap-v3/builder.js";
import { lazyEthereumRpcCall } from "../../src/swap/uniswap-v3/runtime-factory.js";
import { scalarUniswapRpcCall } from "../../src/swap/uniswap-v3/native-rpc.js";
import { ETHEREUM_USDT, verifyCodePins, verifyNativeCodePins, verifyUsdtNotDeprecated } from "../../src/swap/uniswap-v3/pins.js";
import { temporaryState } from "./helpers.js";
import { ACCOUNT, AMOUNT_IN, KeylessRpc, PROFILE } from "./uniswap-keyless-helpers.js";

const now = new Date("2026-09-18T05:00:00.000Z");
const request = { profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT, outputToken: ETHEREUM_USDT,
  amountAtomic: AMOUNT_IN, slippageBps: 50, ownerSlippageCapBps: 100,
  deadline: Math.floor(now.getTime() / 1000) + 900, maxGasLimit: "300000",
  maxFeePerGas: "30000000000", maxPriorityFeePerGas: "1000000000", now };
const endpoint = { APN_ETHEREUM_RPC_URL: "https://rpc.example", APN_UNISWAP_NATIVE_BATCH_READS: "1" };

function transport(rpc: Pick<KeylessRpc, "call">, transform: (rows: any[]) => any[] = (rows) => rows.reverse()) {
  const posts: Array<{ readonly methods: string[]; readonly array: boolean }> = [];
  return { posts, request: async (_url: string, _method: string, body: string) => {
    const parsed = JSON.parse(body), array = Array.isArray(parsed), requests = array ? parsed : [parsed];
    posts.push({ methods: requests.map((row: any) => row.method), array });
    const rows = await Promise.all(requests.map(async (row: any) => ({ jsonrpc: "2.0", id: row.id,
      result: await rpc.call(row.method, row.params) })));
    return { status: 200, body: JSON.stringify(array ? transform(rows) : rows[0]) };
  } };
}

test("opt-in native ETH to USDT quote matches scalar material with reordered strict batch responses", async (t) => {
  const scalarState = await temporaryState(), batchState = await temporaryState();
  t.after(scalarState.cleanup); t.after(batchState.cleanup);
  const scalarRpc = new KeylessRpc(), batchRpc = new KeylessRpc();
  scalarRpc.quoted = 2_468_410n; batchRpc.quoted = 2_468_410n;
  const scalar = await new KeylessUniswapQuoteBuilder(scalarRpc.call, new SavedUniswapQuoteStore(scalarState.root), async () => [])
    .quote(request);
  const wire = transport(batchRpc), call = lazyEthereumRpcCall(endpoint, wire);
  const grouped = await new KeylessUniswapQuoteBuilder(call, new SavedUniswapQuoteStore(batchState.root), async () => [])
    .quote(request);
  assert.deepEqual(grouped, scalar);
  assert.deepEqual(wire.posts.map((post) => post.methods.length), [2, 2, 1, 3, 3]);
  assert.equal(wire.posts.filter((post) => post.array).length, 4);
});

test("full native quote verifies synthetic pins and uses ten physical POSTs", async (t) => {
  const scalarState = await temporaryState(), batchState = await temporaryState();
  t.after(scalarState.cleanup); t.after(batchState.cleanup);
  const code = "0x6001600155" as Hex, implementationCode = "0x600260025500" as Hex;
  const pins = Array.from({ length: 8 }, (_, index) => ({ role: `fake-${index}`,
    address: `0x${(index + 1).toString(16).repeat(40)}`, codeHash: keccak256(code) }));
  const implementation = { proxy: "0x2222222222222222222222222222222222222222", slot: `0x${"0".repeat(64)}` as Hex,
    pin: { role: "impl", address: "0x9999999999999999999999999999999999999999", codeHash: keccak256(implementationCode) } };
  const deprecated = { to: ETHEREUM_USDT, data: "0x0e136b19" as Hex };
  const rpc = new KeylessRpc(); rpc.quoted = 2_468_410n;
  const backend = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getCode") return params[0] === implementation.pin.address ? implementationCode : code;
    if (method === "eth_getStorageAt") return `0x${"0".repeat(24)}${"9".repeat(40)}`;
    return await rpc.call(method, params);
  };
  const scalar = await new KeylessUniswapQuoteBuilder(backend, new SavedUniswapQuoteStore(scalarState.root),
    async (call, tag) => { const verified = await verifyCodePins(call, tag, pins, implementation);
      await verifyUsdtNotDeprecated(call, tag); return verified; }).quote(request);
  const wire = transport({ call: backend }), grouped = await new KeylessUniswapQuoteBuilder(
    lazyEthereumRpcCall(endpoint, wire), new SavedUniswapQuoteStore(batchState.root),
    async (call, tag) => await verifyNativeCodePins(call, tag, pins, implementation, deprecated)).quote(request);
  assert.deepEqual(grouped, scalar);
  assert.deepEqual(wire.posts.map((post) => post.methods.length), [2, 3, 3, 3, 1, 1, 2, 1, 3, 3]);
  assert.equal(wire.posts.length, 10);
});

test("native batch rejects duplicate or missing IDs and a sub-error without scalar fallback", async () => {
  for (const transform of [
    (rows: any[]) => [rows[0], rows[0]],
    (rows: any[]) => rows.slice(0, 1),
    (rows: any[]) => [rows[0], { jsonrpc: "2.0", id: rows[1].id, error: { code: -32000, message: "failed" } }],
  ]) {
    const rpc = new KeylessRpc(), wire = transport(rpc, transform), call = lazyEthereumRpcCall(endpoint, wire);
    await assert.rejects(call.batch!([{ method: "eth_chainId", params: [] },
      { method: "eth_getBlockByNumber", params: ["latest", false] }]), { code: "APN_RPC_PROTOCOL" });
    assert.equal(wire.posts.length, 1);
    assert.equal(wire.posts[0]?.array, true);
  }
});

test("execution guard RPC facade cannot expose quote-only batching", async () => {
  const rpc = new KeylessRpc(), wire = transport(rpc), quoteCall = lazyEthereumRpcCall(endpoint, wire);
  const executionCall = scalarUniswapRpcCall(quoteCall);
  assert.equal(quoteCall.batch === undefined, false);
  assert.equal((executionCall as typeof quoteCall).batch, undefined);
  assert.equal(await executionCall("eth_chainId", []), "0x1");
  assert.deepEqual(wire.posts.map((post) => post.array), [false]);
});

test("balance sub-error in grouped simulation retains its RPC identity", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const rpc = new KeylessRpc(); rpc.quoted = 2_468_410n;
  const wire = transport(rpc, (rows) => rows.length === 3
    ? [rows[0], rows[1], { jsonrpc: "2.0", id: rows[2].id, error: { code: -32000, message: "balance unavailable" } }]
    : rows.reverse());
  await assert.rejects(new KeylessUniswapQuoteBuilder(lazyEthereumRpcCall(endpoint, wire),
    new SavedUniswapQuoteStore(state.root), async () => []).quote(request),
  (error: any) => error.code === "APN_RPC_PROTOCOL" && error.details?.rpcMethod === "eth_getBalance");
  assert.deepEqual(wire.posts.map((post) => post.methods.length), [2, 2, 1, 3]);
});

test("native pin grouping validates code, proxy storage, and deprecation at one tag", async () => {
  const code = "0x6001600155" as Hex, implementationCode = "0x600260025500" as Hex;
  const pins = Array.from({ length: 8 }, (_, index) => ({ role: `fake-${index}`,
    address: `0x${(index + 1).toString(16).repeat(40)}`, codeHash: keccak256(code) }));
  const implementation = { proxy: "0x2222222222222222222222222222222222222222", slot: `0x${"0".repeat(64)}` as Hex,
    pin: { role: "impl", address: "0x9999999999999999999999999999999999999999", codeHash: keccak256(implementationCode) } };
  const deprecated = { to: ETHEREUM_USDT, data: "0x0e136b19" as Hex }, tag = "0x64" as Hex;
  let drift = false, deprecatedFlag = false;
  const groups: string[][] = [];
  const call = Object.assign(async (method: string, params: readonly unknown[]) => {
    assert.equal(params[method === "eth_getStorageAt" ? 2 : 1], tag);
    if (method === "eth_getCode") return params[0] === implementation.pin.address ? implementationCode : drift ? "0x" : code;
    if (method === "eth_call") return `0x${"0".repeat(63)}${deprecatedFlag ? "1" : "0"}`;
    if (method === "eth_getStorageAt") return `0x${"0".repeat(24)}${"9".repeat(40)}`;
    throw new Error(method);
  }, { batch: async (items: readonly { method: string; params: readonly unknown[] }[]) => {
    groups.push(items.map((item) => item.method));
    return await Promise.all(items.map((item) => call(item.method, item.params)));
  } });
  assert.equal((await verifyNativeCodePins(call, tag, pins, implementation, deprecated)).length, 9);
  assert.deepEqual(groups, [["eth_getCode", "eth_getCode", "eth_getCode"],
    ["eth_getCode", "eth_getCode", "eth_getCode"], ["eth_getCode", "eth_getCode", "eth_call"],
    ["eth_getStorageAt"], ["eth_getCode"]]);
  drift = true;
  await assert.rejects(verifyNativeCodePins(call, tag, pins, implementation, deprecated),
    (error: any) => error.details?.reason === "uniswap_code_pin_drift");
  drift = false; deprecatedFlag = true;
  await assert.rejects(verifyNativeCodePins(call, tag, pins, implementation, deprecated),
    (error: any) => error.details?.reason === "uniswap_code_pin_drift");
});
