import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import { ApnError } from "../../src/errors.js";
import { failureEnvelope } from "../../src/output.js";
import { canonicalJson } from "../../src/canonical.js";
import { SolanaRpc, SolanaRpcBudget, type SolanaRpcPort } from "../../src/solana/rpc.js";
import { JupiterV1MaterialResolver } from "../../src/swap/jupiter-solana/v1-resolver.js";
import { JupiterV1QuoteBuilder } from "../../src/swap/jupiter-solana/v1-builder.js";
import { JupiterV1ReadOnlyProvider } from "../../src/swap/jupiter-solana/v1-provider.js";
import type { SavedJupiterV1MaterialStore } from "../../src/swap/jupiter-solana/v1-material.js";
import { validateJupiterV1Material, jupiterV1MaterialDigest, type JupiterV1ResolvedMaterial } from "../../src/swap/jupiter-solana/v1-material.js";
import { fixture } from "../fixtures/jupiter-v1/material.js";
import { capturedPort } from "../fixtures/jupiter-v1/authority.js";

const HEIGHT = 432_279_120n;
/** Captured accounts plus a configured-RPC blockhash `remaining` blocks beyond the fee/height read. */
function lifetimeReader(m: JupiterV1ResolvedMaterial, remaining = 150, changes: Record<string, unknown> = {}, contextOffset = 1) {
 const port = capturedPort(m), slot = Number(m.accountSlot), blockhash = getBase58Decoder().decode(Buffer.alloc(32, 53));
 const rpc: SolanaRpcPort = { originHash: "e".repeat(64), async call(method, params) {
  if (method === "getLatestBlockhash") { port.methods.push(method); assert.deepEqual(params, [{ commitment: "confirmed", minContextSlot: slot }]);
   return { context: { slot: slot + contextOffset }, value: { blockhash, lastValidBlockHeight: HEIGHT + BigInt(remaining), ...changes } }; }
  if (method === "getBlockHeight") { port.methods.push(method); return HEIGHT; }
  return await port.rpc.call(method, params);
 } };
 return { rpc, methods: port.methods, blockhash, slot };
}
const resolve = (rpc: SolanaRpcPort, m = fixture()) => new JupiterV1MaterialResolver(rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse,
 m.maximumNativeExpenseLamports, undefined, undefined, true);
const AFTER_ACCOUNTS = ["getLatestBlockhash", "getFeeForMessage", "getBlockHeight", "getMinimumBalanceForRentExemption"];

