import assert from "node:assert/strict";
import test from "node:test";
import { RpcReadSession } from "../../src/lifi/rpc.js";
import { StateStore } from "../../src/state.js";
import { UniswapTokenRpcBudgetJournal } from "../../src/swap/uniswap-v3/token-rpc-budget.js";
import { createTokenRpc, tokenBatch, tokenBlock, tokenChain, tokenHex, tokenQuantity, type TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { UniswapTokenQuoteBuilder } from "../../src/swap/uniswap-v3/token-builder.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { ETHEREUM_USDT, UNISWAP_V3_QUOTER_V2 } from "../../src/swap/uniswap-v3/pins.js";
import { temporaryState } from "./helpers.js";
import { ApnError } from "../../src/errors.js";
import { tokenPrimaryCandidates } from "../../src/swap/uniswap-v3/token-rpc-pool.js";
import { verifyUniswapTokenRoutePins, UNISWAP_V3_SWAP_ROUTER, UNISWAP_V3_USDC_USDT_100 } from "../../src/swap/uniswap-v3/token-route.js";

const URLS = { APN_ETHEREUM_RPC_URL: "https://rpc.example", APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" };
const H = `0x${"a".repeat(64)}`;
const identity = (value: unknown) => value;
const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", RECIPIENT = "0x2222222222222222222222222222222222222222";
const word = (value: bigint) => value.toString(16).padStart(64, "0");

test("token quote allowance-zero and exact branches each use eight POSTs and reviewed max-three batches", async () => {
  for (const allowance of [0n, 1_000_000n]) {
    let physical = 0, logical = 0, saved: unknown;
    const value = (method: string, params: readonly unknown[]) => { if (method === "eth_chainId") return "0x1";
      if (method === "eth_getBlockByNumber") return { number: "0x10", hash: H, baseFeePerGas: "0x1" };
      if (method === "eth_getBalance") return "0x1000000"; if (method === "eth_estimateGas") return "0x100";
      if (method === "eth_call") { const tx = params[0] as { to?: string; data?: string };
        if (tx.to === UNISWAP_V3_QUOTER_V2) return `0x${word(1_000_000n)}${word(0n)}${word(0n)}${word(0n)}`;
        if (tx.data?.startsWith("0xdd62ed3e")) return `0x${word(allowance)}`; return "0x"; }
      return "0x00"; };
    const rpc = (async (method: string, params: readonly unknown[]) => value(method, params)) as TokenRpcCall;
    Object.defineProperty(rpc, "batch", { value: async (_route: string, items: readonly { method: string; params: readonly unknown[] }[]) => {
      physical += 1; logical += items.length; assert.ok(items.length <= 3); return items.map((item) => value(item.method, item.params)); } });
    const pins = async (call: any, tag: any) => { for (const size of [3, 3, 3, 1]) await tokenBatch(call, "archive",
      Array.from({ length: size }, (_, index) => ({ method: "eth_getCode", params: [`0x${String(index + 1).padStart(40, "0")}`, tag], cachePolicy: "immutable", decoder: identity }))); };
    const builder = new UniswapTokenQuoteBuilder(rpc, { save: async (material: unknown) => (saved = material, material) } as any,
      async () => "d".repeat(64), () => new Date("2026-09-23T00:00:00.000Z"), pins);
    await builder.quote({ command: "swap.uniswap-token.quote", profile: "p", account: ACCOUNT, recipient: RECIPIENT,
      sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000",
      approvalCapAtomic: "1000000", deadline: Math.floor(Date.parse("2026-09-23T00:10:00.000Z") / 1000),
      maxApprovalGasLimit: "100000", maxSwapGasLimit: "200000", maxCleanupGasLimit: "100000", maxFeePerGas: "2",
      maxPriorityFeePerGas: "1", maxNativeDebitWei: "800000" });
    assert.ok(saved); assert.equal(physical, 8); assert.equal(logical, allowance === 0n ? 17 : 18);
  }
});

test("token production session performs one atomic max-three batch with redacted telemetry", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const bodies: unknown[] = [];
  const rpc = createTokenRpc({ environment: URLS, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 2, deadlineMs: 10_000,
    transport: { request: async (_url, _method, body) => { const request = JSON.parse(body!); bodies.push(request); const rows = Array.isArray(request) ? request : [request];
      const result = rows.map((row: any) => ({ jsonrpc: "2.0", id: row.id, result: row.method === "eth_chainId" ? "0x1" : row.method === "eth_getBlockByNumber"
        ? { number: "0x1", hash: H } : "0x2" })); return { status: 200, body: JSON.stringify(Array.isArray(request) ? result : result[0]) }; } },
  });
  const result = await rpc.batch!("primary", [
    { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: identity },
    { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: identity },
    { method: "eth_getBalance", params: ["0x1111111111111111111111111111111111111111", "latest"], cachePolicy: "none", decoder: identity },
  ]);
  assert.equal(result.length, 3); assert.equal(bodies.length, 1); assert.equal((bodies[0] as unknown[]).length, 3);
  const telemetry = rpc.telemetry!(); assert.equal(telemetry?.httpRequests, 1); assert.equal(telemetry?.httpAttempts, 1);
  assert.equal(telemetry?.logicalItems, 3); assert.equal(telemetry?.maxBatchSize, 3);
  const projected = JSON.stringify(telemetry); assert.doesNotMatch(projected, /rpc\.example|111111111111|eth_getBalance.*0x/u);
});

test("archive reads reject a non-Ethereum identity before historical evidence", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); let attempts = 0;
  const rpc = createTokenRpc({ environment: URLS, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 2, deadlineMs: 10_000,
    transport: { request: async (_url, _method, body) => { attempts += 1; const row = JSON.parse(body!); return { status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: row.id, result: row.method === "eth_chainId" ? "0x2" : "0x00" }) }; } } });
  await assert.rejects(tokenBatch(rpc, "archive", [{ method: "eth_getCode", params: [ACCOUNT, "0x1"], cachePolicy: "immutable", decoder: tokenHex() }]),
    { code: "APN_CHAIN_MISMATCH" });
  assert.equal(attempts, 1); assert.equal(rpc.telemetry!()?.logicalItems, 1);
});

