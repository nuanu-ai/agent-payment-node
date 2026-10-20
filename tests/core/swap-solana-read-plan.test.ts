// Fake ports over captured public bytes. No live read, signature or send.
import assert from "node:assert/strict";
import test from "node:test";
import type { SolanaRpcPort } from "../../src/solana/rpc.js";
import { SOLANA_SWAP_PLAN_HEADROOM_REQUESTS, solanaSwapCommandRequests } from "../../src/swap/solana-read-plan.js";
import { readSolanaAccountPages } from "../../src/swap/solana-account-pages.js";
import { readRawAccounts } from "../../src/swap/orca-solana/accounts.js";
import { readOrcaMarket } from "../../src/swap/orca-solana/market.js";
import { SolanaRpc, SolanaRpcBudget } from "../../src/solana/rpc.js";
import { KeylessOrcaQuoteBuilder } from "../../src/swap/orca-solana/builder.js";
import { ORCA_POOLS } from "../../src/swap/orca-solana/pools.js";
import { SavedOrcaQuoteStore } from "../../src/swap/orca-solana/material.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAMDATA, verifyOrcaProgramPins, WHIRLPOOL_PROGRAM,
  WHIRLPOOL_PROGRAMDATA } from "../../src/swap/orca-solana/pins.js";
import { JupiterV1MaterialResolver } from "../../src/swap/jupiter-solana/v1-resolver.js";
import { fixture } from "../fixtures/jupiter-v1/material.js";
import { capturedPort } from "../fixtures/jupiter-v1/authority.js";
import { whirlpoolC422b2ProgramData } from "../fixtures/whirlpool-runtime-c422b2/programdata.js";
import { AMOUNT_IN, FakeOrcaRpc, orcaOwner, PROFILE } from "./orca-solana-helpers.js";
import { temporaryState } from "./helpers.js";

test("each Orca keyless and Jupiter command's Solana budget is its read plan plus the stated headroom", () => {
  const plans = Object.fromEntries(["swap.orca.quote", "swap.orca.prepare", "swap.orca.approve", "swap.orca.execute", "swap.orca.status",
    "swap.jupiter.quote", "swap.jupiter.prepare", "swap.jupiter.approve", "swap.jupiter.execute", "swap.jupiter.status"]
    .map((command) => [command, solanaSwapCommandRequests(command)! - SOLANA_SWAP_PLAN_HEADROOM_REQUESTS]));
  assert.deepEqual(plans, { "swap.orca.quote": 9, "swap.orca.prepare": 0, "swap.orca.approve": 13, "swap.orca.execute": 13, "swap.orca.status": 4,
    "swap.jupiter.quote": 15, "swap.jupiter.prepare": 0, "swap.jupiter.approve": 20, "swap.jupiter.execute": 20, "swap.jupiter.status": 4 });
  for (const command of ["swap.orca.stable-quote", "swap.uniswap.quote", "solana.transfer"]) assert.equal(solanaSwapCommandRequests(command), null);
});

test("an Orca keyless quote with the production program verifier sends exactly its planned reads", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const o = await orcaOwner(temporary.root), fake = new FakeOrcaRpc(o.address, o.wsol, o.usdc, o.oracle), captured = fixture().semanticAccounts;
  const programs = new Map<string, { owner: string; executable: boolean; data: Buffer }>();
  for (const key of [WHIRLPOOL_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAMDATA, ATA_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM]) {
    const a = captured.find((row) => row.address === key)!; programs.set(key, { owner: a.owner!, executable: a.executable, data: Buffer.from(a.dataBase64, "base64") });
  }
  programs.set(WHIRLPOOL_PROGRAMDATA, { owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: false, data: whirlpoolC422b2ProgramData() });
  let posts = 0;
  const rpc: SolanaRpcPort = { originHash: fake.originHash, async call(method, params) {
    posts++;
    const keys = params[0] as string[], slice = (params[1] as { dataSlice?: { offset: number; length: number } } | undefined)?.dataSlice;
    if (method === "getMultipleAccounts" && keys.some((key) => programs.has(key))) return { context: { slot: 447_994_242 }, value: keys.map((key) => {
      const p = programs.get(key)!, data = slice === undefined ? p.data : p.data.subarray(slice.offset, slice.offset + slice.length);
      return { data: [data.toString("base64"), "base64"], executable: p.executable, lamports: 1, owner: p.owner, rentEpoch: 0, space: p.data.length }; }) };
    return await fake.call(method, params);
  } };
  await new KeylessOrcaQuoteBuilder(rpc, new SavedOrcaQuoteStore(temporary.root), verifyOrcaProgramPins, ORCA_POOLS["sol-usdc"]).quote({ profile: PROFILE, account: o.address,
    amountAtomic: AMOUNT_IN.toString(), slippageBps: 50, ownerSlippageCapBps: 100, computeUnitLimit: 200_000, computeUnitPriceMicroLamports: "1000", now: new Date() });
  assert.equal(posts, solanaSwapCommandRequests("swap.orca.quote")! - SOLANA_SWAP_PLAN_HEADROOM_REQUESTS);
});

