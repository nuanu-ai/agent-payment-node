import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../src/canonical.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { capturedFp } from "../fixtures/jupiter-v1-whirlpool-fp/capture.js";
import { syntheticFpMaterial } from "../fixtures/jupiter-v1-whirlpool-fp/material.js";
import { fixture, mutate } from "../fixtures/jupiter-v1/material.js";
import { simulation, receipt } from "../fixtures/jupiter-v1/scenarios.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { proveJupiterV1Simulation, validateFinalizedJupiterV1Receipt } from "../../src/swap/jupiter-solana/v1-proof.js";
import { routeConfigForQuoteBuild, routeConfigForQuote, JUPITER_V1_WHIRLPOOL_FP_ROUTE, JUPITER_V1_OLD_ROUTE } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { decodeReviewedWhirlpoolFpPool, validateReviewedWhirlpoolFpPool, REVIEWED_WHIRLPOOL_FP } from "../../src/swap/jupiter-solana/v1-whirlpool-fp.js";
import type { JupiterV1SemanticAccount } from "../../src/swap/jupiter-solana/v1-material.js";

test("Fp public capture binds an independently pinned static-fee pool, PDA, vaults and legacy ABI", async () => {
 const c = capturedFp(), a = c.accounts.find(a => a.address === REVIEWED_WHIRLPOOL_FP.pool)!;
 assert.equal(routeConfigForQuoteBuild(c.quote,c.build),JUPITER_V1_WHIRLPOOL_FP_ROUTE);
 await validateReviewedWhirlpoolFpPool(a);
 const state = decodeReviewedWhirlpoolFpPool(a);
 assert.equal(state.tickSpacing,2); assert.equal(state.feeTierIndexSeed,2); assert.equal(state.feeRate,200);
 assert.deepEqual(c.build.swapInstruction.accounts.slice(17,20).map(x => Buffer.from(c.accounts.find(a => a.address === x.pubkey)!.dataBase64,"base64").readInt32LE(8)),[-21824,-22000,-22176]);
 assert.notEqual(swapMechanismDigest(JUPITER_V1_WHIRLPOOL_FP_ROUTE.mechanismPin),swapMechanismDigest(JUPITER_V1_OLD_ROUTE.mechanismPin));
 assert.throws(() => routeConfigForQuote(c.quote,JUPITER_V1_OLD_ROUTE.routeId));
 assert.throws(() => routeConfigForQuote(fixture().quoteResponse,JUPITER_V1_WHIRLPOOL_FP_ROUTE.routeId));
});
function changed(a:JupiterV1SemanticAccount, offset:number) { const d = Buffer.from(a.dataBase64,"base64"); d[offset] = d[offset]! ^ 1; return { ...a,dataBase64:d.toString("base64"),dataHash:sha256(d) }; }
for (const offset of [0,8,40,41,43,45,47,101,133,181,213]) test(`Fp immutable pool field ${offset} refuses after rehash`, () => {
 const a = capturedFp().accounts.find(a => a.address === REVIEWED_WHIRLPOOL_FP.pool)!;
 assert.throws(() => decodeReviewedWhirlpoolFpPool(changed(a,offset)));
});
test("SYNTHETIC Fp guard and proof bind the exact legacy message; modeled simulation and receipt are not live acceptance",async () => {
 const g = await guardJupiterV1WhirlpoolMaterial(syntheticFpMaterial());
 assert.equal(g.pool,REVIEWED_WHIRLPOOL_FP.pool); assert.equal(g.nativeAccounts.length,11);
 const s = simulation(g); s.context.slot = Number(g.material.accountSlot) + 1;
 const p = await proveJupiterV1Simulation({async call(method,params) { assert.equal(method,"simulateTransaction"); assert.equal(params[0],g.material.transactionBase64); return s; }},g);
 assert.equal(p.nativeSpendLamports,"1006400"); assert.equal(p.recipientOutputAtomic,"116130");
 const r = receipt(g); r.status.context.slot = s.context.slot + 1; r.status.value[0]!.slot = s.context.slot; r.response.slot = s.context.slot;
 const proof = await validateFinalizedJupiterV1Receipt({async call(method) { return method === "getSignatureStatuses" ? r.status : r.response; }},g,{signature:r.signature});
 assert.equal(proof.recipientOutputAtomic,"116130");
});
for (let index = 0; index < 21; index++) for (const flag of ["isSigner","isWritable"] as const) test(`SYNTHETIC Fp raw role ${index} refuses changed ${flag}`,async () => {
 await assert.rejects(async () => { const m = mutate(syntheticFpMaterial(),v => { v.rawBuildResponse.swapInstruction.accounts[index][flag] = !v.rawBuildResponse.swapInstruction.accounts[index][flag]; });
   await guardJupiterV1WhirlpoolMaterial(m); });
});
for (const index of [12,14,16,17,18,19,20]) test(`SYNTHETIC Fp refuses account ${index} substitution`,async () => {
 await assert.rejects(async () => { const m = mutate(syntheticFpMaterial(),v => { v.rawBuildResponse.swapInstruction.accounts[index].pubkey = "11111111111111111111111111111111"; }); await guardJupiterV1WhirlpoolMaterial(m); });
});
for (const kind of ["owner","executable","absent","native cap","pool fee drift","adaptive oracle","tick seed","foreign tick pool"]) test(`SYNTHETIC Fp refuses ${kind} before proof RPC`,async () => {
 let effects = 0;
 await assert.rejects(async () => { const m = mutate(syntheticFpMaterial(),v => {
  const pool = v.semanticAccounts.find((a:any) => a.address === REVIEWED_WHIRLPOOL_FP.pool);
  if (kind === "owner") pool.owner = v.payer;
  else if (kind === "executable") pool.executable = true;
  else if (kind === "absent") pool.existence = "absent";
  else if (kind === "native cap") v.maximumNativeExpenseLamports = "6000001";
  else if (kind === "pool fee drift") { const d = Buffer.from(pool.dataBase64,"base64"); d.writeUInt16LE(201,45); pool.dataBase64 = d.toString("base64"); }
  else if (kind === "adaptive oracle") v.semanticAccounts.find((a:any) => a.address === REVIEWED_WHIRLPOOL_FP.oracle).owner = pool.owner;
  else { const a = v.semanticAccounts.find((a:any) => a.address === v.rawBuildResponse.swapInstruction.accounts[17].pubkey),d = Buffer.from(a.dataBase64,"base64"); if (kind === "tick seed") d.writeInt32LE(-22000,8); else d.fill(0,9956); a.dataBase64 = d.toString("base64"); }
 }); await guardJupiterV1WhirlpoolMaterial(m); effects++; });
 assert.equal(effects,0);
});
