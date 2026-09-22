import assert from "node:assert/strict";
import test from "node:test";
import { RpcReadSession } from "../../src/lifi/rpc.js";
import { StateStore } from "../../src/state.js";
import { UniswapTokenRpcBudgetJournal } from "../../src/swap/uniswap-v3/token-rpc-budget.js";
import { createTokenRpc, tokenBatch, tokenChain, tokenHex, tokenQuantity, type TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { UniswapTokenQuoteBuilder } from "../../src/swap/uniswap-v3/token-builder.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { ETHEREUM_USDT, UNISWAP_V3_QUOTER_V2 } from "../../src/swap/uniswap-v3/pins.js";
import { temporaryState } from "./helpers.js";

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

test("token raw send is one direct attempt outside the read retry and request budgets", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); let attempts = 0;
  const rpc = createTokenRpc({ environment: URLS, state: new StateStore(temp.root), now: Date.now, maxHttpRequests: 1, deadlineMs: 10_000,
    transport: { request: async () => { attempts += 1; return { status: 503, body: "unavailable" }; } } });
  await assert.rejects(rpc("eth_sendRawTransaction", ["0x00"])); assert.equal(attempts, 1); assert.equal(rpc.effectAttempts!(), 1);
  assert.equal(rpc.telemetry!()?.httpAttempts, 0);
});

test("durable operation budget caps only new effects and never blocks status or cleanup recovery", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup); const journal = new UniswapTokenRpcBudgetJournal(temp.root), binding = "b".repeat(64);
  const telemetry = (attempts: number) => ({ ...new RpcReadSession().telemetry(), httpRequests: attempts, httpAttempts: attempts });
  for (const [command, cap, actual] of [["quote", 8, 8], ["prepare", 9, 9], ["approve", 14, 14], ["execute", 24, 24]] as const) {
    const reservation = await journal.reserve(binding, command, cap); await journal.settle(binding, reservation, telemetry(actual), 0);
  }
  for (const command of ["status-pending-1", "status-pending-2", "status-final", "cleanup"]) {
    const reservation = await journal.reserve(binding, command, 0); await journal.settle(binding, reservation, telemetry(8), 0);
  }
  await assert.rejects(journal.reserve(binding, "another-effect", 14), { code: "APN_RPC_BUDGET_EXCEEDED" });
  const rows = (await journal.load(binding))!.rows; assert.equal(rows.length, 8); assert.equal(rows.at(-1)?.physicalRequests, 8);
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
