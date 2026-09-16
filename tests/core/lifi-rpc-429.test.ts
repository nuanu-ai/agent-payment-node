import assert from "node:assert/strict";
import test from "node:test";
import { bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { circleApprovalRpcFromBridge } from "../../src/lifi/circle-v2-approval-executor.js";
import type { BridgeRpcPort } from "../../src/lifi/ports.js";

function fixture(statuses: readonly number[]) {
  let calls = 0;
  const delays: number[] = [], methods: string[] = [];
  const transport = { request: async (_endpoint: string, _verb: string, body: string | null) => {
    const request = JSON.parse(body!) as { id: string; method: string };
    methods.push(request.method);
    const status = statuses[calls++] ?? 200;
    return status === 429 ? { status, body: '{"jsonrpc":"2.0","error":{"code":-32016,"message":"over rate limit"}}' }
      : { status, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }) };
  } };
  const wait = async (milliseconds: number) => { delays.push(milliseconds); };
  return { transport, wait, methods, delays, get calls() { return calls; } };
}

test("Base read retries only explicit HTTP 429 with bounded backoff", async () => {
  const f = fixture([429, 200]);
  await bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453).assertChain();
  assert.deepEqual(f.methods, ["eth_chainId", "eth_chainId"]);
  assert.deepEqual(f.delays, [1_000]);
});
test("repeated Base 429 fails closed after two read retries", async () => {
  const f = fixture([429, 429, 429]);
  await assert.rejects(bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453).assertChain(),
    { code: "APN_RPC_PROTOCOL", message: /bridge_RPC_HTTP_429/u });
  assert.equal(f.calls, 3); assert.deepEqual(f.delays, [1_000, 2_000]);
});
test("transaction submission never retries even when Base returns 429", async () => {
  const f = fixture([429]);
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, f)(8453);
  await assert.rejects(rpc.send("0x02"), { code: "APN_RPC_PROTOCOL", message: /bridge_RPC_HTTP_429/u });
  assert.deepEqual(f.methods, ["eth_sendRawTransaction"]); assert.deepEqual(f.delays, []);
});
test("Ethereum reads never inherit the Base 429 retry", async () => {
  const f = fixture([429]);
  await assert.rejects(bridgeRpcFactory({ APN_ETHEREUM_RPC_URL: "https://ethereum.example" }, f)(1).assertChain(),
    { code: "APN_RPC_PROTOCOL", message: /bridge_RPC_HTTP_429/u });
  assert.equal(f.calls, 1); assert.deepEqual(f.delays, []);
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