test("a new quote freezes the configured RPC blockhash after its account reads; the official build stays untouched", async () => {
 const m = fixture(), before = canonicalJson(m), reader = lifetimeReader(m), result = await resolve(reader.rpc, m);
 assert.notEqual(result.messageHash, m.messageHash); assert.equal(result.lifetime.blockhash, reader.blockhash);
 assert.equal(result.quoteRpcLifetime?.source, "configured_mainnet_rpc_before_quote_freeze"); assert.equal(result.quoteRpcLifetime?.rpcOriginHash, reader.rpc.originHash);
 assert.deepEqual(result.rawBuildResponse, m.rawBuildResponse); assert.equal(result.rawBuildResponseHash, m.rawBuildResponseHash);
 assert.deepEqual(result.rawInstructions, m.rawInstructions); assert.deepEqual(result.compiledAccounts, m.compiledAccounts); assert.deepEqual(result.quoteResponse, m.quoteResponse);
 assert.equal(canonicalJson(m), before); assert.equal(validateJupiterV1Material(result), result);
 assert.deepEqual(reader.methods.slice(-4), AFTER_ACCOUNTS); assert.equal(reader.methods.filter(x => x === "getFeeForMessage").length, 1);
 const rehashed = (changed: any) => { const { materialDigest: _d, ...body } = changed; return { ...body, materialDigest: jupiterV1MaterialDigest(body) }; };
 assert.throws(() => validateJupiterV1Material(rehashed({ ...result, lifetime: m.lifetime })), { code: "APN_STATE_CORRUPT" });
 assert.throws(() => validateJupiterV1Material(rehashed({ ...result, quoteRpcLifetime: { ...result.quoteRpcLifetime, blockhash: m.lifetime.blockhash } })), { code: "APN_STATE_CORRUPT" });
 assert.throws(() => validateJupiterV1Material(rehashed({ ...result, quoteRpcLifetime: { ...result.quoteRpcLifetime, source: "provider_supplied" } })), { code: "APN_STATE_CORRUPT" });
});
for (const remaining of [100, 151]) test(`a frozen RPC lifetime accepts the bounded ${remaining} block edge`, async () => {
 const result = await resolve(lifetimeReader(fixture(), remaining).rpc);
 assert.equal(BigInt(result.lifetime.lastValidBlockHeight) - BigInt(result.currentBlockHeight), BigInt(remaining));
});
for (const remaining of [99, 152, -1]) test(`a frozen RPC lifetime refuses ${remaining} remaining blocks`, async () => {
 const reader = lifetimeReader(fixture(), remaining);
 await assert.rejects(resolve(reader.rpc), error => {
  assert(error instanceof ApnError); assert.equal(error.code, "APN_REPREPARE_REQUIRED");
  assert.equal(error.message, "Jupiter's pre-freeze RPC blockhash has an insufficient or excessive lifetime.");
  const details = { remainingBlocks: String(remaining), observedBlockHeight: HEIGHT.toString(), lastValidBlockHeight: (HEIGHT + BigInt(remaining)).toString(),
   blockhashContextSlot: String(reader.slot + 1), requiredMinimumContextSlot: String(reader.slot), minimumRemainingBlocks: 100, maximumRemainingBlocks: 151, commitment: "confirmed" };
  assert.deepEqual(error.details, details);
  const output = JSON.parse(JSON.stringify(failureEnvelope("swap.quote", "lifetime-diagnostic-test", error)));
  assert.deepEqual(output.error, { code: error.code, message: error.message, details }); assert.equal(output.operation, null); return true;
 });
 assert.deepEqual(reader.methods.slice(-4), AFTER_ACCOUNTS);
});
test("a blockhash from a bank older than the completed account reads refuses before any fee read", async () => {
 const reader = lifetimeReader(fixture(), 150, {}, -1);
 await assert.rejects(resolve(reader.rpc), { code: "APN_STATE_CORRUPT" }); assert.equal(reader.methods.includes("getFeeForMessage"), false);
});
test("an unknown blockhash value field refuses before any fee read", async () => {
 const reader = lifetimeReader(fixture(), 150, { untrustedExtension: 1 });
 await assert.rejects(resolve(reader.rpc), { code: "APN_RPC_PROTOCOL" }); assert.equal(reader.methods.includes("getFeeForMessage"), false);
});
test("one official build per quote: the frozen RPC lifetime needs no second build", async () => {
 const m = fixture(), reader = lifetimeReader(m); let http = 0; const stop = new Error("TEST stop after resolve");
 const provider = new JupiterV1ReadOnlyProvider((async (input: unknown) => { http++;
  return new Response(JSON.stringify(String(input).includes("/quote?") ? m.quoteResponse : m.rawBuildResponse), { headers: { "content-type": "application/json" } }); }) as typeof fetch);
 const builder = new JupiterV1QuoteBuilder(provider, new JupiterV1MaterialResolver(reader.rpc), {} as SavedJupiterV1MaterialStore, { resolvePayer: async () => m.payer,
  computeUnitPriceMicroLamports: 1000, freezeRpcLifetime: true, proveQuote: async material => { assert.equal(material.lifetime.blockhash, reader.blockhash); throw stop; } });
 await assert.rejects(builder.quote({ command: "swap.jupiter.quote", profile: "TEST-only", account: m.payer, recipient: m.payer, amountAtomic: "1000000", slippageBps: 50,
  ownerSlippageCapBps: 50, now: new Date() }), stop);
 assert.equal(http, 2);
});
test("PublicNode's alternate scalar height shape never prices the frozen message: fee, height and rent share one POST", async () => {
 const m = fixture(), slot = Number(m.accountSlot), blockhash = getBase58Decoder().decode(Buffer.alloc(32, 53)), port = capturedPort(m);
 let scalarHeight = 0; const batches: string[][] = [];
 const fetcher = (async (_url: unknown, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as { id: string; method: string; params: unknown[] } | { id: string; method: string; params: unknown[] }[];
  const reply = async (q: { id: string; method: string; params: unknown[] }, batched: boolean) => {
   if (q.method === "getLatestBlockhash") return { jsonrpc: "2.0", id: q.id, result: { context: { slot: slot + 1 }, value: { blockhash, lastValidBlockHeight: Number(HEIGHT + 150n) } } };
   if (q.method === "getBlockHeight") { if (!batched) scalarHeight++; return { jsonrpc: "2.0", id: q.id, result: batched ? Number(HEIGHT) : slot + 1 }; }
   return { jsonrpc: "2.0", id: q.id, result: JSON.parse(JSON.stringify(await port.rpc.call(q.method as never, q.params), (_k, v) => typeof v === "bigint" ? Number(v) : v)) };
  };
  if (Array.isArray(body)) batches.push(body.map(q => q.method));
  const result = Array.isArray(body) ? (await Promise.all(body.map(q => reply(q, true)))).toReversed() : await reply(body, false);
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
 }) as typeof fetch;
 let clock = 0; const budget = new SolanaRpcBudget({ maxPhysicalRequests: 64, now: () => clock, wait: async ms => { clock += ms; } });
 const result = await resolve(new SolanaRpc("https://solana-rpc.publicnode.com", fetcher, budget), m);
 assert.equal(result.currentBlockHeight, HEIGHT.toString()); assert.equal(scalarHeight, 0);
 assert.deepEqual(batches, [["getFeeForMessage", "getBlockHeight", "getMinimumBalanceForRentExemption"]]);
 assert.equal(budget.logicalCalls, budget.physicalRequests + 2);
});
