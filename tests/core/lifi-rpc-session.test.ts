import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { BridgeRpc, RpcReadSession, bridgeRpcCall } from "../../src/lifi/rpc.js";

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

test("raw transaction submission makes one attempt and bypasses session scheduler", async () => {
  let calls = 0;
  const transport = { request: async () => { calls += 1; return { status: 503, body: "" }; } };
  const descriptor = bridgeRpcCall(8453, { APN_BASE_RPC_URL: "https://base.example" }, { transport });
  const rpc = new BridgeRpc(8453, descriptor.origin, descriptor.call, new RpcReadSession(), descriptor.attempt);
  await assert.rejects(rpc.send("0x02"), { code: "APN_RPC_PROTOCOL" });
  assert.equal(calls, 1); assert.equal(new RpcReadSession().telemetry().totalAttempts, 0);
});
