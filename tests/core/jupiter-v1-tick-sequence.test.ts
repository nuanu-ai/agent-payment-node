import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../../src/canonical.js";
import { fixture, mutate } from "../fixtures/jupiter-v1/material.js";
import { capturedV2 } from "../fixtures/jupiter-v1-whirlpool-v2/capture.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { assertWhirlpoolTickArraySequence } from "../../src/swap/jupiter-solana/v1-tick-sequence.js";
import { decodeWhirlpoolV2AccountSnapshot } from "../../src/swap/jupiter-solana/v1-whirlpool-v2-accounts.js";
import { JUPITER_V1_WHIRLPOOL_V2_POOL } from "../../src/swap/jupiter-solana/v1-pins.js";
import type { JupiterV1SemanticAccount } from "../../src/swap/jupiter-solana/v1-material.js";

// QA 0.5.51 (DEVELOPER-STATES item 8): approval of route 83 refused "tick array seed or order changed" 12 s after its
// quote. Pool 83v8 has tick spacing 1, so one tick array spans 88 ticks (about 0.88% of price); the guard demanded the
// arrays Jupiter froze at quote time equal the program's preferred run for the pool's tick at approval. The Whirlpool
// program itself starts at whichever named array holds the current tick, so a pool that moved down still swaps.
const TICK = 81;
const identity = () => { throw new Error("identity"); };
const starts = (first: number, width: number) => [first, first - width, first - 2 * width];

test("the program's own sequence: the current tick may sit in any of the three named arrays", () => {
  for (const tick of [0, 87, -1, -88, -176, -89]) assertWhirlpoolTickArraySequence(starts(0, 88), tick, 1, identity);
  for (const [tick, side] of [[88, "above"], [-177, "below"]] as const) {
    assert.throws(() => assertWhirlpoolTickArraySequence(starts(0, 88), tick, 1, identity), (error: any) => {
      assert.equal(error.code, "APN_REPREPARE_REQUIRED", side); assert.equal(error.details.reason, "jupiter_v1_pool_left_quoted_tick_arrays");
      assert.deepEqual([error.details.firstTickArrayStart, error.details.lastTickArrayStart], [0, -176]); return true; });
  }
});
test("arrays that are not one aligned descending run still refuse as an identity change", () => {
  for (const bad of [[0, 88, 176], [0, -88], [0, -88, -176, -264], [1, -87, -175], [0, -176, -264], [0, 0, -88]])
    assert.throws(() => assertWhirlpoolTickArraySequence(bad, 0, 1, identity), /identity/);
});

function withPoolTick(m: ReturnType<typeof fixture>, tick: number) {
  const pool = m.quoteResponse.routePlan[0]!.swapInfo.ammKey;
  return mutate(m, (v: any) => { const a = v.semanticAccounts.find((row: any) => row.address === pool), d = Buffer.from(a.dataBase64, "base64");
    d.writeInt32LE(tick, TICK); a.dataBase64 = d.toString("base64"); });
}
function legacyLayout(m: ReturnType<typeof fixture>) {
  const pool = m.semanticAccounts.find(a => a.address === m.quoteResponse.routePlan[0]!.swapInfo.ammKey)!, d = Buffer.from(pool.dataBase64, "base64");
  const first = m.rawBuildResponse.swapInstruction.accounts[17]!.pubkey, array = Buffer.from(m.semanticAccounts.find(a => a.address === first)!.dataBase64, "base64");
  return { width: d.readUInt16LE(41) * 88, firstStart: array.readInt32LE(8) };
}
test("legacy route guard accepts a pool that moved down into the second or third quoted array", async () => {
  const m = fixture(), { width, firstStart } = legacyLayout(m);
  for (const tick of [firstStart - 1, firstStart - width, firstStart - 2 * width]) {
    const g = await guardJupiterV1WhirlpoolMaterial(withPoolTick(m, tick)); assert.equal(g.nativeAccounts.length, 11);
  }
});
test("legacy route guard refuses for a new quote once the pool left the quoted arrays", async () => {
  const m = fixture(), { width, firstStart } = legacyLayout(m);
  for (const tick of [firstStart + width, firstStart - 2 * width - 1])
    await assert.rejects(guardJupiterV1WhirlpoolMaterial(withPoolTick(m, tick)), { code: "APN_REPREPARE_REQUIRED" });
});

function v2Accounts(tick: number): JupiterV1SemanticAccount[] {
  return capturedV2().accounts.map(a => { if (a.address !== JUPITER_V1_WHIRLPOOL_V2_POOL) return a;
    const d = Buffer.from(a.dataBase64, "base64"); d.writeInt32LE(tick, TICK); return { ...a, dataBase64: d.toString("base64"), dataHash: sha256(d) }; });
}
test("SwapV2 snapshot follows the same program sequence for the Esv pool", () => {
  const c = capturedV2(), snapshot = decodeWhirlpoolV2AccountSnapshot(c.build, c.accounts), width = snapshot.pool.tickSpacing * 88, first = snapshot.ticks[0]!.startTickIndex;
  assert.deepEqual(snapshot.ticks.map(t => t.startTickIndex), starts(first, width));
  for (const tick of [first - 1, first - width, first - 2 * width])
    assert.equal(decodeWhirlpoolV2AccountSnapshot(c.build, v2Accounts(tick)).pool.tickCurrentIndex, tick);
  for (const tick of [first + width, first - 2 * width - 1])
    assert.throws(() => decodeWhirlpoolV2AccountSnapshot(c.build, v2Accounts(tick)), { code: "APN_REPREPARE_REQUIRED" });
});
