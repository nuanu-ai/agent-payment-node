import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { BridgeRpcPhysicalBudget, RpcProviderScheduler, RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";

const raw = `0x${"02".repeat(32)}` as const;

test("LI.FI physical POST cap and 750ms pacing span Ethereum, Base, read sessions and send", async () => {
  let now = 0;
  const starts: number[] = [], methods: string[] = [];
  const budget = new BridgeRpcPhysicalBudget(() => now, async (ms) => { now += ms; });
  const transport = { request: async (_url: string, verb: string, body: string) => {
    assert.equal(verb, "POST"); starts.push(now);
    const request = JSON.parse(body) as { id: string; method: string };
    methods.push(request.method);
    const result = request.method === "eth_sendRawTransaction" ? keccak256(raw) : request.method === "eth_chainId" ?
      (methods.length % 2 === 0 ? "0x2105" : "0x1") : "0x1";
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  } };
  const factory = bridgeRpcFactory({ APN_ETHEREUM_RPC_URL: "https://eth.example", APN_BASE_RPC_URL: "https://base.example" }, { transport });
  for (let index = 0; index < 23; index += 1) {
    const chain = index % 2 === 0 ? 1 : 8453;
    await factory(chain, new RpcReadSession({ now: () => now, physicalBudget: budget })).assertChain();
  }
  assert.equal(await factory(1, new RpcReadSession({ now: () => now, physicalBudget: budget })).send(raw), keccak256(raw));
  await assert.rejects(factory(8453, new RpcReadSession({ now: () => now, physicalBudget: budget })).assertChain(),
    { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(starts.length, 24);
  assert.equal(methods.filter((method) => method === "eth_sendRawTransaction").length, 1);
  assert.ok(starts.every((start, index) => index === 0 || start - starts[index - 1]! >= 750));
});

test("LI.FI first 429 consumes one physical POST and performs no retry", async () => {
  let calls = 0;
  const budget = new BridgeRpcPhysicalBudget();
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example" }, { transport: {
    request: async () => { calls += 1; return { status: 429, body: "", headers: { "retry-after": "5" } }; },
  } })(8453, new RpcReadSession({ physicalBudget: budget }));
  await assert.rejects(rpc.assertChain(), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(calls, 1); assert.equal(budget.remaining(), 23);
});

test("LI.FI raw send 429 persists provider cooldown before the next read", async () => {
  let now = 0, cooldown: number | null = null;
  const waits: number[] = [], methods: string[] = [];
  const coordinator = { coordinate: async <T>(_family: string,
    work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
      saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) =>
    await work(null, async () => {}, cooldown, async (value) => { cooldown = value; }) };
  const scheduler = new RpcProviderScheduler(coordinator, () => now);
  const budget = new BridgeRpcPhysicalBudget(() => now, async (ms) => { now += ms; });
  const factory = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.drpc.org" }, { transport: {
    request: async (_endpoint: string, _verb: string, body: string) => {
      const request = JSON.parse(body) as { id: string; method: string };
      methods.push(request.method);
      return request.method === "eth_sendRawTransaction" ? { status: 429, body: "" } :
        { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }) };
    },
  } });
  const session = new RpcReadSession({ now: () => now, wait: async (ms) => { waits.push(ms); now += ms; },
    providerScheduler: scheduler, physicalBudget: budget });
  const rpc = factory(8453, session);
  await assert.rejects(rpc.send(raw), { code: "APN_RPC_RATE_LIMITED" });
  assert.equal(cooldown, 2_000);
  await rpc.assertChain();
  assert.deepEqual(waits, [2_000]); assert.deepEqual(methods, ["eth_sendRawTransaction", "eth_chainId"]);
});
