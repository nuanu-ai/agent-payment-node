import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../../src/canonical.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { captured4H } from "../fixtures/jupiter-v1-whirlpool-4h/capture.js";
import { capturedV2 } from "../fixtures/jupiter-v1-whirlpool-v2/capture.js";
import { decodeJupiterV1Quote } from "../../src/swap/jupiter-solana/v1-codec.js";
import { routeConfigForQuoteBuild, routeConfigForQuote, JUPITER_V1_WHIRLPOOL_4H_ROUTE, JUPITER_V1_WHIRLPOOL_V2_ROUTE } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { validateWhirlpoolV2AccountSnapshot, decodeWhirlpoolV2Pool, decodeWhirlpoolV2Oracle, decodeWhirlpoolV2AccountSnapshot } from "../../src/swap/jupiter-solana/v1-whirlpool-v2-accounts.js";
import { JUPITER_V1_WHIRLPOOL_4H_POOL as POOL } from "../../src/swap/jupiter-solana/v1-pins.js";
import type { JupiterV1SemanticAccount } from "../../src/swap/jupiter-solana/v1-material.js";

function changed(a: JupiterV1SemanticAccount, mutate: (d: Buffer) => void): JupiterV1SemanticAccount {
 const data = Buffer.from(a.dataBase64, "base64"); mutate(data);
 return { ...a, dataBase64: data.toString("base64"), dataHash: sha256(data) };
}

test("4H public account capture binds its distinct configuration, PDA, adaptive oracle and mixed tick layouts", async () => {
 const c = captured4H(), route = routeConfigForQuoteBuild(c.quote, c.build);
 assert.equal(route, JUPITER_V1_WHIRLPOOL_4H_ROUTE);
 const snapshot = await validateWhirlpoolV2AccountSnapshot(c.build.swapInstruction.accounts[1]!.pubkey, c.build, c.accounts);
 assert.equal(snapshot.roles.pool, POOL);
 assert.equal(snapshot.pool.tickSpacing, 4); assert.equal(snapshot.pool.feeTierIndexSeed, 1028);
 assert.equal(snapshot.pool.feeRate, 400); assert.equal(snapshot.pool.bump, 251);
 assert.deepEqual(snapshot.ticks.map(t => [t.kind, t.startTickIndex]), [["fixed", -21824], ["dynamic", -22176], ["fixed", -22528]]);
 assert.equal(snapshot.oracle.constants.adaptiveFeeControlFactor, 60000);
 assert.equal(snapshot.oracle.constants.tickGroupSize, 4);
 assert.notEqual(swapMechanismDigest(route.mechanismPin), swapMechanismDigest(JUPITER_V1_WHIRLPOOL_V2_ROUTE.mechanismPin));
 assert.notEqual(route.protocolRegistry.registryDigest, JUPITER_V1_WHIRLPOOL_V2_ROUTE.protocolRegistry.registryDigest);
 assert.throws(() => routeConfigForQuote(c.quote, JUPITER_V1_WHIRLPOOL_V2_ROUTE.routeId));
});

for (let index = 0; index < 25; index++) {
 for (const flag of ["isSigner", "isWritable"] as const) test(`4H raw role ${index} refuses altered ${flag}`, () => {
  const c = captured4H(), build = { ...c.build, swapInstruction: { ...c.build.swapInstruction,
   accounts: c.build.swapInstruction.accounts.map((a, i) => i === index ? { ...a, [flag]: !a[flag] } : a) } };
  assert.throws(() => routeConfigForQuoteBuild(c.quote, build));
 });
 test(`4H raw role ${index} refuses a foreign identity`, async () => {
  const c = captured4H(), build = { ...c.build, swapInstruction: { ...c.build.swapInstruction,
   accounts: c.build.swapInstruction.accounts.map((a, i) => i === index ? { ...a, pubkey: "11111111111111111111111111111111" } : a) } };
  await assert.rejects(async () => { routeConfigForQuoteBuild(c.quote, build);
   await validateWhirlpoolV2AccountSnapshot(c.build.swapInstruction.accounts[1]!.pubkey, build, c.accounts); });
 });
}

for (const offset of [0, 8, 40, 41, 43, 45, 47, 101, 133, 181, 213]) test(`4H pool refuses immutable field drift at ${offset}`, () => {
 const a = captured4H().accounts.find(a => a.address === POOL)!;
 assert.throws(() => decodeWhirlpoolV2Pool(changed(a, d => { d[offset] = d[offset]! ^ 1; })));
});
for (const offset of [0, 8, 40, 48, 50, 52, 54, 58, 62, 64, 66, 110, 253]) test(`4H oracle refuses contract drift at ${offset}`, () => {
 const c = captured4H(), a = c.accounts.find(a => a.address === c.build.swapInstruction.accounts[24]!.pubkey)!;
 assert.throws(() => decodeWhirlpoolV2Oracle(changed(a, d => { d[offset] = d[offset]! ^ 1; })));
});

test("4H rejects cross-pool vault, oracle and tick substitution, including a rehashed renamed tick row", () => {
 const c = captured4H(), other = capturedV2();
 for (const index of [18, 20, 24]) {
  const build = { ...c.build, swapInstruction: { ...c.build.swapInstruction,
   accounts: c.build.swapInstruction.accounts.map((a, i) => i === index ? { ...a, pubkey: other.build.swapInstruction.accounts[i]!.pubkey } : a) } };
  assert.throws(() => routeConfigForQuoteBuild(c.quote, build));
 }
 const tick = other.accounts.find(a => a.address === other.build.swapInstruction.accounts[21]!.pubkey)!;
 const destination = c.build.swapInstruction.accounts[21]!.pubkey;
 assert.throws(() => decodeWhirlpoolV2AccountSnapshot(c.build, c.accounts.map(a => a.address === destination ? { ...tick, address: destination } : a)));
});

test("the finite set refuses an unreviewed pool and route/policy substitution", () => {
 const c = captured4H(), quote = structuredClone(c.quote);
 (quote.routePlan[0]!.swapInfo as { ammKey: string }).ammKey = "11111111111111111111111111111111";
 assert.throws(() => decodeJupiterV1Quote(quote));
 assert.throws(() => routeConfigForQuote(capturedV2().quote, JUPITER_V1_WHIRLPOOL_4H_ROUTE.routeId));
});