test("a malformed decoded batch item commits none of its cache", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); let attempts = 0;
  const rpc = createTokenRpc({ environment: URLS, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 2, deadlineMs: 10_000,
    transport: { request: async (_url, _method, body) => { attempts += 1; const rows = JSON.parse(body!) as any[];
      return { status: 200, body: JSON.stringify(rows.map((row) => ({ jsonrpc: "2.0", id: row.id,
        result: row.method === "eth_chainId" ? "0x1" : attempts === 1 ? "malformed" : "0x2" }))) }; } } });
  const items = [{ method: "eth_chainId", params: [], cachePolicy: "immutable" as const, decoder: tokenChain },
    { method: "eth_getBalance", params: [ACCOUNT, "0x1"], cachePolicy: "immutable" as const, decoder: tokenQuantity }];
  await assert.rejects(tokenBatch(rpc, "primary", items), { code: "APN_RPC_PROTOCOL" });
  const result = await tokenBatch(rpc, "primary", items); assert.equal(result[1], "0x2"); assert.equal(attempts, 2);
});

test("token reads never retry 429 and reject exhausted request budget before transport", async (t) => {
  const first = await temporaryState(); t.after(first.cleanup); let attempts = 0;
  const limited = createTokenRpc({ environment: URLS, state: new StateStore(first.root), now: Date.now, maxHttpRequests: 1, deadlineMs: 10_000,
    transport: { request: async () => { attempts += 1; return { status: 429, body: "rate limited", headers: { "retry-after": "30" } }; } } });
  await assert.rejects(limited("eth_chainId", []), { code: "APN_RPC_RATE_LIMITED" }); assert.equal(attempts, 1);

  const second = await temporaryState(); t.after(second.cleanup); attempts = 0;
  const capped = createTokenRpc({ environment: URLS, state: new StateStore(second.root), now: Date.now, maxHttpRequests: 1, deadlineMs: 10_000,
    transport: { request: async (_url, _method, body) => { attempts += 1; const row = JSON.parse(body!); return { status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: row.id, result: "0x1" }) }; } } });
  await capped("eth_chainId", []); await assert.rejects(capped("eth_getBalance", ["0x1111111111111111111111111111111111111111", "latest"]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(attempts, 1); assert.equal(capped.telemetry!()?.budgetRejectedBeforeTransport, 1);
});

test("token raw send consumes the shared physical request budget without retry", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); let attempts = 0;
  const rpc = createTokenRpc({ environment: URLS, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 1, deadlineMs: 10_000,
    transport: { request: async () => { attempts += 1; return { status: 503, body: "unavailable" }; } } });
  await assert.rejects(rpc("eth_sendRawTransaction", ["0x00"])); assert.equal(attempts, 1); assert.equal(rpc.effectAttempts!(), 1);
  assert.equal(rpc.telemetry!()?.httpAttempts, 0);
});

