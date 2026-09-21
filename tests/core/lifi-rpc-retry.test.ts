import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { bridgeRpcCall, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { circleApprovalRpcFromBridge } from "../../src/lifi/circle-v2-approval-executor.js";
import type { BridgeRpcPort } from "../../src/lifi/ports.js";

function fixture(statuses: readonly number[], invalidBody?: (id: string) => string) {
  let calls = 0;
  const delays: number[] = [], methods: string[] = [];
  const transport = { request: async (_endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as { id: string; method: string };
    methods.push(request.method);
    const status = statuses[calls++] ?? 200;
    return { status, body: invalidBody?.(request.id) ?? JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }) };
  } };
  const wait = async (milliseconds: number) => { delays.push(milliseconds); };
  return { transport, wait, methods, delays, get calls() { return calls; } };
}

test("read-only Bridge RPC retries HTTP 408 then succeeds with bounded backoff", async () => {
  const f = fixture([408, 200]);
  const rpc = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base.example" }, f);
  assert.equal(await rpc.call("eth_getStorageAt", ["0x0000000000000000000000000000000000000000", "0x0", "safe"]), "0x2105");
  assert.deepEqual(f.methods, ["eth_getStorageAt", "eth_getStorageAt"]);
  assert.deepEqual(f.delays, [2_000]);
});
test("repeated HTTP 408 preserves exact exhaustion evidence after two read retries", async () => {
  const f = fixture([408, 408, 408]);
  const rpc = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base.example" }, f);
  await assert.rejects(rpc.call("eth_getTransactionReceipt", [`0x${"1".repeat(64)}`]), (error: unknown) => {
    assert.ok(error instanceof ApnError); assert.equal(error.code, "APN_RPC_PROTOCOL");
    assert.match(error.message, /bridge_RPC_HTTP_status/u);
    assert.deepEqual(error.details, { rpcMethod: "eth_getTransactionReceipt", httpStatus: "408", attempts: "2" });
    return true;
  });
  assert.equal(f.calls, 2); assert.deepEqual(f.delays, [2_000]);
});
for (const status of [500, 503]) test(`read-only Bridge RPC retries transient HTTP ${status}`, async () => {
  const f = fixture([status, 200]);
  await bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453).assertChain();
  assert.deepEqual(f.methods, ["eth_chainId", "eth_chainId"]); assert.deepEqual(f.delays, [2_000]);
});
test("read-only HTTP 429 returns a typed cooldown without retry", async () => {
  const f = fixture([429]);
  await assert.rejects(bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453).assertChain(), { code: "APN_RPC_RATE_LIMITED" });
  assert.deepEqual(f.methods, ["eth_chainId"]); assert.deepEqual(f.delays, []);
});
test("permanent HTTP 4xx is not retried", async () => {
  const f = fixture([400, 200]);
  await assert.rejects(bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453).assertChain(),
    { code: "APN_RPC_PROTOCOL", details: { rpcMethod: "eth_chainId", httpStatus: "400", attempts: "1" } });
  assert.equal(f.calls, 1); assert.deepEqual(f.delays, []);
});
test("invalid JSON-RPC protocol evidence is not retried", async () => {
  const f = fixture([200, 200], id => JSON.stringify({ jsonrpc: "2.0", id, result: "0x2105", error: { code: -32000 } }));
  await assert.rejects(bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453).assertChain(),
    { code: "APN_RPC_PROTOCOL", message: /bridge_RPC_response/u });
  assert.equal(f.calls, 1); assert.deepEqual(f.delays, []);
});
test("explicit JSON-RPC server error is not retried without a defined retry convention", async () => {
  const f = fixture([200, 200], id => JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32016, message: "over rate limit" } }));
  await assert.rejects(bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453).assertChain(),
    { code: "APN_RPC_PROTOCOL", message: /bridge_RPC_response/u });
  assert.equal(f.calls, 1); assert.deepEqual(f.delays, []);
});
test("transient transport timeout retries reads and preserves exhaustion evidence", async () => {
  let calls = 0; const delays: number[] = [];
  const transport = { request: async () => { calls++; throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge transport failed: request_deadline.",
    { transportReason: "request_deadline" }); } };
  const rpc = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://ethereum.example" }, { transport,
    wait: async milliseconds => { delays.push(milliseconds); } });
  await assert.rejects(rpc.call("eth_getBlockByNumber", ["safe", false]), (error: unknown) => {
    assert.ok(error instanceof ApnError); assert.equal(error.code, "APN_RPC_AMBIGUOUS");
    assert.deepEqual(error.details, { rpcMethod: "eth_getBlockByNumber", attempts: "2", transportReason: "request_deadline" });
    return true;
  });
  assert.equal(calls, 2); assert.deepEqual(delays, [2_000]);
});
for (const status of [408, 429, 503]) test(`transaction submission never retries HTTP ${status}`, async () => {
  const f = fixture([status, 200]);
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453);
  await assert.rejects(rpc.send("0x02"), { code: status === 429 ? "APN_RPC_RATE_LIMITED" : "APN_RPC_PROTOCOL" });
  assert.deepEqual(f.methods, ["eth_sendRawTransaction"]); assert.deepEqual(f.delays, []);
});
test("transaction submission never retries a transient transport failure", async () => {
  let calls = 0; const delays: number[] = [];
  const transport = { request: async () => { calls++; throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" }); } };
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, { transport,
    wait: async milliseconds => { delays.push(milliseconds); } })(8453);
  await assert.rejects(rpc.send("0x02"), { code: "APN_RPC_AMBIGUOUS",
    details: { rpcMethod: "eth_sendRawTransaction", attempts: "1", transportReason: "request_deadline" } });
  assert.equal(calls, 1); assert.deepEqual(delays, []);
});
test("Circle approval reuses the gas estimate's price instead of making a duplicate price read", async () => {
  const payer = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
  const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const spender = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
  let prices = 0, estimates = 0;
  const rpc = { chainId: 8453, origin: "https://base.example", assertChain: async () => {},
    account: async () => ({ chainId: 8453, rpcOrigin: "https://base.example", owner: payer, token, spender,
      block: { numberAtomic: "123", hash: `0x${"a".repeat(64)}` }, latestNonceAtomic: "7", pendingNonceAtomic: "7",
      balanceAtomic: "500000", allowanceAtomic: "0", nativeBalanceWei: "100000000000000" }),
    estimate: async () => { estimates++; return { gasLimitAtomic: "56240", maxFeePerGasAtomic: "11000000", maxPriorityFeePerGasAtomic: "1000000" }; },
    prices: async () => { prices++; throw Error("duplicate price read"); },
    feeQuote: async () => ({ chainId: 8453, totalQuoteWei: "900000000000" }),
  } as unknown as BridgeRpcPort;
  const state = await circleApprovalRpcFromBridge(rpc).read({ chainId: 8453, payer, token, spender, data: "0x095ea7b3" });
  assert.equal(state.maxFeePerGasWei, "11000000");
  assert.equal(state.gasLimitAtomic, "56240");
  assert.equal(estimates, 1); assert.equal(prices, 0);
});
