import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { BridgeRpc, RpcReadSession, bridgeRpcCall } from "../../src/lifi/rpc.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";

const block = (number = "0x10") => ({ number, hash: `0x${"a".repeat(64)}`, timestamp: "0x1", baseFeePerGas: "0x1", transactions: [] });

test("RPC session key separates origins and chains while coalescing identical chain reads", async () => {
  const seen: string[] = [];
  const session = new RpcReadSession();
  const a = session.wrap("https://rpc-a.example", 1, async (method) => { seen.push(`a:${method}`); return "0x1"; });
  const b = session.wrap("https://rpc-b.example", 1, async (method) => { seen.push(`b:${method}`); return "0x1"; });
  const c = session.wrap("https://rpc-a.example", 8453, async (method) => { seen.push(`c:${method}`); return "0x2105"; });
  await Promise.all([a("eth_chainId", []), a("eth_chainId", [])]);
  await b("eth_chainId", []); await c("eth_chainId", []); await a("eth_chainId", []);
  assert.deepEqual(seen, ["a:eth_chainId", "b:eth_chainId", "c:eth_chainId"]);
  assert.equal(session.telemetry().dedupHits, 1);
  assert.equal(session.telemetry().singleflightHits, 1);
  assert.deepEqual(session.telemetry().perMethod, { eth_chainId: 3 });
});

test("RPC session endpoint identity keeps paths distinct while omitting credentials and query strings", async () => {
  let calls = 0;
  const session = new RpcReadSession({ wait: async () => {} });
  const withSecret = session.wrap("https://user:secret@rpc.example/path?key=secret", 1, async () => { calls += 1; return "0x1"; });
  const sameEndpoint = session.wrap("https://rpc.example/path?key=another-secret", 1, async () => { calls += 1; return "0x1"; });
  const differentPath = session.wrap("https://rpc.example/other-path", 1, async () => { calls += 1; return "0x1"; });
  await withSecret("eth_chainId", []);
  await sameEndpoint("eth_chainId", []);
  await differentPath("eth_chainId", []);
  assert.equal(calls, 2);
});

test("RPC session retains only immutable tagged reads and the safe header", async () => {
  const methods: string[] = [];
  const session = new RpcReadSession();
  const call = session.wrap("https://rpc.example", 8453, async (method, params) => {
    methods.push(`${method}:${JSON.stringify(params)}`);
    if (method === "eth_getBlockByNumber") return block();
    return method === "eth_getBalance" ? "0x1" : "0x2";
  });
  await call("eth_getBlockByNumber", ["safe", false]);
  await call("eth_getBlockByNumber", ["safe", false]);
  await call("eth_getCode", ["0x1", "0x10"]);
  await call("eth_getCode", ["0x1", "0x10"]);
  await call("eth_getBalance", ["0x1", "latest"]);
  await call("eth_getBalance", ["0x1", "latest"]);
  await call("eth_getTransactionCount", ["0x1", "pending"]);
  await call("eth_getTransactionCount", ["0x1", "pending"]);
  assert.equal(methods.filter((v) => v.startsWith("eth_getBlockByNumber")).length, 1);
  assert.equal(methods.filter((v) => v.startsWith("eth_getCode")).length, 1);
  assert.equal(methods.filter((v) => v.startsWith("eth_getBalance")).length, 2);
  assert.equal(methods.filter((v) => v.startsWith("eth_getTransactionCount")).length, 2);
});

test("RPC session singleflights concurrent mutable reads without retaining them", async () => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const session = new RpcReadSession();
  const call = session.wrap("https://rpc.example", 1, async () => { calls += 1; await gate; return "0x1"; });
  const first = call("eth_getBalance", ["0x1", "latest"]), second = call("eth_getBalance", ["0x1", "latest"]);
  await Promise.resolve();
  assert.equal(calls, 1); assert.equal(session.telemetry().singleflightHits, 1);
  release(); await Promise.all([first, second]);
  await call("eth_getBalance", ["0x1", "latest"]);
  assert.equal(calls, 2);
});