test("reserved send slot limits pooled reads and permits exactly 24 physical POSTs", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const methods: string[] = []; let now = Date.now();
  const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: () => now, pacingNow: () => now,
    maxHttpRequests: 24, deadlineMs: 60_000, wait: async (milliseconds) => { now += milliseconds; },
    transport: { request: async (_url, _method, body) => { const parsed = JSON.parse(body!); const rows = Array.isArray(parsed) ? parsed : [parsed];
      methods.push(rows[0].method); return { status: 200, body: batchResponse(body!, (method) => method === "eth_chainId" ? "0x1" : "0x2") }; } } });
  await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain }]);
  for (let index = 0; index < 22; index += 1) await rpc("eth_getBalance", [ACCOUNT, `0x${index.toString(16)}`]);
  rpc.reserveEffectSlot!();
  await assert.rejects(rpc("eth_getBalance", [ACCOUNT, "0x16"]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  await rpc("eth_sendRawTransaction", ["0x00"]);
  assert.equal(methods.length, 24); assert.equal(methods.at(-1), "eth_sendRawTransaction");
  assert.equal(rpc.telemetry!()?.httpAttempts, 23); assert.equal(rpc.effectAttempts!(), 1);
  await assert.rejects(rpc("eth_getBalance", [ACCOUNT, "0x17"]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  await assert.rejects(rpc("eth_sendRawTransaction", ["0x00"]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(methods.length, 24);
});

test("effect capacity is refused before signing when 24 reads used the invocation", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); let posts = 0, now = Date.now();
  const rpc = createTokenRpc({ environment: URLS, state: new StateStore(temp.root), now: () => now, pacingNow: () => now,
    maxHttpRequests: 24, deadlineMs: 60_000, wait: async (milliseconds) => { now += milliseconds; },
    transport: { request: async (_url, _method, body) => { posts += 1;
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(body!).id, result: "0x1" }) }; } } });
  for (let index = 0; index < 24; index += 1) await rpc("eth_getBalance", [ACCOUNT, `0x${index.toString(16)}`]);
  await assert.rejects(async () => rpc.reserveEffectSlot!(), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(posts, 24); assert.equal(rpc.effectAttempts!(), 0);
});

test("raw send shares persisted provider pacing with reads in scalar and pooled token RPC", async (t) => {
  for (const environment of [URLS, POOL]) {
    const temp = await temporaryState(); t.after(temp.cleanup); let now = 10_000;
    const starts: Array<{ method: string; at: number }> = [];
    const rpc = createTokenRpc({ environment, state: new StateStore(temp.root), now: () => now, pacingNow: () => now,
      maxHttpRequests: 3, deadlineMs: 10_000, wait: async (milliseconds) => { now += milliseconds; },
      transport: { request: async (_url, _method, body) => { const request = JSON.parse(body!);
        const row = Array.isArray(request) ? request[0] : request; starts.push({ method: row.method, at: now });
        return { status: 200, body: batchResponse(body!, poolValue) }; } } });
    await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain }]);
    await rpc("eth_sendRawTransaction", ["0x00"]);
    await rpc("eth_getBalance", [ACCOUNT, "latest"]);
    assert.deepEqual(starts.map((row) => row.method), ["eth_chainId", "eth_sendRawTransaction", "eth_getBalance"]);
    assert.deepEqual(starts.map((row) => row.at), [10_000, 10_750, 11_500]);
  }
});

test("pooled raw send 429 is terminal and persists provider cooldown", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); let now = 10_000; const starts: string[] = [];
  const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: () => now, pacingNow: () => now,
    maxHttpRequests: 3, deadlineMs: 10_000, wait: async (milliseconds) => { now += milliseconds; },
    transport: { request: async (_url, _method, body) => { const row = JSON.parse(body!); starts.push(row.method);
      return row.method === "eth_sendRawTransaction" ? { status: 429, body: "rate", headers: { "retry-after": "30" } }
        : { status: 200, body: batchResponse(body!, poolValue) }; } } });
  await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain }]);
  await assert.rejects(rpc("eth_sendRawTransaction", ["0x00"]), { code: "APN_RPC_RATE_LIMITED" });
  await assert.rejects(rpc("eth_getBalance", [ACCOUNT, "latest"]), { code: "APN_PROVIDER_UNAVAILABLE" });
  assert.deepEqual(starts, ["eth_chainId", "eth_sendRawTransaction"]); assert.equal(rpc.effectAttempts!(), 1);
});

