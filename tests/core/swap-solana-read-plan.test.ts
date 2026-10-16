// Fake ports over captured public bytes. No live read, signature or send.
import assert from "node:assert/strict";
import test from "node:test";
import type { SolanaRpcPort } from "../../src/solana/rpc.js";
import { SOLANA_SWAP_PLAN_HEADROOM_REQUESTS, solanaSwapCommandRequests } from "../../src/swap/solana-read-plan.js";
import { KeylessOrcaQuoteBuilder } from "../../src/swap/orca-solana/builder.js";
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
  assert.deepEqual(plans, { "swap.orca.quote": 8, "swap.orca.prepare": 0, "swap.orca.approve": 12, "swap.orca.execute": 12, "swap.orca.status": 4,
    "swap.jupiter.quote": 15, "swap.jupiter.prepare": 0, "swap.jupiter.approve": 19, "swap.jupiter.execute": 19, "swap.jupiter.status": 4 });
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
  await new KeylessOrcaQuoteBuilder(rpc, new SavedOrcaQuoteStore(temporary.root), verifyOrcaProgramPins).quote({ profile: PROFILE, account: o.address,
    amountAtomic: AMOUNT_IN.toString(), slippageBps: 50, ownerSlippageCapBps: 100, computeUnitLimit: 200_000, computeUnitPriceMicroLamports: "1000", now: new Date() });
  assert.equal(posts, solanaSwapCommandRequests("swap.orca.quote")! - SOLANA_SWAP_PLAN_HEADROOM_REQUESTS);
});

test("a Jupiter resolve at the PublicNode eight-key limit stays within its planned reads", async () => {
  const m = fixture(), port = capturedPort(m), rpc: SolanaRpcPort = { ...port.rpc, maximumAccountsPerRead: 8 };
  await new JupiterV1MaterialResolver(rpc).resolve(m.payer, m.quoteResponse, m.rawBuildResponse, m.maximumNativeExpenseLamports);
  // The port has no JSON-RPC batch, so fee, height and rent cost three calls here; on a public endpoint they share one POST.
  const posts = port.methods.length - 2;
  assert.ok(posts + 2 /* blockhash, simulation */ <= solanaSwapCommandRequests("swap.jupiter.quote")! - SOLANA_SWAP_PLAN_HEADROOM_REQUESTS, `${posts}`);
  assert.equal(port.methods.includes("getAccountInfo"), false);
});