test("RPC session removes rejected singleflight entries and does not count expired queued attempts", async () => {
  let calls = 0, releaseRejected!: () => void;
  const rejected = new Promise<void>((resolve) => { releaseRejected = resolve; });
  const rejectionSession = new RpcReadSession();
  const failing = rejectionSession.wrap("https://reject.example", 1, async () => {
    calls += 1;
    await rejected;
    throw new ApnError("APN_RPC_PROTOCOL", "invalid response");
  });
  const firstFailure = failing("eth_getBalance", ["0x1", "latest"]);
  const secondFailure = failing("eth_getBalance", ["0x1", "latest"]);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(rejectionSession.telemetry().singleflightHits, 1);
  releaseRejected();
  await Promise.all([assert.rejects(firstFailure, { code: "APN_RPC_PROTOCOL" }), assert.rejects(secondFailure, { code: "APN_RPC_PROTOCOL" })]);
  await assert.rejects(failing("eth_getBalance", ["0x1", "latest"]), { code: "APN_RPC_PROTOCOL" });
  assert.equal(calls, 2);

  let now = 0, releaseQueued!: () => void;
  const gate = new Promise<void>((resolve) => { releaseQueued = resolve; });
  const session = new RpcReadSession({ maxHttpAttempts: 4, deadlineMs: 1_000, now: () => now,
    wait: async () => {} });

  let active = 0;
  const queued = session.wrap("https://queue.example", 1, async () => { active += 1; await gate; active -= 1; return "0x1"; });
  const first = queued("eth_chainId", []);
  await Promise.resolve();
  const second = queued("eth_getCode", ["0x1", "0x10"]);
  await Promise.resolve();
  assert.equal(active, 1);
  now = 1_000;
  releaseQueued();
  await first;
  await assert.rejects(second, { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(session.telemetry().totalAttempts, 1);
});

test("RPC session enforces per-origin pacing and two-origin global concurrency", async () => {
  let now = 0, active = 0, maximum = 0;
  const waits: number[] = [];
  const session = new RpcReadSession({ now: () => now, wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; } });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const make = (origin: string) => session.wrap(origin, 1, async () => { active += 1; maximum = Math.max(maximum, active); await gate; active -= 1; return "0x1"; });
  const a = make("https://a.example"), b = make("https://b.example"), c = make("https://c.example");
  const first = Promise.all([a("eth_getBalance", ["0x1", "latest"]), b("eth_getBalance", ["0x1", "latest"])]);
  await Promise.resolve(); await Promise.resolve(); assert.equal(maximum, 2);
  const third = c("eth_getBalance", ["0x1", "latest"]); await Promise.resolve(); assert.equal(maximum, 2);
  release(); await Promise.all([first, third]);
  assert.equal(maximum, 2); assert.equal(waits.includes(750), false);
  const again = make("https://a.example");
  await again("eth_getBalance", ["0x2", "latest"]);
  assert.ok(waits.includes(750));
});

test("RPC session fails closed at unique call, attempt and deadline budgets", async () => {
  const one = new RpcReadSession({ maxUniqueCalls: 1 });
  const first = one.wrap("https://a.example", 1, async () => "0x1");
  await first("eth_chainId", []);
  await assert.rejects(first("eth_getBalance", ["0x1", "latest"]), { code: "APN_RPC_BUDGET_EXCEEDED" });

  const two = new RpcReadSession({ maxHttpAttempts: 1, wait: async () => {} });
  const transient = two.wrap("https://a.example", 1, async () => {
    throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" });
  });
  await assert.rejects(transient("eth_chainId", []), { code: "APN_RPC_BUDGET_EXCEEDED" });

  let now = 0;
  const deadline = new RpcReadSession({ deadlineMs: 1, now: () => now });
  const bounded = deadline.wrap("https://a.example", 1, async () => { now = 1; return "0x1"; });
  await bounded("eth_chainId", []);
  await assert.rejects(bounded("eth_getBalance", ["0x1", "latest"]), { code: "APN_RPC_BUDGET_EXCEEDED" });
});

test("RPC session rejects the 65th representative unique read before HTTP", async () => {
  let calls = 0;
  const session = new RpcReadSession({ maxUniqueCalls: 64, maxHttpRequests: 64, maxHttpAttempts: 64, wait: async () => {} });
  const call = session.wrap("https://budget.example", 1, async () => { calls += 1; return "0x1"; });
  for (let i = 1; i <= 64; i += 1) await call("eth_getCode", ["0x1", `0x${i.toString(16)}`]);
  await assert.rejects(call("eth_getCode", ["0x1", "0x41"]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(calls, 64);
});

test("RPC session applies typed 429 cooldown and one retry for 408", async () => {
  let calls = 0; const waits: number[] = [];
  const transport = { request: async (_endpoint: string, _method: string, body: string) => {
    const request = JSON.parse(body) as { id: string };
    calls += 1;
    if (calls === 1) return { status: 429, body: "", headers: { "retry-after": "5" } };
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }) };
  } };
  const descriptor = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base.example" }, { transport });
  const cooldown = new RpcReadSession({ wait: async (milliseconds) => { waits.push(milliseconds); } });
  const rpc = new BridgeRpc(8453, descriptor.origin, descriptor.call, cooldown, descriptor.attempt);
  await assert.rejects(rpc.assertChain(), (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_RATE_LIMITED" && error.details?.retryAfterMs === "5000");
  assert.equal(calls, 1); assert.deepEqual(waits, []);

  calls = 0; const retryWaits: number[] = [];
  const retryTransport = { request: async (_endpoint: string, _method: string, body: string) => {
    const request = JSON.parse(body) as { id: string };
    calls += 1; return calls === 1 ? { status: 408, body: "" } : { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }) };
  } };
  const retryDescriptor = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base.example" }, { transport: retryTransport });
  const retrySession = new RpcReadSession({ wait: async (milliseconds) => { retryWaits.push(milliseconds); } });
  await new BridgeRpc(8453, retryDescriptor.origin, retryDescriptor.call, retrySession, retryDescriptor.attempt).assertChain();
  assert.equal(calls, 2); assert.ok(retryWaits.includes(2_000));
});

