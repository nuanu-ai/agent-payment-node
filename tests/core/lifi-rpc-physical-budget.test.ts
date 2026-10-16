import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import { ApnError } from "../../src/errors.js";
import { BridgeRpcPhysicalBudget, RpcProviderScheduler, RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";

const raw = `0x${"02".repeat(32)}` as const;

test("LI.FI physical POST cap spans Ethereum, Base, read sessions and send; pacing is per provider family", async () => {
  let now = 0;
  const starts: Array<{ host: string; at: number }> = [], methods: string[] = [];
  const budget = new BridgeRpcPhysicalBudget(24), scheduler = new RpcProviderScheduler();
  const transport = { request: async (url: string, verb: string, body: string) => {
    assert.equal(verb, "POST"); const host = new URL(url).host; starts.push({ host, at: now });
    const request = JSON.parse(body) as { id: string; method: string };
    methods.push(request.method);
    const result = request.method === "eth_sendRawTransaction" ? keccak256(raw) : request.method === "eth_chainId" ?
      (host === "base.example" ? "0x2105" : "0x1") : "0x1";
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  } };
  const factory = bridgeRpcFactory({ APN_ETHEREUM_RPC_URL: "https://eth.example", APN_BASE_RPC_URL: "https://base.example" }, { transport });
  const session = () => new RpcReadSession({ now: () => now, wait: async (ms) => { now += ms; }, providerScheduler: scheduler, physicalBudget: budget });
  for (let index = 0; index < 23; index += 1) await factory(index % 2 === 0 ? 1 : 8453, session()).assertChain();
  assert.equal(await factory(1, session()).send(raw), keccak256(raw));
  await assert.rejects(factory(8453, session()).assertChain(), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(starts.length, 24); assert.equal(budget.remaining(), 0);
  assert.equal(methods.filter((method) => method === "eth_sendRawTransaction").length, 1);
  // The budget only counts; each provider family keeps its own 750 ms gap, so Ethereum and Base reads interleave freely.
  for (const host of ["eth.example", "base.example"]) {
    const own = starts.filter((start) => start.host === host).map((start) => start.at);
    assert.ok(own.every((at, index) => index === 0 || at - own[index - 1]! >= 750), host);
  }
  assert.ok(starts.some((start, index) => index > 0 && start.at - starts[index - 1]!.at < 750));
});

test("LI.FI first 429 consumes one physical POST and performs no retry", async () => {
  let calls = 0;
  const budget = new BridgeRpcPhysicalBudget(24);
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
  const budget = new BridgeRpcPhysicalBudget(24);
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

test("persisted family pacing spans sessions while another family's POST never delays it", async () => {
  let now = 0;
  const starts: Array<{ family: string; at: number }> = [];
  const persisted = new Map<string, number>();
  const coordinator = { coordinate: async <T>(family: string,
    work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
      saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) =>
    await work(persisted.get(family) ?? null, async (value) => { persisted.set(family, value); }, null, async () => {}) };
  const factory = bridgeRpcFactory({ APN_ETHEREUM_RPC_URL: "https://ethereum-rpc.publicnode.com",
    APN_BASE_RPC_URL: "https://base.drpc.org" }, { transport: { request: async (endpoint: string, _verb: string, body: string) => {
    const family = new URL(endpoint).hostname.endsWith("drpc.org") ? "drpc.org" : "publicnode.com";
    starts.push({ family, at: now });
    const request = JSON.parse(body) as { id: string };
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id,
      result: family === "drpc.org" ? "0x2105" : "0x1" }) };
  } } });
  const budget = new BridgeRpcPhysicalBudget(24);
  const first = new RpcReadSession({ now: () => now, wait: async (ms) => { now += ms; },
    providerScheduler: new RpcProviderScheduler(coordinator, () => now), physicalBudget: budget });
  await factory(1, first).assertChain();
  await factory(8453, first).assertChain();
  assert.equal(persisted.get("drpc.org"), 0);
  const sibling = new RpcReadSession({ now: () => now, wait: async (ms) => { now += ms; },
    providerScheduler: new RpcProviderScheduler(coordinator, () => now) });
  await factory(8453, sibling).assertChain();
  assert.deepEqual(starts, [
    { family: "publicnode.com", at: 0 }, { family: "drpc.org", at: 0 }, { family: "drpc.org", at: 750 },
  ]);
});

test("an in-process scheduler behind the physical gate treats an early timer wake as pacing, not a clock rollback", async () => {
  let now = 1_000; const starts: number[] = [];
  const budget = new BridgeRpcPhysicalBudget(24);
  // A real timer can fire about a millisecond before Date.now reaches its target; the transport then takes 50 ms.
  const session = new RpcReadSession({ now: () => now, wait: async (ms) => { now += ms > 1 ? ms - 1 : ms; }, physicalBudget: budget });
  const read = async (method: string) => await session.read("https://base.example", 8453, method, [], async () => { starts.push(now); now += 50; return "0x2105"; });
  assert.equal(await read("eth_chainId"), "0x2105"); assert.equal(await read("eth_maxPriorityFeePerGas"), "0x2105");
  assert.deepEqual(starts, [1_000, 1_799]); assert.equal(budget.remaining(), 22);
});

test("a clock that moves backwards across the physical gate is still refused before transport", async () => {
  let now = 1_000, calls = 0;
  class Rewinding extends BridgeRpcPhysicalBudget { override async beforePost(method: string) { await super.beforePost(method); now -= 5; } }
  const session = new RpcReadSession({ now: () => now, wait: async (ms) => { now += ms; }, physicalBudget: new Rewinding(24) });
  await assert.rejects(session.read("https://base.example", 8453, "eth_chainId", [], async () => { calls += 1; return "0x2105"; }),
    (error: unknown) => error instanceof ApnError && error.details?.reason === "rpc_scheduler_clock_rollback");
  assert.equal(calls, 0);
});
