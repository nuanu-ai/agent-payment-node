import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { BridgeRpc, RpcProviderScheduler, RpcReadSession, bridgeRpcCall } from "../../src/lifi/rpc.js";
import { RPC_READ_METHODS, RpcHttpFailure, rpcProviderFamily } from "../../src/lifi/rpc-session.js";
import { rpcBlockValue, rpcFeeBlockValue } from "../../src/lifi/rpc-batch-codec.js";
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

test("shared scheduler serializes sibling provider subdomains across sessions", async () => {
  let now = 0, active = 0, maximum = 0;
  const waits: number[] = [], scheduler = new RpcProviderScheduler();
  const options = { providerScheduler: scheduler, now: () => now, wait: async (milliseconds: number) => { waits.push(milliseconds); now += milliseconds; } };
  const base = new RpcReadSession(options).wrap("https://base-rpc.publicnode.com", 8453, async () => {
    active += 1; maximum = Math.max(maximum, active); await Promise.resolve(); active -= 1; return "0x1";
  });
  const arbitrum = new RpcReadSession(options).wrap("https://arbitrum-one-rpc.publicnode.com", 42161, async () => {
    active += 1; maximum = Math.max(maximum, active); await Promise.resolve(); active -= 1; return "0x1";
  });
  await Promise.all([base("eth_chainId", []), arbitrum("eth_chainId", [])]);
  assert.equal(maximum, 1); assert.deepEqual(waits, [750]);
});

test("shared scheduler serializes Base and Arbitrum dRPC siblings across sessions", async () => {
  let now = 0, active = 0, maximum = 0;
  const waits: number[] = [], scheduler = new RpcProviderScheduler();
  const options = { providerScheduler: scheduler, now: () => now, wait: async (milliseconds: number) => { waits.push(milliseconds); now += milliseconds; } };
  const call = (origin: string, chainId: 8453 | 42161) => new RpcReadSession(options).wrap(origin, chainId, async () => {
    active += 1; maximum = Math.max(maximum, active); await Promise.resolve(); active -= 1; return "0x1";
  });
  await Promise.all([
    call("https://base.drpc.org/archive?token=redacted", 8453)("eth_chainId", []),
    call("https://arbitrum.drpc.org/other", 42161)("eth_chainId", []),
  ]);
  assert.equal(maximum, 1); assert.deepEqual(waits, [750]);
});

test("dRPC family identity covers official single-label siblings and excludes deceptive hosts", () => {
  assert.equal(rpcProviderFamily("https://user:secret@base.drpc.org/archive?key=secret"), "drpc.org");
  assert.equal(rpcProviderFamily("https://arbitrum.drpc.org"), "drpc.org");
  assert.equal(rpcProviderFamily("https://ethereum.drpc.org"), "drpc.org");
  assert.equal(rpcProviderFamily("https://drpc.org"), "drpc.org");
  assert.equal(rpcProviderFamily("https://drpc.org.evil.example"), "drpc.org.evil.example");
  assert.equal(rpcProviderFamily("https://evil-drpc.org"), "evil-drpc.org");
  assert.equal(rpcProviderFamily("https://not.allowed.drpc.org"), "not.allowed.drpc.org");
});

test("dRPC family pacing persists across Ethereum, Base and Arbitrum process records without endpoint secrets", async () => {
  let now = 10_000, persisted: number | null = null, cooldown: number | null = null;
  const waits: number[] = [], families: string[] = [];
  const coordinator = { coordinate: async <T>(family: string,
    work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
      saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) => {
    families.push(family); return await work(persisted, async (value) => { persisted = value; }, cooldown,
      async (value) => { cooldown = value; });
  } };
  const run = async (origin: string, chainId: 1 | 8453 | 42161) => {
    const session = new RpcReadSession({ providerScheduler: new RpcProviderScheduler(coordinator, () => now), now: () => now,
      wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; } });
    await session.wrap(origin, chainId, async () => "0x1")("eth_chainId", []);
  };
  await run("https://user:secret@ethereum.drpc.org/rpc?key=secret", 1);
  await run("https://base.drpc.org/archive?token=secret", 8453);
  await run("https://arbitrum.drpc.org/", 42161);
  assert.deepEqual(families, ["drpc.org", "drpc.org", "drpc.org"]);
  assert.deepEqual(waits, [750, 750]); assert.equal(persisted, 11_500);
});