const POOL = { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify(["https://first.example", "https://second.example"]),
  APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" };
function batchResponse(body: string, result: (method: string, params: readonly unknown[]) => unknown) {
  const value = JSON.parse(body) as any, rows = Array.isArray(value) ? value : [value];
  const response = rows.map((row: any) => ({ jsonrpc: "2.0", id: row.id, result: result(row.method, row.params) }));
  return JSON.stringify(Array.isArray(value) ? response : response[0]);
}
function poolValue(method: string, params: readonly unknown[]) { if (method === "eth_chainId") return "0x1";
  if (method === "eth_getBlockByNumber") return { number: "0x10", hash: H, parentHash: `0x${"b".repeat(64)}` };
  if (method === "eth_getBalance") return "0x2"; if (method === "eth_getCode") return "0x6000";
  if (method === "eth_sendRawTransaction") return params[0]; return "0x1"; }

test("ordered token primary pool charges one timeout then freezes the fully decoded second provider", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const origins: string[] = [];
  const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 4, deadlineMs: 10_000,
    transport: { request: async (url, _method, body) => { const origin = new URL(url).origin; origins.push(origin);
      if (origin === "https://first.example") throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" });
      return { status: 200, body: batchResponse(body!, poolValue) }; } } });
  const items = [{ method: "eth_chainId", params: [], cachePolicy: "immutable" as const, decoder: tokenChain },
    { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none" as const, decoder: identity }];
  assert.equal((await tokenBatch(rpc, "primary", items))[0], "0x1");
  assert.equal((await tokenBatch(rpc, "primary", [{ method: "eth_getBalance", params: [ACCOUNT, "latest"], decoder: tokenQuantity }]))[0], "0x2");
  assert.deepEqual(origins, ["https://first.example", "https://second.example", "https://second.example"]);
  assert.deepEqual(rpc.primaryPoolTelemetry!().attempts.map((row) => row.outcome), ["failed", "selected"]);
  assert.equal(rpc.telemetry!()?.httpAttempts, 3); assert.equal(rpc.telemetry!()?.logicalItems, 5);
});

test("pool 429 is terminal for the invocation and cooldown is durable across runtimes", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const calls: string[] = [], request = async (url: string, _method: string, body: string | null) => {
    const origin = new URL(url).origin; calls.push(origin); if (origin === "https://first.example") return { status: 429, body: "rate", headers: { "retry-after": "30" } };
    return { status: 200, body: batchResponse(body!, poolValue) }; };
  const items = [{ method: "eth_chainId", params: [], decoder: tokenChain }];
  for (let run = 0; run < 2; run += 1) { const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: Date.now,
    maxHttpRequests: 3, deadlineMs: 10_000, transport: { request } });
    if (run === 0) await assert.rejects(tokenBatch(rpc, "primary", items), { code: "APN_RPC_RATE_LIMITED" });
    else await tokenBatch(rpc, "primary", items);
    if (run === 1) assert.equal(rpc.primaryPoolTelemetry!().attempts[0]?.outcome, "cooldown_skipped"); }
  assert.deepEqual(calls, ["https://first.example", "https://second.example"]);
});

test("malformed candidate batch commits no cross-provider cache and archive must match the primary block", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const calls: string[] = [];
  const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 6, deadlineMs: 10_000,
    transport: { request: async (url, _method, body) => { const origin = new URL(url).origin; calls.push(origin); const parsed = JSON.parse(body!);
      if (origin === "https://first.example") { const rows = parsed as any[]; return { status: 200, body: JSON.stringify(rows.map((row, index) =>
        ({ jsonrpc: "2.0", id: row.id, result: index === 0 ? "0x1" : "bad" }))) }; }
      return { status: 200, body: batchResponse(body!, poolValue) }; } } });
  await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: tokenChain },
    { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none", decoder: tokenBlock }]);
  assert.equal((await tokenBatch(rpc, "archive", [{ method: "eth_getCode", params: [ACCOUNT, "0x10"], decoder: tokenHex() }]))[0], "0x6000");
  assert.deepEqual(calls, ["https://first.example", "https://second.example", "https://archive.example", "https://archive.example"]);
  assert.deepEqual(rpc.primaryPoolTelemetry!().attempts.map((row) => row.reason), ["malformed", null]);
});