test("RPC session parses HTTP-date Retry-After using its injected clock", async () => {
  const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
  let calls = 0; const waits: number[] = [];
  const transport = { request: async (_endpoint: string, _method: string, body: string) => {
    const request = JSON.parse(body) as { id: string };
    calls += 1;
    if (calls === 1) return { status: 503, body: "", headers: { "retry-after": "Wed, 21 Oct 2015 07:28:05 GMT" } };
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }) };
  } };
  const descriptor = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base.example" }, { transport });
  const session = new RpcReadSession({ now: () => now, wait: async (milliseconds) => { waits.push(milliseconds); } });
  await descriptor.sessionCall(session)("eth_chainId", []);
  assert.equal(calls, 2); assert.ok(waits.includes(5_000));
});

test("raw transaction submission makes one attempt and bypasses session scheduler", async () => {
  let calls = 0;
  const transport = { request: async () => { calls += 1; return { status: 503, body: "" }; } };
  const descriptor = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base.example" }, { transport });
  const rpc = new BridgeRpc(8453, descriptor.origin, descriptor.call, new RpcReadSession(), descriptor.attempt);
  await assert.rejects(rpc.send("0x02"), { code: "APN_RPC_PROTOCOL" });
  assert.equal(calls, 1); assert.equal(new RpcReadSession().telemetry().totalAttempts, 0);
});

