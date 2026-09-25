import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { SolanaRpc, SolanaRpcBudget } from "../../src/solana/rpc.js";
import { SolanaRpcPacer } from "../../src/solana/pacing.js";
import { simulateSolanaSend } from "../../src/solana/simulation.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { bindArgv } from "../../src/command-binder.js";
import { SolanaLocalAdapter } from "../../src/solana/local-adapter.js";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("installed runtime gives each command a fresh 24 POST Solana cap", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const bound = bindArgv(["wallet", "capabilities-solana"]);
  const left = createApnCore(bound, { stateRoot: temporary.root, solanaRpcUrl: "https://api.mainnet-beta.solana.com" });
  const right = createApnCore(bound, { stateRoot: temporary.root, solanaRpcUrl: "https://api.mainnet-beta.solana.com" });
  const leftRpc = (left.context.directRails[0] as SolanaLocalAdapter).rpc as SolanaRpc;
  const rightRpc = (right.context.directRails[0] as SolanaLocalAdapter).rpc as SolanaRpc;
  assert.equal(leftRpc.budget?.maxPhysicalRequests, 24);
  assert.equal(rightRpc.budget?.maxPhysicalRequests, 24);
  assert.notEqual(leftRpc.budget, rightRpc.budget);
});

test("Solana batch correlates shuffled unique IDs and counts one physical POST", async () => {
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 1 });
  let posts = 0;
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    posts++;
    const requests = JSON.parse(init.body as string) as { id: string; method: string }[];
    assert.equal(requests.length, 3);
    assert.equal(new Set(requests.map(request => request.id)).size, 3);
    return json(requests.toReversed().map(request => ({ jsonrpc: "2.0", id: request.id, result: request.method })));
  }) as typeof fetch;
  const rpc = new SolanaRpc("https://rpc.example", fetcher, budget);
  assert.deepEqual(await rpc.batch([
    { method: "getGenesisHash", params: [] }, { method: "getBlockHeight", params: [] }, { method: "getLatestBlockhash", params: [] },
  ]), ["getGenesisHash", "getBlockHeight", "getLatestBlockhash"]);
  assert.equal(posts, 1);
  assert.equal(budget.logicalCalls, 3);
  assert.equal(budget.physicalRequests, 1);
});

test("Solana batch rejects missing, duplicate, extra, error, and mistyped envelopes", async () => {
  const variants = [
    (requests: { id: string }[]) => [reply(requests[0]!.id)],
    (requests: { id: string }[]) => [reply(requests[0]!.id), reply(requests[0]!.id)],
    (requests: { id: string }[]) => [reply(requests[0]!.id), reply("unknown")],
    (requests: { id: string }[]) => [reply(requests[0]!.id), { jsonrpc: "2.0", id: requests[1]!.id, error: { code: -32000, message: "failed" } }],
    (requests: { id: string }[]) => [reply(requests[0]!.id), { jsonrpc: "2.0", id: 123, result: 2 }],
  ];
  for (const make of variants) {
    let posts = 0;
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      posts++;
      return json(make(JSON.parse(init.body as string) as { id: string }[]));
    }) as typeof fetch;
    const rpc = new SolanaRpc("https://rpc.example", fetcher);
    await assert.rejects(rpc.batch([{ method: "getGenesisHash", params: [] }, { method: "getBlockHeight", params: [] }]),
      { code: "APN_RPC_PROTOCOL" });
    assert.equal(posts, 1);
  }
  function reply(id: string): unknown { return { jsonrpc: "2.0", id, result: 1 }; }
});

test("Solana batch bounds size and rejects send or simulation before transport", async () => {
  let posts = 0;
  const rpc = new SolanaRpc("https://rpc.example", (async () => { posts++; throw new Error("unexpected transport"); }) as typeof fetch);
  await assert.rejects(rpc.batch([]), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects(rpc.batch(Array.from({ length: 9 }, () => ({ method: "getGenesisHash", params: [] }))), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects(rpc.batch([{ method: "sendTransaction", params: [] } as never]), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects(rpc.batch([{ method: "simulateTransaction", params: [] } as never]), { code: "APN_RPC_PROTOCOL" });
  assert.equal(posts, 0);
});

test("shared Solana operation budget refuses a send before transport and paces POST starts", async () => {
  let now = 0;
  const waits: number[] = []; const starts: number[] = [];
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 2, now: () => now,
    wait: async milliseconds => { waits.push(milliseconds); now += milliseconds; } });
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    starts.push(now);
    const request = JSON.parse(init.body as string) as { id: string };
    return json({ jsonrpc: "2.0", id: request.id, result: 1 });
  }) as typeof fetch;
  const prepare = new SolanaRpc("https://rpc.example", fetcher, budget);
  const approve = new SolanaRpc("https://rpc.example", fetcher, budget);
  await prepare.call("getGenesisHash", []);
  await approve.call("getBlockHeight", []);
  await assert.rejects(approve.call("sendTransaction", ["synthetic"]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.deepEqual(starts, [0, 500]); assert.deepEqual(waits, [500]);
  assert.equal(budget.logicalCalls, 3); assert.equal(budget.physicalRequests, 2);
});

test("default operation pacing fails fast without sleeping under a caller's state lock", async () => {
  let now = 0; let posts = 0;
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 3, now: () => now });
  const rpc = new SolanaRpc("https://rpc.example", (async (_url: unknown, init: RequestInit) => {
    posts++;
    const request = JSON.parse(init.body as string) as { id: string };
    return json({ jsonrpc: "2.0", id: request.id, result: 1 });
  }) as typeof fetch, budget);
  await rpc.call("getGenesisHash", []);
  await assert.rejects(rpc.call("getBlockHeight", []), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "APN_RPC_RATE_LIMITED" &&
    "details" in error && (error.details as { retryAfterMs?: number })?.retryAfterMs === 500);
  assert.equal(posts, 1); assert.equal(budget.physicalRequests, 1);
  now = 500;
  await rpc.call("getBlockHeight", []);
  assert.equal(posts, 2); assert.equal(budget.logicalCalls, 3); assert.equal(budget.physicalRequests, 2);
});