test("pool config rejects duplicate provider aliases and an archive sharing a primary origin", () => {
  assert.throws(() => tokenPrimaryCandidates({ APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify(["https://rpc.example", "https://rpc.example/"]) }),
    { code: "APN_RPC_CONFIG", details: { reason: "duplicate_primary_provider" } });
  assert.throws(() => tokenPrimaryCandidates({ APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify(["https://rpc.example/a"]),
    APN_ETHEREUM_ARCHIVE_RPC_URL: "https://rpc.example/archive" }), { code: "APN_RPC_CONFIG", details: { reason: "archive_primary_not_distinct" } });
});

test("authentication is quarantined and raw submission never fails over from the frozen provider", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); let sends = 0; const origins: string[] = [];
  const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 4, deadlineMs: 10_000,
    transport: { request: async (url, _method, body) => { const origin = new URL(url).origin; origins.push(origin); const parsed = JSON.parse(body!);
      if (origin === "https://first.example") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: "1",
        error: { code: -32_000, message: "Unauthorized: API key required" } }) };
      const rows = Array.isArray(parsed) ? parsed : [parsed]; if (rows[0]?.method === "eth_sendRawTransaction") { sends += 1;
        throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" }); }
      return { status: 200, body: batchResponse(body!, poolValue) }; } } });
  await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain }]);
  await assert.rejects(rpc("eth_sendRawTransaction", ["0x00"]), { code: "APN_RPC_AMBIGUOUS" });
  assert.equal(sends, 1); assert.equal(rpc.effectAttempts!(), 1);
  assert.equal(origins.filter((origin) => origin === "https://first.example").length, 1);
  assert.deepEqual(rpc.primaryPoolTelemetry!().attempts.map((row) => row.reason), ["authentication", null]);
});

test("all cooling candidates fail before transport and a failed candidate cannot exceed the request budget", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const state = new StateStore(temp.root), candidates = tokenPrimaryCandidates(POOL), now = Date.now();
  await state.initialize(); for (const candidate of candidates) await state.writeRpcProviderCooldown(candidate.familyHash, now + 30_000);
  let calls = 0; const cooling = createTokenRpc({ environment: POOL, state, now: Date.now, maxHttpRequests: 3, deadlineMs: 10_000,
    transport: { request: async () => { calls += 1; throw Error("transport must not run"); } } });
  await assert.rejects(tokenBatch(cooling, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain }]),
    { code: "APN_PROVIDER_UNAVAILABLE", details: { reason: "token_primary_pool_exhausted", attemptedProviders: "2" } });
  assert.equal(calls, 0); assert.deepEqual(cooling.primaryPoolTelemetry!().attempts.map((row) => row.outcome), ["cooldown_skipped", "cooldown_skipped"]);

  const other = await temporaryState(); t.after(other.cleanup); calls = 0;
  const capped = createTokenRpc({ environment: POOL, state: new StateStore(other.root), now: Date.now, maxHttpRequests: 1, deadlineMs: 10_000,
    transport: { request: async () => { calls += 1; throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" }); } } });
  await assert.rejects(tokenBatch(capped, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain }]), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal(calls, 1); assert.equal(capped.telemetry!()?.budgetRejectedBeforeTransport, 1);
});

test("archive block mismatch fails before historical state use", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); let archiveCalls = 0;
  const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 4, deadlineMs: 10_000,
    transport: { request: async (url, _method, body) => { const origin = new URL(url).origin;
      if (origin === "https://archive.example") archiveCalls += 1;
      return { status: 200, body: batchResponse(body!, (method, params) => method === "eth_getBlockByNumber" && origin === "https://archive.example"
        ? { number: "0x10", hash: `0x${"c".repeat(64)}` } : poolValue(method, params)) }; } } });
  await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain },
    { method: "eth_getBlockByNumber", params: ["latest", false], decoder: tokenBlock }]);
  await assert.rejects(tokenBatch(rpc, "archive", [{ method: "eth_getCode", params: [ACCOUNT, "0x10"], decoder: tokenHex() }]),
    { code: "APN_RPC_PROTOCOL", details: { reason: "token_archive_block_mismatch" } });
  assert.equal(archiveCalls, 1);
});