test("RPC batch maps out-of-order ids exactly and rejects missing, duplicate, extra, suberror and non-array responses without fallback", async () => {
  const cases: Array<{ name: string; shape: (requests: Array<{ id: string }>) => unknown; code: string }> = [
    { name: "missing", shape: (r) => [{ jsonrpc: "2.0", id: r[0]!.id, result: "0x1" }], code: "APN_RPC_PROTOCOL" },
    { name: "duplicate", shape: (r) => [{ jsonrpc: "2.0", id: r[0]!.id, result: "0x1" }, { jsonrpc: "2.0", id: r[0]!.id, result: "0x2" }], code: "APN_RPC_PROTOCOL" },
    { name: "extra", shape: (r) => [{ jsonrpc: "2.0", id: r[0]!.id, result: "0x1" }, { jsonrpc: "2.0", id: "999", result: "0x2" }], code: "APN_RPC_PROTOCOL" },
    { name: "suberror", shape: (r) => [{ jsonrpc: "2.0", id: r[0]!.id, result: "0x1" }, { jsonrpc: "2.0", id: r[1]!.id, error: { code: -32000, message: "failed" } }], code: "APN_RPC_PROTOCOL" },
    { name: "non-array", shape: () => ({ jsonrpc: "2.0", id: "1", error: { code: -32600, message: "batch unsupported" } }), code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" },
  ];
  for (const row of cases) {
    let requests = 0;
    const transport = { request: async (_endpoint: string, _method: string, body: string) => {
      requests += 1; const parsed = JSON.parse(body) as Array<{ id: string }>;
      return { status: 200, body: JSON.stringify(row.shape(parsed)) };
    } };
    const descriptor = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://ethereum.example" }, { transport });
    const batch = descriptor.sessionBatchCall(new RpcReadSession({ wait: async () => {} }));
    await assert.rejects(batch([
      { method: "eth_chainId", params: [], cachePolicy: "immutable" },
      { method: "eth_getBlockByNumber", params: ["safe", false], cachePolicy: "immutable" },
    ]), (error: unknown) => error instanceof ApnError && error.code === row.code, row.name);
    assert.equal(requests, 1, row.name);
  }

  const transport = { request: async (_endpoint: string, _method: string, body: string) => {
    const parsed = JSON.parse(body) as Array<{ id: string; method: string }>;
    return { status: 200, body: JSON.stringify([...parsed].reverse().map((request) => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_chainId" ? "0x1" : block() }))) };
  } };
  const descriptor = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://ethereum.example" }, { transport });
  const result = await descriptor.sessionBatchCall(new RpcReadSession({ wait: async () => {} }))([
    { method: "eth_chainId", params: [], cachePolicy: "immutable" },
    { method: "eth_getBlockByNumber", params: ["safe", false], cachePolicy: "immutable" },
  ]);
  assert.equal(result[0], "0x1"); assert.deepEqual(result[1], block());
});

test("RPC batch enforces 32/96/8/10/deadline bounds and removes cached immutable keys before HTTP", async () => {
  let calls = 0;
  const attempt = async (items: readonly { method: string }[]) => { calls += 1; return items.map(() => "0x1"); };
  const item = (index: number) => ({ method: "eth_getCode", params: ["0x1", `0x${index.toString(16)}`], cachePolicy: "immutable" as const, batchAttempt: attempt });
  await assert.rejects(new RpcReadSession().readBatch("https://rpc.example", 1, Array.from({ length: 33 }, (_, i) => item(i))), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(calls, 0);

  const logical = new RpcReadSession({ maxHttpRequests: 8, wait: async () => {} });
  for (let page = 0; page < 3; page += 1) await logical.readBatch("https://rpc.example", 1, Array.from({ length: 32 }, (_, i) => item(page * 32 + i)));
  await assert.rejects(logical.readBatch("https://rpc.example", 1, [item(97)]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(logical.telemetry().logicalItems, 96);

  const requests = new RpcReadSession({ maxLogicalItems: 96, maxHttpRequests: 8, wait: async () => {} });
  for (let i = 0; i < 8; i += 1) await requests.readBatch("https://rpc.example", 1, [item(200 + i)]);
  await assert.rejects(requests.readBatch("https://rpc.example", 1, [item(300)]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(requests.telemetry().httpRequests, 8);

  let attemptNumber = 0;
  const retryAttempt = async (items: readonly { method: string }[]) => {
    attemptNumber += 1;
    if (attemptNumber % 2 === 1) throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" });
    return items.map(() => "0x1");
  };
  const attempts = new RpcReadSession({ maxHttpRequests: 8, maxHttpAttempts: 10, wait: async () => {} });
  for (let i = 0; i < 5; i += 1) await attempts.readBatch("https://rpc.example", 1, [{ ...item(400 + i), batchAttempt: retryAttempt }]);
  await assert.rejects(attempts.readBatch("https://rpc.example", 1, [{ ...item(500), batchAttempt: retryAttempt }]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(attempts.telemetry().httpAttempts, 10);

  let now = 0;
  const deadline = new RpcReadSession({ deadlineMs: 1, now: () => now, wait: async () => {} });
  await deadline.readBatch("https://rpc.example", 1, [{ ...item(600), batchAttempt: async (items) => { now = 1; return items.map(() => "0x1"); } }]);
  await assert.rejects(deadline.readBatch("https://rpc.example", 1, [item(601)]), { code: "APN_RPC_BUDGET_EXCEEDED" });

  let observedSizes: number[] = [];
  const cachedAttempt = async (items: readonly { method: string }[]) => { observedSizes.push(items.length); return items.map(() => "0x1"); };
  const cached = new RpcReadSession({ wait: async () => {} });
  const first = { ...item(700), batchAttempt: cachedAttempt }, second = { ...item(701), batchAttempt: cachedAttempt };
  await cached.readBatch("https://rpc.example", 1, [first]);
  await cached.readBatch("https://rpc.example", 1, [first, second]);
  assert.deepEqual(observedSizes, [1, 1]); assert.equal(cached.telemetry().cacheHits, 1);
});

test("whole RPC batch treats 429 as one attempt and retries a transient response at most once", async () => {
  for (const status of [400, 429, 503]) {
    let calls = 0;
    const transport = { request: async (_endpoint: string, _method: string, body: string) => {
      calls += 1; const request = JSON.parse(body) as Array<{ id: string }>;
      if (calls === 1) return { status, body: "", ...(status === 429 ? { headers: { "retry-after": "1" } } : {}) };
      return { status: 200, body: JSON.stringify(request.map((item) => ({ jsonrpc: "2.0", id: item.id, result: "0x1" }))) };
    } };
    const descriptor = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://ethereum.example" }, { transport });
    const session = new RpcReadSession({ wait: async () => {} }), batch = descriptor.sessionBatchCall(session);
    if (status === 400) await assert.rejects(batch([{ method: "eth_chainId", params: [], cachePolicy: "immutable" }]), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
    else if (status === 429) await assert.rejects(batch([{ method: "eth_chainId", params: [], cachePolicy: "immutable" }]), { code: "APN_RPC_RATE_LIMITED" });
    else assert.deepEqual(await batch([{ method: "eth_chainId", params: [], cachePolicy: "immutable" }]), ["0x1"]);
    assert.equal(calls, status === 503 ? 2 : 1); assert.equal(session.telemetry().httpRequests, 1);
    assert.equal(session.telemetry().httpAttempts, status === 503 ? 2 : 1);
  }
});

test("Base source mutable snapshot, estimate and two-effect fee inputs use three fresh command batches", async () => {
  const owner = `0x${"11".repeat(20)}` as `0x${string}`, token = BRIDGE_ASSET_REGISTRY[8453].tokens.find((row) => row.symbol === "USDC")!.address,
    spender = `0x${"33".repeat(20)}` as `0x${string}`, hash = `0x${"44".repeat(32)}`;
  const header = { number: "0x100", hash, timestamp: "0x10", baseFeePerGas: "0x2", transactions: [] };
  let transportCalls = 0;
  const attempt = async (items: readonly { method: string; params: readonly unknown[] }[]) => {
    transportCalls += 1;
    return items.map((item) => {
      if (item.method === "eth_chainId") return "0x2105";
      if (item.method === "eth_getBlockByNumber") return header;
      if (item.method === "eth_getBalance") return "0x100000000000000000";
      if (item.method === "eth_getTransactionCount") return "0x7";
      if (item.method === "eth_estimateGas") return "0x10000";
      if (item.method === "eth_maxPriorityFeePerGas") return "0x1";
      if (item.method === "eth_call") return `0x${"0".repeat(64)}`;
      throw new Error(`unexpected ${item.method}`);
    });
  };
  const make = () => {
    const session = new RpcReadSession({ wait: async () => {} });
    const batchFactory = (bound: RpcReadSession) => async (items: readonly Omit<import("../../src/lifi/rpc.js").RpcBatchReadItem, "batchAttempt">[]) =>
      await bound.readBatch("https://base.example", 8453, items.map((item) => ({ ...item, batchAttempt: attempt })));
    const rpc = new BridgeRpc(8453, "https://base.example", async () => { throw new Error("serial fallback forbidden"); }, session,
      async () => { throw new Error("serial fallback forbidden"); }, undefined, batchFactory);
    return { rpc, session };
  };
  const first = make();
  const account = await first.rpc.account(owner, spender, token);
  assert.equal(account.latestNonceAtomic, "7");
  const estimate = await first.rpc.estimate({ chainId: 8453, from: owner, to: spender, data: "0x", valueAtomic: "0", gasLimitAtomic: "0" });
  assert.equal(estimate.gasLimitAtomic, "65536");
  await first.rpc.prices();
  const common = { maxFeePerGasAtomic: "5", maxPriorityFeePerGasAtomic: "1" };
  const quotes = await first.rpc.feeQuotes([
    { economics: { ...common, nonceAtomic: "7", gasLimitAtomic: "65536", maximumGasCostAtomic: "327680" } },
    { economics: { ...common, nonceAtomic: "8", gasLimitAtomic: "300000", maximumGasCostAtomic: "1500000" } },
  ]);
  assert.equal(quotes.length, 2); assert.equal(first.session.telemetry().httpRequests, 3); assert.equal(first.session.telemetry().batchCount, 3);
  assert.equal(transportCalls, 3);

  const fresh = make(); await fresh.rpc.account(owner, spender, token);
  assert.equal(fresh.session.telemetry().httpRequests, 1); assert.equal(transportCalls, 4);
});