test("dRPC Retry-After blocks concurrent sibling processes until shared cooldown and pacing expire", async () => {
  let now = 0, attempts = 0, siblingCalls = 0, persisted: number | null = null, cooldown: number | null = null;
  let tail = Promise.resolve(), releaseBaseRetry!: () => void, releaseSiblingCooldown!: () => void, releaseBasePacing!: () => void;
  const baseRetry = new Promise<void>((resolve) => { releaseBaseRetry = resolve; });
  const siblingCooldown = new Promise<void>((resolve) => { releaseSiblingCooldown = resolve; });
  const basePacing = new Promise<void>((resolve) => { releaseBasePacing = resolve; });
  const families: string[] = [], coordinator = { coordinate: async <T>(family: string,
    work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
      saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) => {
    let unlock!: () => void; const previous = tail; tail = new Promise<void>((resolve) => { unlock = resolve; }); await previous;
    families.push(family);
    try { return await work(persisted, async (value) => { persisted = value; }, cooldown, async (value) => { cooldown = value; }); }
    finally { unlock(); }
  } };
  const baseWaits: number[] = [], siblingWaits: number[] = [];
  const base = new RpcReadSession({ providerScheduler: new RpcProviderScheduler(coordinator, () => now), now: () => now,
    wait: async (milliseconds) => { baseWaits.push(milliseconds); await (milliseconds === 5_000 ? baseRetry : basePacing); } });
  const baseRead = base.read("https://base.drpc.org/archive", 8453, "eth_chainId", [], async () => {
    attempts += 1; if (attempts === 1) throw new RpcHttpFailure("eth_chainId", 429, 5_000); return "0x2105";
  });
  while (baseWaits.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cooldown, 5_000);
  const sibling = new RpcReadSession({ providerScheduler: new RpcProviderScheduler(coordinator, () => now), now: () => now,
    wait: async (milliseconds) => { siblingWaits.push(milliseconds); await siblingCooldown; } });
  const siblingRead = sibling.read("https://arbitrum.drpc.org/archive", 42161, "eth_chainId", [], async () => {
    siblingCalls += 1; return "0xa4b1";
  });
  while (siblingWaits.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(siblingCalls, 0); assert.deepEqual(siblingWaits, [5_000]);
  now = 5_000; releaseSiblingCooldown(); await siblingRead;
  assert.equal(siblingCalls, 1); assert.equal(persisted, 5_000);
  releaseBaseRetry();
  while (baseWaits.length < 2) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(attempts, 1); assert.deepEqual(baseWaits, [5_000, 750]);
  now = 5_750; releaseBasePacing(); await baseRead;
  assert.equal(attempts, 2); assert.deepEqual(families, ["drpc.org", "drpc.org", "drpc.org"]);
});

test("provider-family pacing survives scheduler restart through its coordinator", async () => {
  let now = 10_000, persisted: number | null = null, calls = 0;
  const waits: number[] = [];
  const coordinator = { coordinate: async <T>(_family: string,
    work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
      saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) =>
    await work(persisted, async (value) => { persisted = value; }, null, async () => {}) };
  const run = async (origin: string) => {
    const session = new RpcReadSession({ providerScheduler: new RpcProviderScheduler(coordinator, () => now), now: () => now,
      wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; } });
    await session.wrap(origin, 8453, async () => { calls += 1; return "0x1"; })("eth_chainId", []);
  };
  await run("https://base-rpc.publicnode.com");
  await run("https://arbitrum-one-rpc.publicnode.com");
  assert.equal(calls, 2); assert.deepEqual(waits, [750]); assert.equal(persisted, 10_750);
});