test("pool quote counts exact anchor and each failed candidate without exceeding the reviewed cap", async (t) => {
  for (const failures of [0, 1, 2]) {
    const temp = await temporaryState(); t.after(temp.cleanup); let physical = 0;
    const environment = { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify([
      "https://one.example", "https://two.example", "https://three.example"]), APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" };
    const rpc = createTokenRpc({ environment, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 10, deadlineMs: 10_000,
      wait: async () => {}, pacingNow: () => physical * 1_000,
      transport: { request: async (url, _method, body) => { physical += 1; const origin = new URL(url).origin;
        if (origin !== "https://archive.example" && Number(origin.slice(8, 11) === "one" ? 0 : origin.slice(8, 11) === "two" ? 1 : 2) < failures)
          throw new ApnError("APN_RPC_AMBIGUOUS", "timeout", { transportReason: "request_deadline" });
        return { status: 200, body: batchResponse(body!, (method, params) => {
          if (method === "eth_call") { const tx = params[0] as { to?: string; data?: string };
            if (tx.to === UNISWAP_V3_QUOTER_V2) return `0x${word(1_000_000n)}${word(0n)}${word(0n)}${word(0n)}`;
            if (tx.data?.startsWith("0xdd62ed3e")) return `0x${word(0n)}`; return "0x"; }
          if (method === "eth_getBalance") return "0x1000000"; return poolValue(method, params); }) }; } } });
    const pins = async (call: any, tag: any) => { let cursor = 0; for (const size of [3, 3, 3]) await tokenBatch(call, "archive",
      Array.from({ length: size }, () => ({ method: "eth_getCode", params: [`0x${String(++cursor).padStart(40, "0")}`, tag], decoder: tokenHex() }))); };
    const builder = new UniswapTokenQuoteBuilder(rpc, { save: async (material: unknown) => material } as any,
      async () => "d".repeat(64), () => new Date("2026-09-23T00:00:00.000Z"), pins);
    await builder.quote({ command: "swap.uniswap-token.quote", profile: "p", account: ACCOUNT, recipient: RECIPIENT,
      sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000",
      approvalCapAtomic: "1000000", deadline: Math.floor(Date.parse("2026-09-23T00:10:00.000Z") / 1000),
      maxApprovalGasLimit: "100000", maxSwapGasLimit: "200000", maxCleanupGasLimit: "100000", maxFeePerGas: "2",
      maxPriorityFeePerGas: "1", maxNativeDebitWei: "800000" });
    assert.equal(physical, 8 + failures); assert.equal(rpc.telemetry!()?.httpAttempts, 8 + failures);
    assert.equal(rpc.telemetry!()?.logicalItems, 18 + 2 * failures); assert.ok(physical <= 10);
  }
});

test("pooled production pin verifier uses its archive chain anchor before a three-item pin batch", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const batches: { origin: string; methods: string[]; addresses: string[] }[] = []; let tick = 0;
  const environment = { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify(["https://primary.example"]),
    APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" };
  const rpc = createTokenRpc({ environment, state: new StateStore(temp.root), now: Date.now, pacingNow: () => ++tick * 1_000,
    maxHttpRequests: 3, deadlineMs: 10_000, wait: async () => {}, transport: { request: async (url, _method, body) => { const rows = JSON.parse(body!) as any[];
      batches.push({ origin: new URL(url).origin, methods: rows.map((row) => row.method),
        addresses: rows.map((row) => String(row.params?.[0] ?? "")) });
      return { status: 200, body: batchResponse(body!, (method, params) => method === "eth_getCode" ? "0x6000" : poolValue(method, params)) }; } } });
  await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain },
    { method: "eth_getBlockByNumber", params: ["latest", false], decoder: tokenBlock }]);
  await assert.rejects(verifyUniswapTokenRoutePins(rpc, "0x10"), { code: "APN_OPERATION_BLOCKED",
    details: { reason: "uniswap_code_pin_drift" } });
  assert.deepEqual(batches.map((batch) => [batch.origin, batch.methods]), [
    ["https://primary.example", ["eth_chainId", "eth_getBlockByNumber"]],
    ["https://archive.example", ["eth_chainId", "eth_getBlockByNumber"]],
    ["https://archive.example", ["eth_getCode", "eth_getCode", "eth_getCode"]],
  ]);
  assert.deepEqual(batches[2]!.addresses.slice(0, 2), [UNISWAP_V3_SWAP_ROUTER, UNISWAP_V3_USDC_USDT_100]);
  assert.equal(rpc.telemetry!()?.httpAttempts, 3);
});