test("HTTP 429 preserves retry-after and simulation does not recast it as transient", async () => {
  let posts = 0;
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 8 });
  const rpc = new SolanaRpc("https://rpc.example", (async () => {
    posts++;
    return json({ error: "rate limited" }, 429, { "retry-after": "3" });
  }) as typeof fetch, budget);
  await assert.rejects(simulateSolanaSend(rpc, "synthetic"), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === "APN_RPC_RATE_LIMITED" &&
    "details" in error && (error.details as { retryAfterMs?: number })?.retryAfterMs === 3000);
  assert.equal(posts, 1); assert.equal(budget.logicalCalls, 1); assert.equal(budget.physicalRequests, 1);
});

test("a batched read returns HTTP 429 after one POST without retrying", async () => {
  let posts = 0;
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 8 });
  const rpc = new SolanaRpc("https://rpc.example", (async () => {
    posts++;
    return json({ error: "rate limited" }, 429, { "retry-after": "4" });
  }) as typeof fetch, budget);
  await assert.rejects(rpc.batch([
    { method: "getGenesisHash", params: [] },
    { method: "getMultipleAccounts", params: [["synthetic"], { encoding: "base64" }] },
  ]), (error: unknown) => typeof error === "object" && error !== null && "code" in error &&
    error.code === "APN_RPC_RATE_LIMITED" && "details" in error &&
    (error.details as { retryAfterMs?: number })?.retryAfterMs === 4000);
  assert.equal(posts, 1);
  assert.equal(budget.logicalCalls, 2);
  assert.equal(budget.physicalRequests, 1);
});

test("persistent Solana pacing serializes concurrent commands and survives a fresh client", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const firstState = new StateStore(temporary.root); await firstState.initialize();
  const secondState = new StateStore(temporary.root); await secondState.initialize();
  let now = 1_000;
  const starts: number[] = [];
  const wait = async (milliseconds: number) => { now += milliseconds; };
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    starts.push(now);
    const request = JSON.parse(init.body as string) as { id: string };
    return json({ jsonrpc: "2.0", id: request.id, result: 1 });
  }) as typeof fetch;
  const rpc = (state: StateStore) => new SolanaRpc("https://api.mainnet-beta.solana.com", fetcher,
    new SolanaRpcBudget({ maxPhysicalRequests: 24, now: () => now, wait }),
    new SolanaRpcPacer(state, () => now, wait));
  await Promise.all([rpc(firstState).call("getGenesisHash", []), rpc(secondState).call("getBlockHeight", [])]);
  await rpc(new StateStore(temporary.root)).call("getBlockHeight", []);
  assert.equal(starts.length, 3);
  assert.ok(starts[1]! - starts[0]! >= 500 && starts[2]! - starts[1]! >= 500);
  const files = await readdir(join(temporary.root, "rpc-provider-pacing"));
  assert.equal(files.length, 1);
  const persisted = await readFile(join(temporary.root, "rpc-provider-pacing", files[0]!), "utf8");
  assert.doesNotMatch(persisted + files[0]!, /api\.mainnet|https:|credential|secret/u);
});

test("Solana invocation counts batches and send as physical POSTs and denies the 25th", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let now = 1_000; let posts = 0;
  const wait = async (milliseconds: number) => { now += milliseconds; };
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 24, now: () => now, wait });
  const rpc = new SolanaRpc("https://api.mainnet-beta.solana.com", (async (_url: unknown, init: RequestInit) => {
    posts++;
    const request = JSON.parse(init.body as string) as { id: string } | { id: string }[];
    return json(Array.isArray(request) ? request.map(row => ({ jsonrpc: "2.0", id: row.id, result: 1 })) :
      { jsonrpc: "2.0", id: request.id, result: 1 });
  }) as typeof fetch, budget, new SolanaRpcPacer(state, () => now, wait));
  await rpc.batch([{ method: "getGenesisHash", params: [] }, { method: "getBlockHeight", params: [] }]);
  for (let index = 1; index < 23; index++) await rpc.call("getBlockHeight", []);
  await rpc.call("sendTransaction", ["synthetic"]);
  await assert.rejects(rpc.call("getBlockHeight", []), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(posts, 24);
  assert.equal(budget.physicalRequests, 24);
  assert.equal(budget.logicalCalls, 26);
});

test("Solana HTTP 429 persists cooldown and never amplifies a send", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let now = 1_000; let posts = 0;
  const wait = async (milliseconds: number) => { now += milliseconds; };
  const pacer = new SolanaRpcPacer(state, () => now, wait);
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: 24, now: () => now, wait });
  const rpc = new SolanaRpc("https://api.mainnet-beta.solana.com", (async () => {
    posts++; return json({ error: "rate limited" }, 429, { "retry-after": "3" });
  }) as typeof fetch, budget, pacer);
  await assert.rejects(rpc.call("sendTransaction", ["synthetic"]), { code: "APN_RPC_RATE_LIMITED" });
  await assert.rejects(rpc.call("getBlockHeight", []), { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.equal(posts, 1);
  assert.equal(budget.physicalRequests, 1);
});