test("provider-family scheduler rejects a persisted wall-clock rollback before transport", async () => {
  let calls = 0;
  const coordinator = { coordinate: async <T>(_family: string,
    work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
      saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) =>
    await work(10_000, async () => {}, null, async () => {}) };
  const session = new RpcReadSession({ providerScheduler: new RpcProviderScheduler(coordinator, () => 9_999), now: () => 9_999, wait: async () => {} });
  await assert.rejects(session.read("https://base-rpc.publicnode.com", 8453, "eth_chainId", [], async () => {
    calls += 1; return "0x2105";
  }), (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_CONFIG" &&
    error.details?.reason === "rpc_scheduler_clock_rollback");
  assert.equal(calls, 0);
});

test("provider-family scheduler rejects a stalled clock during persisted cooldown before transport", async () => {
  let calls = 0;
  const coordinator = { coordinate: async <T>(_family: string,
    work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
      saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) =>
    await work(0, async () => {}, 5_000, async () => {}) };
  const session = new RpcReadSession({ providerScheduler: new RpcProviderScheduler(coordinator, () => 0), now: () => 0, wait: async () => {} });
  await assert.rejects(session.read("https://base.drpc.org", 8453, "eth_chainId", [], async () => {
    calls += 1; return "0x2105";
  }), (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_CONFIG" &&
    error.details?.reason === "rpc_scheduler_clock_rollback");
  assert.equal(calls, 0);
});

test("provider-family scheduler bounds persisted Retry-After cooldown to thirty seconds", async () => {
  let saved: number | null = null;
  const coordinator = { coordinate: async <T>(_family: string,
    work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null,
      saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>) =>
    await work(null, async () => {}, null, async (value) => { saved = value; }) };
  const scheduler = new RpcProviderScheduler(coordinator, () => 1_000);
  await assert.rejects(scheduler.schedule("https://base.drpc.org", () => 1_000, async () => {}, () => {}, async () => {
    throw new RpcHttpFailure("eth_chainId", 429, 60_000);
  }), RpcHttpFailure);
  assert.equal(saved, 31_000);
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

test("RPC session honors Retry-After once for idempotent 429 and retains one retry for 408", async () => {
  let calls = 0, cooldownNow = 0; const waits: number[] = [];
  const transport = { request: async (_endpoint: string, _method: string, body: string) => {
    const request = JSON.parse(body) as { id: string };
    calls += 1;
    if (calls === 1) return { status: 429, body: "", headers: { "retry-after": "5" } };
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x2105" }) };
  } };
  const descriptor = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base.example" }, { transport });
  const cooldown = new RpcReadSession({ now: () => cooldownNow,
    wait: async (milliseconds) => { waits.push(milliseconds); cooldownNow += milliseconds; } });
  const rpc = new BridgeRpc(8453, descriptor.origin, descriptor.call, cooldown, descriptor.attempt);
  await rpc.assertChain();
  assert.equal(calls, 2); assert.deepEqual(waits, [5_000]);

  calls = 0; let limitedNow = 0; const boundedWaits: number[] = [];
  const alwaysLimited = { request: async () => { calls += 1; return { status: 429, body: "", headers: { "retry-after": "1" } }; } };
  const limitedDescriptor = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://limited.example" }, { transport: alwaysLimited });
  const limited = new BridgeRpc(8453, limitedDescriptor.origin, limitedDescriptor.call,
    new RpcReadSession({ now: () => limitedNow,
      wait: async (milliseconds) => { boundedWaits.push(milliseconds); limitedNow += milliseconds; } }), limitedDescriptor.attempt);
  await assert.rejects(limited.assertChain(), (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_RATE_LIMITED" &&
    error.details?.retryAfterMs === "1000" && error.details?.httpAttempts === "2");
  assert.equal(calls, 2); assert.deepEqual(boundedWaits, [2_000]);

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

test("RPC read boundary rejects send, unknown, personal, admin, filter and subscription methods without transport", async () => {
  let calls = 0;
  const attempt = async () => { calls += 1; return "0x1"; };
  const session = new RpcReadSession({ wait: async () => {} });
  for (const method of ["eth_sendRawTransaction", "eth_unknownRead", "personal_sign", "admin_nodeInfo", "eth_newFilter", "eth_subscribe"]) {
    await assert.rejects(session.read("https://rpc.example", 1, method, [], attempt),
      (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_PROTOCOL" && error.details?.reason === "bridge_RPC_read_method");
  }
  await assert.rejects(session.wrap("https://rpc.example", 1, attempt)("eth_sendRawTransaction", ["0x02"]),
    (error: unknown) => error instanceof ApnError && error.details?.reason === "bridge_RPC_read_method");
  assert.equal(calls, 0);
});

test("RPC mixed batch validates every read method before transport", async () => {
  let calls = 0;
  const attempt = async () => { calls += 1; return []; };
  await assert.rejects(new RpcReadSession().readBatch("https://rpc.example", 1, [
    { method: "eth_chainId", params: [], decoder: passthrough, batchAttempt: attempt },
    { method: "eth_sendRawTransaction", params: ["0x02"], decoder: passthrough, batchAttempt: attempt },
  ]), (error: unknown) => error instanceof ApnError && error.details?.reason === "bridge_RPC_read_method");
  assert.equal(calls, 0);
});

test("RPC read allowlist admits every APN bridge observation, simulation, fee and state method", async () => {
  const seen: string[] = [];
  for (const method of RPC_READ_METHODS) {
    const session = new RpcReadSession();
    await session.read(`https://${method.toLowerCase()}.example`, 1, method, [], async (observed) => {
      seen.push(observed); return "0x1";
    });
  }
  assert.deepEqual(seen, [...RPC_READ_METHODS]);
});

const passthrough = (value: unknown) => value;
const canonicalQuantity = (value: unknown) => {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) throw new ApnError("APN_RPC_PROTOCOL", "bad quantity");
  return BigInt(value);
};
function batchResults(body: string, result: (request: { id: string; method: string; params: readonly unknown[] }, index: number) => unknown) {
  const parsed = JSON.parse(body) as { id: string; method: string; params: readonly unknown[] } | Array<{ id: string; method: string; params: readonly unknown[] }>;
  const requests = Array.isArray(parsed) ? parsed : [parsed];
  const responses = requests.map((request, index) => ({ jsonrpc: "2.0", id: request.id, result: result(request, index) }));
  return Array.isArray(parsed) ? responses : responses[0];
}

test("session cache keeps raw chain IDs across serial and batch decoder modes", async () => {
  let serialCalls = 0, batchCalls = 0;
  const quantity = (value: unknown) => { if (typeof value !== "string") throw new ApnError("APN_RPC_PROTOCOL", "bad quantity"); return BigInt(value); };
  const session = new RpcReadSession({ wait: async () => {} });
  const serial = async () => { serialCalls += 1; return "0x1"; };
  const first = await session.read("https://rpc.example", 1, "eth_chainId", [], serial, quantity);
  const second = await session.readBatch("https://rpc.example", 1, [{ method: "eth_chainId", params: [], cachePolicy: "immutable",
    decoder: quantity, batchAttempt: async (body) => { batchCalls += 1; return batchResults(body, () => "0x1"); } }]);
  assert.equal(first, 1n); assert.deepEqual(second, [1n]); assert.equal(serialCalls, 1); assert.equal(batchCalls, 0);
  assert.equal(session.telemetry().httpRequests, 1); assert.equal(session.telemetry().cacheHits, 1);
});

test("batch and serial reads independently decode one raw cache value", async () => {
  let batchCalls = 0, serialCalls = 0;
  const quantity = (value: unknown) => { if (typeof value !== "string") throw new ApnError("APN_RPC_PROTOCOL", "bad quantity"); return BigInt(value); };
  const asLabel = (value: unknown) => typeof value === "string" ? `chain:${value}` : (() => { throw new ApnError("APN_RPC_PROTOCOL", "bad chain"); })();
  const session = new RpcReadSession({ wait: async () => {} });
  const batch = await session.readBatch("https://rpc.example", 1, [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: quantity,
    batchAttempt: async (body) => { batchCalls += 1; return batchResults(body, () => "0x1"); } }]);
  const serial = await session.read("https://rpc.example", 1, "eth_chainId", [], async () => { serialCalls += 1; return "wrong"; }, asLabel);
  const secondBatch = await session.readBatch("https://rpc.example", 1, [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: asLabel,
    batchAttempt: async (body) => { batchCalls += 1; return batchResults(body, () => "wrong"); } }]);
  assert.deepEqual(batch, [1n]); assert.equal(serial, "chain:0x1"); assert.deepEqual(secondBatch, ["chain:0x1"]);
  assert.equal(batchCalls, 1); assert.equal(serialCalls, 0); assert.equal(session.telemetry().httpRequests, 1);
});

test("decoder failure on a cache hit preserves the valid raw value", async () => {
  let calls = 0;
  const quantity = (value: unknown) => { if (typeof value !== "string") throw new ApnError("APN_RPC_PROTOCOL", "bad quantity"); return BigInt(value); };
  const session = new RpcReadSession({ wait: async () => {} });
  const item = (decoder: (value: unknown) => unknown) => ({ method: "eth_chainId", params: [], cachePolicy: "immutable" as const, decoder,
    batchAttempt: async (body: string) => { calls += 1; return batchResults(body, () => "0x1"); } });
  assert.deepEqual(await session.readBatch("https://rpc.example", 1, [item(quantity)]), [1n]);
  await assert.rejects(session.readBatch("https://rpc.example", 1, [item(() => { throw new ApnError("APN_CHAIN_MISMATCH", "wrong chain"); })]), { code: "APN_CHAIN_MISMATCH" });
  assert.deepEqual(await session.readBatch("https://rpc.example", 1, [item(quantity)]), [1n]);
  assert.equal(calls, 1); assert.equal(session.telemetry().httpRequests, 1);
});

test("safe, finalized and numeric header block decoders share raw cross-mode cache entries", async () => {
  const session = new RpcReadSession({ wait: async () => {} }); let calls = 0;
  const cases: Array<{ tag: string; decoder: (value: unknown) => Record<string, unknown> }> = [
    { tag: "safe", decoder: rpcBlockValue }, { tag: "finalized", decoder: rpcBlockValue }, { tag: "0x12", decoder: rpcFeeBlockValue },
  ];
  for (const entry of cases) {
    const raw = block(entry.tag === "0x12" ? "0x12" : entry.tag === "safe" ? "0x10" : "0x11");
    const serial = await session.read("https://rpc.example", 1, "eth_getBlockByNumber", [entry.tag, false], async () => { calls += 1; return raw; }, entry.decoder);
    const batch = await session.readBatch("https://rpc.example", 1, [{ method: "eth_getBlockByNumber", params: [entry.tag, false], cachePolicy: "immutable", decoder: entry.decoder,
      batchAttempt: async (body) => { calls += 1; return batchResults(body, () => raw); } }]);
    assert.deepEqual(serial, raw); assert.deepEqual(batch, [raw]);
  }
  assert.equal(calls, cases.length); assert.equal(session.telemetry().httpRequests, cases.length); assert.equal(session.telemetry().cacheHits, cases.length);
});

test("serial assertChain followed by batch safe block uses the same session without chain mismatch", async () => {
  let calls = 0;
  const transport = { request: async (_endpoint: string, _method: string, body: string) => {
    calls += 1;
    const request = JSON.parse(body) as { id: string; method: string } | Array<{ id: string; method: string }>;
    const rows = Array.isArray(request) ? request : [request];
    const response = rows.map((row) => ({ jsonrpc: "2.0", id: row.id, result: row.method === "eth_chainId" ? "0x1" : block() }));
    return { status: 200, body: JSON.stringify(Array.isArray(request) ? response : response[0]) };
  } };
  const descriptor = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://ethereum.example" }, { transport });
  const session = new RpcReadSession({ wait: async () => {} });
  const rpc = new BridgeRpc(1, descriptor.origin, descriptor.call, session, descriptor.attempt, descriptor.sessionCall, descriptor.sessionBatchCall);
  await rpc.assertChain();
  assert.deepEqual(await rpc.block("safe"), { numberAtomic: "16", hash: `0x${"a".repeat(64)}`, timestampAtomic: "1" });
  assert.equal(calls, 2); assert.equal(session.telemetry().logicalItems, 2); assert.equal(session.telemetry().httpRequests, 2);
  assert.equal(session.telemetry().batchCount, 0); assert.equal(session.telemetry().cacheHits, 1);
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
      { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: passthrough },
      { method: "eth_getBlockByNumber", params: ["safe", false], cachePolicy: "immutable", decoder: passthrough },
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
    { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: canonicalQuantity },
    { method: "eth_getBlockByNumber", params: ["safe", false], cachePolicy: "immutable", decoder: passthrough },
  ]);
  assert.equal(result[0], 1n); assert.deepEqual(result[1], block());
});

test("batch decoder failure commits no cache and the next read resends every item", async () => {
  let calls = 0; const sizes: number[] = [];
  const attempt = async (body: string) => {
    calls += 1; const requests = JSON.parse(body) as Array<{ id: string; method: string; params: readonly unknown[] }>;
    sizes.push(requests.length);
    return requests.map((request) => ({ jsonrpc: "2.0", id: request.id,
      result: request.method === "eth_getBalance" ? (calls === 1 ? "malformed" : "0x2") : "0x6000" }));
  };
  const items = [
    { method: "eth_getCode", params: ["0x1", "0x10"], cachePolicy: "immutable" as const, decoder: passthrough, batchAttempt: attempt },
    { method: "eth_getBalance", params: ["0x1", "0x10"], cachePolicy: "immutable" as const, decoder: canonicalQuantity, batchAttempt: attempt },
  ];
  const session = new RpcReadSession({ wait: async () => {} });
  await assert.rejects(session.readBatch("https://rpc.example", 1, items), { code: "APN_RPC_PROTOCOL" });
  assert.equal(session.telemetry().cacheHits, 0);
  assert.deepEqual(await session.readBatch("https://rpc.example", 1, items), ["0x6000", 2n]);
  assert.deepEqual(sizes, [2, 2]); assert.equal(session.telemetry().cacheHits, 0);
});

test("RPC batch enforces 33/96/8/10/deadline bounds and removes cached immutable keys before HTTP", async () => {
  let calls = 0;
  const attempt = async (body: string) => { calls += 1; return batchResults(body, () => "0x1"); };
  const item = (index: number) => ({ method: "eth_getCode", params: ["0x1", `0x${index.toString(16)}`], cachePolicy: "immutable" as const,
    decoder: passthrough, batchAttempt: attempt });
  await new RpcReadSession().readBatch("https://rpc.example", 1, Array.from({ length: 33 }, (_, i) => item(i)));
  await assert.rejects(new RpcReadSession().readBatch("https://rpc.example", 1, Array.from({ length: 34 }, (_, i) => item(i))), { code: "APN_RPC_BUDGET_EXCEEDED" });
  const logical = new RpcReadSession({ maxHttpRequests: 8, wait: async () => {} });
  for (let page = 0; page < 3; page += 1) await logical.readBatch("https://rpc.example", 1, Array.from({ length: 32 }, (_, i) => item(100 + page * 32 + i)));
  await assert.rejects(logical.readBatch("https://rpc.example", 1, [item(999)]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(logical.telemetry().logicalItems, 96);
  const requests = new RpcReadSession({ maxLogicalItems: 96, maxHttpRequests: 8, wait: async () => {} });
  for (let i = 0; i < 8; i += 1) await requests.readBatch("https://rpc.example", 1, [item(2000 + i)]);
  await assert.rejects(requests.readBatch("https://rpc.example", 1, [item(3000)]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(requests.telemetry().httpRequests, 8);
  let attemptNumber = 0;
  const retryAttempt = async (body: string) => {
    attemptNumber += 1;
    if (attemptNumber % 2 === 1) throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" });
    return batchResults(body, () => "0x1");
  };
  const attempts = new RpcReadSession({ maxHttpRequests: 8, maxHttpAttempts: 10, wait: async () => {} });
  for (let i = 0; i < 5; i += 1) await attempts.readBatch("https://rpc.example", 1, [{ ...item(4000 + i), batchAttempt: retryAttempt }]);
  await assert.rejects(attempts.readBatch("https://rpc.example", 1, [{ ...item(5000), batchAttempt: retryAttempt }]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(attempts.telemetry().httpAttempts, 10);
  let now = 0;
  const deadline = new RpcReadSession({ deadlineMs: 1, now: () => now, wait: async () => {} });
  await deadline.readBatch("https://rpc.example", 1, [{ ...item(6000), batchAttempt: async (body) => { now = 1; return batchResults(body, () => "0x1"); } }]);
  await assert.rejects(deadline.readBatch("https://rpc.example", 1, [item(6001)]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  const observedSizes: number[] = [];
  const cachedAttempt = async (body: string) => { const rows = JSON.parse(body) as unknown; observedSizes.push(Array.isArray(rows) ? rows.length : 1); return batchResults(body, () => "0x1"); };
  const cached = new RpcReadSession({ wait: async () => {} }), first = { ...item(7000), batchAttempt: cachedAttempt }, second = { ...item(7001), batchAttempt: cachedAttempt };
  await cached.readBatch("https://rpc.example", 1, [first]); await cached.readBatch("https://rpc.example", 1, [first, second]);
  assert.deepEqual(observedSizes, [1, 1]); assert.equal(cached.telemetry().cacheHits, 1);
});

test("whole RPC batch uses stable retry ids/body and retries 429/503 once", async () => {
  for (const status of [400, 429, 503]) {
    let calls = 0; const bodies: string[] = [];
    const transport = { request: async (_endpoint: string, _method: string, body: string) => {
      calls += 1; bodies.push(body);
      if (calls === 1) return { status, body: "", ...(status === 429 ? { headers: { "retry-after": "1" } } : {}) };
      return { status: 200, body: JSON.stringify(batchResults(body, () => "0x1")) };
    } };
    const descriptor = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://ethereum.example" }, { transport });
    const session = new RpcReadSession({ wait: async () => {} }), batch = descriptor.sessionBatchCall(session);
    const item = { method: "eth_chainId", params: [], cachePolicy: "immutable" as const, decoder: canonicalQuantity };
    if (status === 400) await assert.rejects(batch([item]), (error: unknown) => error instanceof ApnError &&
      error.code === "APN_RPC_PROTOCOL" && error.details?.rpcMethod === "eth_chainId");
    else assert.deepEqual(await batch([item]), [1n]);
    assert.equal(calls, status === 400 ? 1 : 2); assert.equal(session.telemetry().httpRequests, 1);
    assert.equal(session.telemetry().httpAttempts, status === 400 ? 1 : 2);
    if (status !== 400) assert.equal(bodies[0], bodies[1]);
  }
});

test("archive deployment logical batches use sequential three-item chunks with global ids and out-of-order responses", async () => {
  let now = 0; const bodies: string[] = [], waits: number[] = [];
  const attempt = async (body: string) => {
    bodies.push(body);
    const requests = JSON.parse(body) as Array<{ id: string; params: readonly unknown[] }>;
    return [...requests].reverse().map((request) => ({ jsonrpc: "2.0", id: request.id, result: request.params[0] }));
  };
  const items = Array.from({ length: 17 }, (_, index) => ({ method: "eth_getCode", params: [`value-${index}`, "0x10"],
    cachePolicy: "immutable" as const, decoder: String, batchAttempt: attempt }));
  const session = new RpcReadSession({ archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 13, maxHttpAttempts: 13,
    now: () => now, wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; } });
  assert.deepEqual(await session.readArchiveDeploymentBatch("https://archive.example", 1, items),
    Array.from({ length: 17 }, (_, index) => `value-${index}`));
  const chunks = bodies.map((body) => JSON.parse(body) as Array<{ id: string }>);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [3, 3, 3, 3, 3, 2]);
  assert.deepEqual(chunks.map((chunk) => chunk.map((row) => row.id)),
    [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["10", "11", "12"], ["13", "14", "15"], ["16", "17"]]);
  assert.deepEqual(waits, [750, 750, 750, 750, 750]);
  assert.equal(session.telemetry().httpRequests, 6); assert.equal(session.telemetry().httpAttempts, 6);

  const fifteenBodies: string[] = [];
  const fifteenAttempt = async (body: string) => { fifteenBodies.push(body); return batchResults(body, (request) => request.params[0]); };
  const fifteen = new RpcReadSession({ archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 13, maxHttpAttempts: 13, wait: async () => {} });
  await fifteen.readArchiveDeploymentBatch("https://archive.example", 1, items.slice(0, 15).map((item) => ({ ...item, batchAttempt: fifteenAttempt })));
  assert.deepEqual(fifteenBodies.map((body) => (JSON.parse(body) as Array<unknown>).length), [3, 3, 3, 3, 3]);
});

test("archive deployment HTTP 500 is terminal after one physical request", async () => {
  let calls = 0;
  const transport = { request: async () => { calls += 1; return { status: 500, body: "" }; } };
  const descriptor = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://ethereum.example",
    APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" }, { transport });
  const session = new RpcReadSession({ maxHttpRequests: 13, maxHttpAttempts: 13, wait: async () => {} });
  const batch = descriptor.sessionBatchCall(session), item = { method: "eth_getCode", params: ["0x0000000000000000000000000000000000000001", "0x10"],
    cachePolicy: "immutable" as const, decoder: String };
  await assert.rejects(batch([item, { ...item, params: ["0x0000000000000000000000000000000000000002", "0x10"] }], "archive_deployment"),
    (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_PROTOCOL" && error.details?.httpStatus === "500" &&
      error.details?.attempts === "1");
  assert.equal(calls, 1); assert.equal(session.telemetry().httpAttempts, 1);
});

test("archive deployment chunks retry only the failed chunk with its exact body and stop after a terminal failure", async () => {
  const bodies: string[] = []; let attemptNumber = 0;
  const attempt = async (body: string) => {
    bodies.push(body); attemptNumber += 1;
    if (attemptNumber === 2) throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" });
    if (attemptNumber === 4) throw new ApnError("APN_RPC_PROTOCOL", "terminal");
    return batchResults(body, (request) => request.params[0]);
  };
  const items = Array.from({ length: 9 }, (_, index) => ({ method: "eth_getCode", params: [`value-${index}`, "0x10"],
    cachePolicy: "immutable" as const, decoder: String, batchAttempt: attempt }));
  const session = new RpcReadSession({ archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 13, maxHttpAttempts: 13, wait: async () => {} });
  await assert.rejects(session.readArchiveDeploymentBatch("https://archive.example", 1, items), { code: "APN_RPC_PROTOCOL" });
  assert.equal(bodies.length, 4); assert.equal(bodies[1], bodies[2]);
  assert.notEqual(bodies[0], bodies[1]); assert.notEqual(bodies[2], bodies[3]);
  assert.deepEqual((JSON.parse(bodies[3]!) as Array<{ id: string }>).map((row) => row.id), ["7", "8", "9"]);
  assert.equal(session.telemetry().httpRequests, 3); assert.equal(session.telemetry().httpAttempts, 4);
});

test("late archive chunk HTTP, suberror and decoder failures commit no new cache entries", async () => {
  for (const failure of ["http", "suberror", "decode"] as const) {
    let failing = true; const bodies: string[] = [];
    const attempt = async (body: string) => {
      bodies.push(body); const requests = JSON.parse(body) as Array<{ id: string; params: readonly unknown[] }>;
      if (failing && requests[0]!.id === "4") {
        if (failure === "http") throw new ApnError("APN_RPC_PROTOCOL", "terminal HTTP failure");
        if (failure === "suberror") return requests.map((request, index) => index === 0
          ? { jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "failed" } }
          : { jsonrpc: "2.0", id: request.id, result: request.params[0] });
      }
      return requests.map((request) => ({ jsonrpc: "2.0", id: request.id,
        result: failure === "decode" && failing && request.id === "6" ? "malformed" : request.params[0] }));
    };
    const items = Array.from({ length: 6 }, (_, index) => ({ method: "eth_getCode", params: [`0x${index + 1}`, "0x10"],
      cachePolicy: "immutable" as const, decoder: (value: unknown) => {
        if (value === "malformed") throw new ApnError("APN_RPC_PROTOCOL", "bad value"); return String(value);
      }, batchAttempt: attempt }));
    const session = new RpcReadSession({ archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 13, maxHttpAttempts: 13, wait: async () => {} });
    await assert.rejects(session.readArchiveDeploymentBatch("https://archive.example", 1, items), { code: "APN_RPC_PROTOCOL" }, failure);
    const firstCallBodies = bodies.length; failing = false;
    await session.readArchiveDeploymentBatch("https://archive.example", 1, items);
    assert.deepEqual(bodies.slice(firstCallBodies).map((body) => (JSON.parse(body) as Array<unknown>).length), [3, 3], failure);
    assert.equal(session.telemetry().cacheHits, 0, failure);
  }
});

test("duplicate, missing and extra ids in a later archive chunk fail the whole logical batch without cache commit", async () => {
  for (const failure of ["duplicate", "missing", "extra"] as const) {
    let malformed = true; const sizes: number[] = [];
    const attempt = async (body: string) => {
      const requests = JSON.parse(body) as Array<{ id: string; params: readonly unknown[] }>; sizes.push(requests.length);
      if (malformed && requests[0]!.id === "4") {
        const valid = requests.map((request) => ({ jsonrpc: "2.0", id: request.id, result: request.params[0] }));
        if (failure === "duplicate") return [valid[0], { ...valid[1], id: valid[0]!.id }, valid[2]];
        if (failure === "missing") return valid.slice(0, 2);
        return [valid[0], valid[1], { ...valid[2], id: "999" }];
      }
      return requests.map((request) => ({ jsonrpc: "2.0", id: request.id, result: request.params[0] }));
    };
    const items = Array.from({ length: 6 }, (_, index) => ({ method: "eth_getCode", params: [`0x${index + 1}`, "0x10"],
      cachePolicy: "immutable" as const, decoder: String, batchAttempt: attempt }));
    const session = new RpcReadSession({ archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 13, maxHttpAttempts: 13, wait: async () => {} });
    await assert.rejects(session.readArchiveDeploymentBatch("https://archive.example", 1, items), { code: "APN_RPC_PROTOCOL" }, failure);
    malformed = false; await session.readArchiveDeploymentBatch("https://archive.example", 1, items);
    assert.deepEqual(sizes, [3, 3, 3, 3], failure); assert.equal(session.telemetry().cacheHits, 0, failure);
  }
});

test("archive observation budget permits 11/12 requests and one transient retry without exceeding hard cap 13", async () => {
  const item = (index: number, attempt: (body: string) => Promise<unknown>) => ({ method: "eth_getCode",
    params: [`0x${index.toString(16)}`, "0x10"], cachePolicy: "none" as const, decoder: String, batchAttempt: attempt });
  for (const requests of [11, 12]) {
    let attempts = 0, retried = false;
    const attempt = async (body: string) => {
      attempts += 1;
      if (!retried && attempts === requests) { retried = true; throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" }); }
      return batchResults(body, () => "0x1");
    };
    const session = new RpcReadSession({ archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 13, maxHttpAttempts: 13, wait: async () => {} });
    for (let index = 0; index < requests; index += 1) await session.readArchiveDeploymentBatch("https://archive.example", 1, [item(index, attempt)]);
    assert.equal(session.telemetry().httpRequests, requests); assert.equal(session.telemetry().httpAttempts, requests + 1);
  }
  const capped = new RpcReadSession({ archiveDeploymentBatchMaxItems: 3, maxHttpRequests: 13, maxHttpAttempts: 13, wait: async () => {} });
  const success = async (body: string) => batchResults(body, () => "0x1");
  for (let index = 0; index < 13; index += 1) await capped.readArchiveDeploymentBatch("https://archive.example", 1, [item(index, success)]);
  await assert.rejects(capped.readArchiveDeploymentBatch("https://archive.example", 1, [item(99, success)]), { code: "APN_RPC_BUDGET_EXCEEDED" });
});

test("identical batches singleflight; order and endpoint isolate keys; rejection clears inflight", async () => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const attempt = async (body: string) => { calls += 1; await gate; return batchResults(body, () => "0x1"); };
  const a = { method: "eth_getCode", params: ["0x1", "0x10"], cachePolicy: "immutable" as const, decoder: passthrough, batchAttempt: attempt };
  const b = { method: "eth_getCode", params: ["0x2", "0x10"], cachePolicy: "immutable" as const, decoder: passthrough, batchAttempt: attempt };
  const session = new RpcReadSession({ wait: async () => {} });
  const first = session.readBatch("https://rpc.example", 1, [a, b]), second = session.readBatch("https://rpc.example", 1, [a, b]);
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(session.telemetry().singleflightHits, 1); release(); await Promise.all([first, second]);
  await session.readBatch("https://rpc.example", 1, [{ ...b, cachePolicy: "none" }, { ...a, cachePolicy: "none" }]);
  await session.readBatch("https://other.example", 1, [{ ...a, cachePolicy: "none" }, { ...b, cachePolicy: "none" }]);
  assert.equal(calls, 3);
  let rejected = 0;
  const flaky = async (body: string) => { rejected += 1; return rejected === 1 ? [] : batchResults(body, () => "0x1"); };
  const row = { ...a, params: ["0x3", "0x10"], cachePolicy: "none" as const, batchAttempt: flaky };
  await assert.rejects(session.readBatch("https://rpc.example", 1, [row]), { code: "APN_RPC_PROTOCOL" });
  await session.readBatch("https://rpc.example", 1, [row]); assert.equal(rejected, 2);
});

test("Base source C1/C2 pins state to numeric block while pending stays pending and later economics are local", async () => {
  const owner = `0x${"11".repeat(20)}` as `0x${string}`, token = BRIDGE_ASSET_REGISTRY[8453].tokens.find((row) => row.symbol === "USDC")!.address,
    spender = `0x${"33".repeat(20)}` as `0x${string}`, hash = `0x${"44".repeat(32)}`;
  const header = { number: "0x100", hash, timestamp: "0x10", baseFeePerGas: "0x2", transactions: [] };
  let transportCalls = 0; const seen: Array<Array<{ method: string; params: readonly unknown[] }>> = [];
  const attempt = async (body: string) => {
    transportCalls += 1; const requests = JSON.parse(body) as Array<{ id: string; method: string; params: readonly unknown[] }>; seen.push(requests);
    return requests.map((request) => {
      if (transportCalls === 2 && request.method !== "eth_getTransactionCount" || transportCalls === 2 && request.params[1] !== "pending") {
        const tag = request.method === "eth_getBlockByNumber" ? request.params[0] : request.method === "eth_estimateGas" ? request.params[1] : request.params.at(-1);
        assert.equal(tag, "0x100");
      }
      let result: unknown;
      if (request.method === "eth_chainId") result = "0x2105";
      else if (request.method === "eth_getBlockByNumber") result = header;
      else if (request.method === "eth_getBalance") result = "0x100000000000000000";
      else if (request.method === "eth_getTransactionCount") result = "0x7";
      else if (request.method === "eth_estimateGas") result = "0x10000";
      else if (request.method === "eth_maxPriorityFeePerGas") result = "0x1";
      else if (request.method === "eth_call") result = `0x${"0".repeat(64)}`;
      else throw new Error(`unexpected ${request.method}`);
      return { jsonrpc: "2.0", id: request.id, result };
    });
  };
  const session = new RpcReadSession({ wait: async () => {} });
  const batchFactory = (bound: RpcReadSession) => async (items: readonly Omit<import("../../src/lifi/rpc.js").RpcBatchReadItem, "batchAttempt">[]) =>
    await bound.readBatch("https://base.example", 8453, items.map((item) => ({ ...item, batchAttempt: attempt })));
  const rpc = new BridgeRpc(8453, "https://base.example", async () => { throw new Error("serial fallback forbidden"); }, session,
    async () => { throw new Error("serial fallback forbidden"); }, undefined, batchFactory);
  const planned = { chainId: 8453 as const, from: owner, to: token, data: "0x" as const, valueAtomic: "0", gasLimitAtomic: "0" };
  const account = await rpc.account(owner, spender, token, [planned]);
  assert.equal(account.block.numberAtomic, "256"); assert.equal(account.latestNonceAtomic, "7"); assert.equal(account.pendingNonceAtomic, "7");
  assert.equal(seen[0]!.some((row) => row.method === "eth_call"), false);
  const feeCalls = seen[1]!.filter((row) => row.method === "eth_call" &&
    ["0x420000000000000000000000000000000000000f", "0x4200000000000000000000000000000000000015"]
      .includes(String((row.params[0] as { to: unknown }).to).toLowerCase()));
  assert.equal(feeCalls.length, 3); assert.ok(feeCalls.every((row) => row.params[1] === "0x100"));
  assert.equal(seen[1]!.find((row) => row.method === "eth_getTransactionCount" && row.params[1] === "pending")!.params[1], "pending");
  assert.equal((await rpc.estimate(planned)).gasLimitAtomic, "65536"); await rpc.prices();
  const quote = (await rpc.feeQuotes([{ economics: { nonceAtomic: "7", gasLimitAtomic: "65536", maxFeePerGasAtomic: "5", maxPriorityFeePerGasAtomic: "1", maximumGasCostAtomic: "327680" } }]))[0]!;
  assert.equal(quote.blockNumberAtomic, "256"); assert.equal(quote.blockHash, hash);
  assert.equal(transportCalls, 2); assert.equal(session.telemetry().httpRequests, 2); assert.equal(session.telemetry().batchCount, 2);
});