test("cross-process probe lock persists every semantic quarantine before a peer can contact the candidate", async (t) => {
  for (const reason of ["malformed", "authentication", "wrong_chain", "capability"] as const) {
    const temp = await temporaryState(); t.after(temp.cleanup); let failedCalls = 0, healthyCalls = 0, tick = 0;
    const request = async (url: string, _method: string, body: string | null) => { const origin = new URL(url).origin;
      if (origin === "https://first.example") { failedCalls += 1; const parsed = JSON.parse(body!), row = Array.isArray(parsed) ? parsed[0] : parsed;
        if (reason === "authentication") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: row.id,
          error: { code: -32_000, message: "Unauthorized: API key required" } }) };
        if (reason === "capability") return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: row.id,
          error: { code: -32_600, message: "Batch requests are not supported" } }) };
        return { status: 200, body: batchResponse(body!, () => reason === "wrong_chain" ? "0x2" : "malformed") }; }
      healthyCalls += 1; return { status: 200, body: batchResponse(body!, poolValue) }; };
    const runtime = () => createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: Date.now, pacingNow: () => (tick += 1_000),
      wait: async () => {}, maxHttpRequests: 3, deadlineMs: 10_000, transport: { request } });
    const first = runtime(), second = runtime(), items = [{ method: "eth_chainId", params: [], decoder: tokenChain }];
    await Promise.all([tokenBatch(first, "primary", items), tokenBatch(second, "primary", items)]);
    assert.equal(failedCalls, 1, reason); assert.equal(healthyCalls, 2, reason);
    assert.equal([first, second].filter((rpc) => rpc.primaryPoolTelemetry!().attempts.some((row) => row.outcome === "cooldown_skipped")).length, 1, reason);
  }
});

test("wrong-chain and HTTP 5xx candidates are quarantined with finite redacted reasons", async (t) => {
  for (const kind of ["wrong_chain", "http_5xx"] as const) {
    const temp = await temporaryState(); t.after(temp.cleanup); const origins: string[] = [];
    const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 3, deadlineMs: 10_000,
      transport: { request: async (url, _method, body) => { const origin = new URL(url).origin; origins.push(origin);
        if (origin === "https://first.example") return kind === "http_5xx" ? { status: 503, body: "unavailable" }
          : { status: 200, body: batchResponse(body!, () => "0x2") };
        return { status: 200, body: batchResponse(body!, poolValue) }; } } });
    await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain }]);
    assert.deepEqual(origins, ["https://first.example", "https://second.example"]);
    assert.equal(rpc.primaryPoolTelemetry!().attempts[0]?.reason, kind);
    assert.doesNotMatch(JSON.stringify(rpc.primaryPoolTelemetry!()), /example|unavailable/u);
  }
});

test("pool refuses submission before semantic selection and never fails over on a business error", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const origins: string[] = [];
  const rpc = createTokenRpc({ environment: POOL, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 4, deadlineMs: 10_000,
    transport: { request: async (url, _method, body) => { const origin = new URL(url).origin; origins.push(origin); const parsed = JSON.parse(body!);
      const rows = Array.isArray(parsed) ? parsed : [parsed]; if (rows[0]?.method === "eth_call") return { status: 200,
        body: JSON.stringify({ jsonrpc: "2.0", id: rows[0].id, error: { code: 3, message: "execution reverted" } }) };
      return { status: 200, body: batchResponse(body!, poolValue) }; } } });
  await assert.rejects(rpc("eth_sendRawTransaction", ["0x00"]), { code: "APN_RPC_CONFIG", details: { reason: "token_primary_not_selected" } });
  assert.equal(rpc.effectAttempts!(), 0); assert.equal(origins.length, 0);
  await tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], decoder: tokenChain }]);
  await assert.rejects(rpc("eth_call", [{ to: ACCOUNT, data: "0x" }, "latest"]));
  assert.deepEqual(origins, ["https://first.example", "https://first.example"]);
});

test("maximum three-provider effect reservations fit the cumulative 64-request envelope", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const journal = new UniswapTokenRpcBudgetJournal(temp.root), binding = "e".repeat(64);
  const caps = [["quote", 10, "quote"], ["prepare", 11, "prepare"], ["approve", 17, "approval_effect"], ["execute", 24, "swap_effect"]] as const;
  for (const [command, cap, kind] of caps) { const reservation = await journal.reserve(binding, command, cap, cap, kind);
    await journal.settle(binding, reservation, { ...new RpcReadSession().telemetry(), httpAttempts: cap, httpRequests: cap }, 0); }
  assert.equal(caps.reduce((sum, row) => sum + row[1], 0), 62);
  await assert.rejects(journal.reserve(binding, "extra-effect", 3), { code: "APN_RPC_BUDGET_EXCEEDED" });
});