test("a Jupiter resolve in eight-key account requests stays within its planned reads", async () => {
  const m = fixture(), port = capturedPort(m);
  await new JupiterV1MaterialResolver(port.rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports);
  // The port has no JSON-RPC batch, so fee, height and rent cost three calls here; on a public endpoint they share one POST.
  const posts = port.methods.length - 2;
  assert.ok(posts + 2 /* blockhash, simulation */ <= solanaSwapCommandRequests("swap.jupiter.quote")! - SOLANA_SWAP_PLAN_HEADROOM_REQUESTS, `${posts}`);
  assert.equal(port.methods.includes("getAccountInfo"), false);
});

/** Ten keys like the Orca market read: pool, three tick arrays, oracle, two vaults, owner, then the two token accounts. */
const TEN = ["Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE", "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9", "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP",
  WHIRLPOOL_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, WHIRLPOOL_PROGRAMDATA, TOKEN_PROGRAMDATA];
function pagedPort(slots: readonly number[], batch: boolean) {
  const calls: { keys: string[]; config: unknown }[] = [], batches: number[] = []; let page = 0;
  const answer = (params: readonly unknown[]) => { const keys = params[0] as string[]; calls.push({ keys, config: params[1] });
    return { context: { slot: slots[page++]! }, value: keys.map(() => ({ data: [Buffer.alloc(4).toString("base64"), "base64"], executable: false, lamports: 1,
      owner: SYSTEM_PROGRAM, rentEpoch: 0, space: 4 })) }; };
  const rpc: SolanaRpcPort = { originHash: "0".repeat(64), async call(method, params) { assert.equal(method, "getMultipleAccounts"); return answer(params); },
    ...(batch ? { async batch(reads) { batches.push(reads.length); return reads.map((read) => answer(read.params)); } } : {}) };
  return { rpc, calls, batches };
}
test("a ten-key account read goes out as an eight-key and a two-key request with one config, batched only where the transport batches", async () => {
  for (const batch of [false, true]) {
    const p = pagedPort([500, 510], batch), read = await readRawAccounts(p.rpc, TEN, 16);
    assert.deepEqual(p.calls.map((call) => call.keys), [TEN.slice(0, 8), TEN.slice(8)]);
    assert.deepEqual(p.calls[0]!.config, p.calls[1]!.config); assert.deepEqual(p.calls[0]!.config, { encoding: "base64", commitment: "confirmed" });
    assert.deepEqual(p.batches, batch ? [2] : []); assert.equal(read.slot, 510n); assert.equal(read.accounts.length, 10);
  }
  assert.equal((await readRawAccounts(pagedPort([500, 650], false).rpc, TEN, 16)).slot, 650n);
  await assert.rejects(readRawAccounts(pagedPort([500, 651], false).rpc, TEN, 16), (error: { details?: { reason?: string } }) =>
    error.details?.reason === "solana_account_pages_slot_spread");
});
test("every page carries the caller's minimum context slot and refuses an answer behind it", async () => {
  const p = pagedPort([700, 704], false);
  const read = await readSolanaAccountPages(p.rpc, TEN, { encoding: "base64", minContextSlot: 700 }, null);
  assert.deepEqual(read.keySlots, [...TEN.slice(0, 8).map(() => 700n), 704n, 704n]); assert.equal(read.slot, 704n);
  assert.ok(p.calls.every((call) => (call.config as { minContextSlot: number }).minContextSlot === 700));
  await assert.rejects(readSolanaAccountPages(pagedPort([700, 699], false).rpc, TEN, { encoding: "base64", minContextSlot: 700 }, null), { code: "APN_RPC_PROTOCOL" });
});
test("on PublicNode the Orca market read never sends more than eight keys or two account reads in one POST", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const o = await orcaOwner(temporary.root), fake = new FakeOrcaRpc(o.address, o.wsol, o.usdc, o.oracle), bodies: unknown[] = [];
  const json = (value: unknown) => JSON.stringify(value, (_k, v) => typeof v === "bigint" ? `__big__${v}` : v).replace(/"__big__(\d+)"/gu, "$1");
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id: string; method: string; params: unknown[] } | { id: string; method: string; params: unknown[] }[];
    bodies.push(body);
    const reply = async (q: { id: string; method: string; params: unknown[] }) => ({ jsonrpc: "2.0", id: q.id, result: await fake.call(q.method as never, q.params) });
    return new Response(json(Array.isArray(body) ? await Promise.all(body.map(reply)) : await reply(body)), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  let clock = 0;
  const rpc = new SolanaRpc("https://solana-rpc.publicnode.com", fetcher, new SolanaRpcBudget({ maxPhysicalRequests: 16, now: () => clock, wait: async (ms) => { clock += ms; } }));
  const market = await readOrcaMarket(rpc, o.address, AMOUNT_IN);
  assert.equal(market.tickArrays.length, 3);
  const accountBodies = bodies.flatMap((body) => Array.isArray(body) ? body : [body]).filter((q) => q.method === "getMultipleAccounts");
  assert.deepEqual(accountBodies.map((q) => (q.params[0] as string[]).length), [1, 8, 2]);
  assert.ok(bodies.every((body) => !Array.isArray(body) || body.filter((q) => q.method === "getMultipleAccounts").length <= 1));
});
