import assert from "node:assert/strict";
import test from "node:test";
import { StateStore } from "../../src/state.js";
import { Permit2ProductionSigningFence } from "../../src/x402-permit2/production-signing-fence.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
import { factHash, word } from "./x402-permit2-production-observer-fixture.js";
async function setup(t: test.TestContext, sponsor = false) {
  const f = await journalFixture(t, sponsor);
  (f.input as { mode: string }).mode = "expired_unused";
  f.wire.finalized.timestamp = `0x${protocolSecond.toString(16)}`;
  const fence = new Permit2ProductionSigningFence(f.root, f.input.rpcUrl, f.now);
  return { ...f, fence };
}
for (const sponsor of [false, true]) for (const mode of ["reserved", "exposed"] as const)
  test(`actual signing fence checks ${sponsor ? "permit" : "allowance"} branch in owned ${mode} lifecycle`, async t => {
    const f = await setup(t, sponsor), id = f.record.operationId;
    if (mode === "exposed") await f.journal.markSignatureRisk(id);
    if (sponsor) f.wire.allowance = word(0n);
    const before = await f.journal.findOperation(id), result = await f.fence.check(id, mode);
    assert.equal(result.projection.outcome, "checked"); assert.ok(result.fact);
    assert.equal(result.projection.blockHash, f.wire.finalized.hash); assert.equal(result.projection.capturedAt, f.now().toISOString());
    assert.equal(result.projection.rpc.physicalDispatches, 4); assert.equal(result.projection.rpc.logicalReads, sponsor ? 12 : 11);
    assert.deepEqual(await f.journal.findOperation(id), before); // Read-only fence never changes journal/lease.
    if (mode === "exposed") assert.notEqual(result.projection.originalLeaseDigest, result.projection.currentLeaseDigest);
    assert.equal((await f.fence.consume(result.fact, id, mode)).outcome, "checked");
    await assert.rejects(f.fence.consume(result.fact, id, mode));
    const serialized = JSON.stringify(result);
    for (const secret of ["private", f.permit2Signature, f.input.rpcUrl, "bodyBase64"]) assert.equal(serialized.includes(secret), false);
  });
const faults = ["payer_code", "malformed_code", "missing_code", "chain", "recheck_chain", "reorg", "proxy", "permit2", "domain", "bit", "token_nonce",
  "balance", "allowance", "future_block", "stale_block", "future_clock", "expired_clock", "canonical"] as const;