test("durable operation budget caps only new effects and never blocks status or cleanup recovery", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const journal = new UniswapTokenRpcBudgetJournal(temp.root), binding = "b".repeat(64);
  const telemetry = (attempts: number) => ({ ...new RpcReadSession().telemetry(), httpRequests: attempts, httpAttempts: attempts });
  for (const [command, cap, actual, budgetClass] of [["quote", 8, 8, "quote"], ["prepare", 9, 9, "prepare"],
    ["approve", 14, 14, "approval_effect"], ["execute", 24, 24, "swap_effect"]] as const) {
    const reservation = await journal.reserve(binding, command, cap, cap, budgetClass); await journal.settle(binding, reservation, telemetry(actual), 0);
  }
  for (const command of ["status-pending-1", "status-pending-2", "status-final", "cleanup"]) {
    const sessionCap = command === "cleanup" ? 14 : 8, reservation = await journal.reserve(binding, command, 0, sessionCap, "recovery");
    await journal.settle(binding, reservation, telemetry(8), 0);
  }
  await assert.rejects(journal.reserve(binding, "another-effect", 14), { code: "APN_RPC_BUDGET_EXCEEDED" });
  const rows = (await journal.load(binding))!.rows; assert.equal(rows.length, 8); assert.equal(rows.at(-1)?.physicalRequests, 8);
  assert.deepEqual(rows.map((row) => [row.cap, row.requestSessionCap, row.budgetClass]), [
    [8, 8, "quote"], [9, 9, "prepare"], [14, 14, "approval_effect"], [24, 24, "swap_effect"],
    [0, 8, "recovery"], [0, 8, "recovery"], [0, 8, "recovery"], [0, 14, "recovery"],
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /https:|0x[0-9a-f]{40}|rawTransaction/u);
});

test("budget merging deduplicates row identity but retains two real prepare sessions", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const journal = new UniswapTokenRpcBudgetJournal(temp.root),
    quote = "c".repeat(64), operation = "d".repeat(64), telemetry = (attempts: number) => ({ ...new RpcReadSession().telemetry(), httpRequests: attempts, httpAttempts: attempts });
  const quoteRow = await journal.reserve(quote, "quote", 8); await journal.settle(quote, quoteRow, telemetry(8), 0);
  const first = await journal.reserve(quote, "prepare", 9); await journal.settle(quote, first, telemetry(9), 0);
  await journal.linkQuote(quote, operation);
  await journal.linkQuote(quote, operation);
  assert.deepEqual((await journal.load(operation))!.rows.map((row) => row.physicalRequests), [8, 9]);
  const retry = await journal.reserve(quote, "prepare", 9); assert.notEqual(retry, first); await journal.settle(quote, retry, telemetry(9), 0);
  await journal.reconcile(operation); const rows = (await journal.load(operation))!.rows;
  assert.deepEqual(rows.map((row) => row.physicalRequests), [8, 9, 9]);
  await assert.rejects(journal.reserve(operation, "approve", 39), { code: "APN_RPC_BUDGET_EXCEEDED" });
});
test("settlement fails closed without recording a request-session overrun", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const journal = new UniswapTokenRpcBudgetJournal(temp.root), binding = "c".repeat(64);
  const recovery = await journal.reserve(binding, "recovery-overrun", 0, 8, "recovery"), telemetry = new RpcReadSession().telemetry();
  await assert.rejects(journal.settle(binding, recovery, { ...telemetry, httpAttempts: 8, httpRequests: 8 }, 1),
    (error: any) => error.code === "APN_RPC_BUDGET_EXCEEDED" && error.details?.reason === "request_session_overrun");
  assert.equal((await journal.load(binding))!.rows[0]?.physicalRequests, null);
  const approval = await journal.reserve(binding, "approval-overrun", 14, 14, "approval_effect");
  await assert.rejects(journal.settle(binding, approval, { ...telemetry, httpAttempts: 14, httpRequests: 14 }, 1), { code: "APN_RPC_BUDGET_EXCEEDED" });
  assert.equal((await journal.load(binding))!.rows[1]?.physicalRequests, null);
});