for (const fault of faults) test(`signing fence refuses ${fault} without cache or fallback`, async t => {
  const f = await setup(t, fault === "token_nonce"), w = f.wire;
  switch (fault) {
    case "payer_code": w.payerCode = "0x6000"; break;
    case "malformed_code": (w as any).payerCode = "0xz"; break;
    case "missing_code": (w as any).payerCode = null; break;
    case "chain": w.chain = "0x1"; break;
    case "recheck_chain": w.beforeBatch = async calls => { if (calls.some(c => c.method === "eth_getBlockByNumber" && c.params[0] !== "finalized")) w.chain = "0x1"; }; break;
    case "reorg": w.headReorg = true; break;
    case "proxy": w.proxyCode = "0x6000"; break;
    case "permit2": w.permit2Code = "0x6000"; break;
    case "domain": w.domain = factHash("a"); break;
    case "bit": w.bitmap = word(1n << 7n); break;
    case "token_nonce": w.tokenNonce = word(10n); break;
    case "balance": w.balance = word(9999n); break;
    case "allowance": w.allowance = word(9999n); break;
    case "future_block": w.finalized.timestamp = `0x${(protocolSecond + 2).toString(16)}`; break;
    case "stale_block": w.finalized.timestamp = `0x${(protocolSecond - 31).toString(16)}`; break;
    case "future_clock": f.advance(-1); break;
    case "expired_clock": f.advance(60); break;
    case "canonical": w.unsupportedCanonical = true; break;
  }
  const result = await f.fence.check(f.record.operationId, "reserved");
  assert.equal(result.projection.outcome, "hold"); assert.equal(result.fact, null); assert.ok(f.batches.length <= 4);
});
for (const fault of ["revocation", "wallet", "clock"] as const) test(`owner ${fault} across RPC prevents late fact mint`, async t => {
  const f = await setup(t), id = f.record.operationId;
  f.wire.beforeBatch = async calls => {
    if (!calls.some(c => c.method === "eth_getBlockByNumber" && c.params[0] !== "finalized")) return;
    if (fault === "revocation") await f.revoke();
    if (fault === "clock") f.advance(60);
    if (fault === "wallet") {
      const envelope = await f.state.loadEncryptedWalletEnvelope("owner") as any;
      envelope.identity.chainId = 1; await f.state.writeEncryptedWalletEnvelope("owner", envelope);
    }
  };
  const result = await f.fence.check(id, "reserved"); assert.equal(result.fact, null); assert.equal(result.projection.outcome, "hold");
});
test("raw, clone, serialized, wrong operation/mode and stale private facts refuse consumption", async t => {
  const f = await setup(t), id = f.record.operationId, checked = await f.fence.check(id, "reserved"); assert.ok(checked.fact);
  await assert.rejects(f.fence.consume({ ...checked.fact }, id, "reserved"));
  await assert.rejects(f.fence.consume(JSON.parse(JSON.stringify(checked.fact)), id, "reserved"));
  await assert.rejects(f.fence.consume(checked.projection as any, id, "reserved"));
  await assert.rejects(f.fence.consume(checked.fact, "f".repeat(64), "reserved"));
  await assert.rejects(f.fence.consume(checked.fact, id, "exposed"));
  f.advance(7); await assert.rejects(f.fence.consume(checked.fact, id, "reserved"));
  await assert.rejects(f.fence.check({ operationId: id } as any, "reserved"));
});
test("reserved observation cannot cross risk mutation and exposed exact self hold can be freshly checked", async t => {
  const f = await setup(t), id = f.record.operationId, result = await f.fence.check(id, "reserved"); assert.ok(result.fact);
  await f.journal.markSignatureRisk(id); await assert.rejects(f.fence.consume(result.fact, id, "reserved"));
  assert.equal((await f.fence.check(id, "exposed")).projection.outcome, "checked");
});
test("exact own exposed hold does not exclude a foreign direct-transfer conflict", async t => {
  const f = await setup(t), id = f.record.operationId;
  await f.journal.markSignatureRisk(id);
  t.mock.method(StateStore.prototype, "listOperations", async () => [{ operationId: "e".repeat(64),
    state: "unknown_finality", terminal: false, chainId: 43114, walletAddress: f.record.material.wallet.account }] as never);
  const result = await f.fence.check(id, "exposed");
  assert.equal(result.projection.outcome, "hold"); assert.equal(result.fact, null); assert.equal(f.batches.length, 0);
});
for (const stage of ["before", "after"] as const) test(`whole signing fence deadline covers gated ${stage} metadata without late fact`, async t => {
  const f = await setup(t), id = f.record.operationId;
  let release!: () => void, entered!: () => void, drained!: () => void;
  const gate = new Promise<void>(r => { release = r; }), gated = new Promise<void>(r => { entered = r; }), drain = new Promise<void>(r => { drained = r; });
  const original = StateStore.prototype.loadWalletArtifacts;
  const originalLocks = StateStore.prototype.withLocks;
  let ownedLockCompletion: Promise<unknown> | undefined;
  t.mock.method(StateStore.prototype, "withLocks", function(this: StateStore, ...args: Parameters<typeof originalLocks>) {
    const completed = originalLocks.apply(this, args);
    if (args[0].includes(`operation:${id}`)) ownedLockCompletion = completed;
    return completed;
  });
  let gateNext = stage === "before";
  if (stage === "after") f.wire.beforeBatch = async calls => {
    if (calls.some(c => c.method === "eth_getBlockByNumber" && c.params[0] !== "finalized")) gateNext = true;
  };
  t.mock.method(StateStore.prototype, "loadWalletArtifacts", async function(this: StateStore, ...args: Parameters<typeof original>) {
    if (gateNext) { gateNext = false; entered(); await gate; try { return await original.apply(this, args); } finally { drained(); } }
    return original.apply(this, args);
  });
  // Capture only the original shared deadline; real provider pacing timers must keep running.
  const timer = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  t.mock.method(globalThis, "setTimeout", (callback: () => void, milliseconds: number, ...args: unknown[]) => {
    if (milliseconds === 20_000 && expire === undefined) expire = callback;
    return timer(callback, milliseconds, ...args);
  });
  let returned: Awaited<ReturnType<typeof f.fence.check>> | undefined;
  const pending = f.fence.check(id, "reserved").then(r => { returned = r; return r; }); await gated;
  const batchesAtDeadline = f.batches.length; assert.ok(expire); expire();
  for (let i = 0; i < 8; i++) await new Promise<void>(r => setImmediate(r));
  const heldWhileGated = returned?.projection.outcome === "hold";
  release(); const result = await pending; await drain; await ownedLockCompletion;
  await new Promise<void>(r => setImmediate(r));
  assert.equal(heldWhileGated, true); assert.equal(result.fact, null); assert.equal(f.batches.length, batchesAtDeadline);
  if (stage === "before") assert.equal(f.batches.length, 0);
});
