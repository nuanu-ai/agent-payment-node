import assert from "node:assert/strict";
import test from "node:test";
import { StateStore } from "../../src/state.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { MacosAdvisoryLock } from "../../src/macos-advisory-lock.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { allowlistDecisionFingerprint } from "../../src/allowlist-policy.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { walletCustodyLock } from "../../src/encrypted-wallet-store.js";
import { evmAddressLock } from "../../src/evm-address-ownership.js";
import { Permit2ProductionSigningFence, type Permit2MetadataLockScope, type Permit2SigningFact } from "../../src/x402-permit2/production-signing-fence.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
import { Permit2ProductionRepository, productionUsageIdentity, type Permit2ProductionRecord } from "../../src/x402-permit2/production-repository.js";
import { Permit2MetadataLockOwner } from "../../src/x402-permit2/production-signing-scope.js";
class OperationWriter extends Permit2ProductionRepository { async rewrite(record: Permit2ProductionRecord) { await this.persistExposureLocked(record); } }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
function trackOwnerDrain(t: test.TestContext) {
  const original = Permit2MetadataLockOwner.prototype.owner, finished = deferred(); let next = false;
  t.mock.method(Permit2MetadataLockOwner.prototype, "owner", async function(this: Permit2MetadataLockOwner, ...args: Parameters<typeof original>) {
    const tracked = next; next = false;
    try { return await original.apply(this, args); } finally { if (tracked) finished.resolve(); }
  });
  return { arm: () => { next = true; }, finished: finished.promise };
}
async function setup(t: test.TestContext, sponsor = false) {
  const f = await journalFixture(t, sponsor);
  (f.input as { mode: string }).mode = "expired_unused"; f.wire.finalized.timestamp = `0x${protocolSecond.toString(16)}`;
  await f.journal.markSignatureRisk(f.record.operationId);
  const fence = new Permit2ProductionSigningFence(f.root, f.input.rpcUrl, f.now);
  return { ...f, fence, id: f.record.operationId };
}
for (const sponsor of [false, true]) test(`actual scoped ${sponsor ? "sponsored" : "allowance"} fence takes each outer key once and consumes privately`, async t => {
  const f = await setup(t, sponsor), keys: string[] = [];
  const original = (SecureStateStore.prototype as any).beforeLockAcquire;
  t.mock.method(SecureStateStore.prototype as any, "beforeLockAcquire", async function(this: SecureStateStore, key: string) {
    keys.push(key); await original.call(this, key);
  });
  const saved = await f.journal.findOperation(f.id), lease = await f.lease();
  await f.fence.withScope(f.id, "exposed", async scope => {
    const checked = await f.fence.checkScoped(scope, f.id, "exposed"); assert.ok(checked.fact);
    assert.equal(checked.projection.rpc.physicalDispatches, 4); assert.equal(checked.projection.rpc.logicalReads, sponsor ? 12 : 11);
    await assert.rejects(f.fence.consume(checked.fact, f.id, "exposed"));
    assert.equal((await f.fence.consumeScoped(scope, checked.fact, f.id, "exposed")).outcome, "checked");
    await assert.rejects(f.fence.consumeScoped(scope, checked.fact, f.id, "exposed"));
    assert.equal(JSON.stringify(scope), '{"kind":"permit2-metadata-lock-scope"}');
  });
  const outer = [`profile:${f.record.profileHash}`, `operation:${f.id}`, evmAddressLock(f.record.material.wallet.account),
    walletCustodyLock(f.state, "owner"), `profile:${allowlistProfileHash("owner")}`];
  for (const key of outer) assert.equal(keys.filter(k => k === key).length, 1, key);
  assert.deepEqual(await f.journal.findOperation(f.id), saved); assert.deepEqual(await f.lease(), lease);
});
test("raw, cloned, serialized, foreign-instance and retained contexts/facts cannot bypass active locks", async t => {
  const f = await setup(t), other = new Permit2ProductionSigningFence(f.root, f.input.rpcUrl, f.now);
  const foreignRoot = new Permit2ProductionSigningFence(`${f.root}/unrelated`, f.input.rpcUrl, f.now);
  let retained!: Permit2MetadataLockScope, fact!: Permit2SigningFact;
  await assert.rejects(f.fence.checkScoped({ kind: "permit2-metadata-lock-scope" }, f.id, "exposed"));
  await f.fence.withScope(f.id, "exposed", async scope => {
    retained = scope;
    for (const clone of [{ ...scope }, JSON.parse(JSON.stringify(scope))]) await assert.rejects(f.fence.checkScoped(clone, f.id, "exposed"));
    await assert.rejects(other.checkScoped(scope, f.id, "exposed"));
    await assert.rejects(foreignRoot.checkScoped(scope, f.id, "exposed"));
    await assert.rejects(f.fence.checkScoped(scope, "e".repeat(64), "exposed"));
    await assert.rejects(f.fence.checkScoped(scope, f.id, "reserved"));
    const checked = await f.fence.checkScoped(scope, f.id, "exposed"); assert.ok(checked.fact); fact = checked.fact;
  });
  await assert.rejects(f.fence.checkScoped(retained, f.id, "exposed"));
  await assert.rejects(f.fence.consumeScoped(retained, fact, f.id, "exposed"));
  await assert.rejects(f.fence.consume(fact, f.id, "exposed"));
  await f.fence.withScope(f.id, "exposed", async scope => {
    await assert.rejects(f.fence.consumeScoped(scope, fact, f.id, "exposed"));
  });
  await assert.rejects(f.fence.withScope("e".repeat(64), "exposed", async () => assert.fail("missing operation admitted")));
});
test("actual competing wallet, operation, custody and allowlist writes wait for scope exit", async t => {
  const f = await setup(t), entered = deferred(), release = deferred();
  const policy = await new AllowlistPolicyStore(f.root).read("owner"), head = policy.entries.at(-1)!, staged = policy.records.at(-1)!;
  const kinds = ["wallet", "operation", "custody", "allowlist"] as const, ran = new Set<string>();
  const busy = kinds.map(() => deferred()), real = new MacosAdvisoryLock();
  const ports = kinds.map((_kind, i) => ({ tryAcquire: async (...args: Parameters<typeof real.tryAcquire>) => {
    const acquired = await real.tryAcquire(...args); if (!acquired) busy[i]!.resolve(); return acquired;
  } }));
  const stores = ports.map(lockPort => new StateStore(f.root, { lockPort }));
  const locked = f.fence.withScope(f.id, "exposed", async () => { entered.resolve(); await release.promise; assert.equal(ran.size, 0); });
  await entered.promise;
  const writes = kinds.map((kind, i) => {
    if (kind === "allowlist") {
      const store = new AllowlistPolicyStore(f.root, { lockPort: ports[i]! });
      const approvalFingerprint = allowlistDecisionFingerprint({ action: "revoke", profileHash: allowlistProfileHash("owner"),
        revision: staged.revision, stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest, headEntryDigest: head.entryDigest });
      return store.appendDecision("owner", head.entryDigest, { status: "revoked", revision: staged.revision,
        stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest, approvalFingerprint, decidedAt: f.now().toISOString() })
        .then(() => { ran.add(kind); });
    }
    const state = stores[i]!, key = kind === "wallet" ? `profile:${f.record.profileHash}` : kind === "operation" ? `operation:${f.id}` :
      kind === "custody" ? walletCustodyLock(state, "owner") : `profile:${allowlistProfileHash("owner")}`;
    const writerKeys = kind === "operation" ? [`profile:${f.record.profileHash}`, key, evmAddressLock(f.record.material.wallet.account)] : [key];
    return state.withLocks(writerKeys, async () => {
      ran.add(kind);
      if (kind === "wallet") { const wallet = await state.loadWallet(f.record.profileHash); assert.ok(wallet); await state.writeWallet(wallet); }
      if (kind === "custody") { const envelope = await state.loadEncryptedWalletEnvelope("owner"); assert.ok(envelope); await state.writeEncryptedWalletEnvelope("owner", envelope); }
      if (kind === "operation") { const record = await f.journal.findOperation(f.id); assert.ok(record); await new OperationWriter(f.root).rewrite(record); }
    });
  });
  await Promise.all(busy.map(b => b.promise)); assert.equal(ran.size, 0); release.resolve(); await locked; await Promise.all(writes);
  assert.equal(ran.size, 4); assert.equal(staged.registry.policyDigest, f.record.material.owner.policyDigest);
});
for (const fault of ["wallet", "lease", "conflict", "clock"] as const) test(`scoped ${fault} drift across RPC denies the fact without broad self exclusion`, async t => {
  const f = await setup(t);
  f.wire.beforeBatch = async calls => {
    if (!calls.some(c => c.method === "eth_getBlockByNumber" && c.params[0] !== "finalized")) return;
    if (fault === "wallet") { const envelope = await f.state.loadEncryptedWalletEnvelope("owner") as any;
      envelope.identity.chainId = 1; await f.state.writeEncryptedWalletEnvelope("owner", envelope); }
    if (fault === "lease") await f.usage.transition({ ...productionUsageIdentity(f.record), reservationId: f.record.usageReservationId,
      policyDigest: f.record.material.owner.policyDigest, state: "finalized", expectedCurrentStates: ["unknown_finality"], outcomeDigest: "d".repeat(64), now: f.now() });
    if (fault === "conflict") t.mock.method(StateStore.prototype, "listOperations", async () => [{ operationId: "f".repeat(64), terminal: false,
      state: "unknown_finality", chainId: 43114, walletAddress: f.record.material.wallet.account }] as never);
    if (fault === "clock") f.advance(60);
  };
  await f.fence.withScope(f.id, "exposed", async scope => assert.equal((await f.fence.checkScoped(scope, f.id, "exposed")).fact, null));
});
test("revoked policy refuses the owned scope before callback admission", async t => {
  const f = await setup(t); await f.revoke();
  await assert.rejects(f.fence.withScope(f.id, "exposed", async () => assert.fail("revoked scope admitted")));
});
test("callback exception invalidates scope and releases real locks", async t => {
  const f = await setup(t); let retained!: Permit2MetadataLockScope;
  await assert.rejects(f.fence.withScope(f.id, "exposed", async scope => { retained = scope; throw new Error("scope failure"); }), /scope failure/u);
  await assert.rejects(f.fence.checkScoped(retained, f.id, "exposed"));
  await f.state.withLocks([`profile:${f.record.profileHash}`, `operation:${f.id}`, evmAddressLock(f.record.material.wallet.account), walletCustodyLock(f.state, "owner")], async () => {});
});
test("detached scoped metadata read cannot mint after callback exit and drains before fixture cleanup", async t => {
  const f = await setup(t), entered = deferred(), release = deferred(), drained = deferred();
  const owner = trackOwnerDrain(t);
  const original = StateStore.prototype.loadWalletArtifacts; let armed = false;
  t.mock.method(StateStore.prototype, "loadWalletArtifacts", async function(this: StateStore, ...args: Parameters<typeof original>) {
    if (armed) { armed = false; entered.resolve(); await release.promise; try { return await original.apply(this, args); } finally { drained.resolve(); } }
    return original.apply(this, args);
  });
  let pending!: ReturnType<typeof f.fence.checkScoped>, retained!: Permit2MetadataLockScope;
  await f.fence.withScope(f.id, "exposed", async scope => { retained = scope; armed = true; owner.arm(); pending = f.fence.checkScoped(scope, f.id, "exposed"); await entered.promise; });
  const held = await pending; assert.equal(held.fact, null); assert.equal(f.batches.length, 0);
  release.resolve(); await drained.promise; await owner.finished; await new Promise<void>(r => setImmediate(r));
  await assert.rejects(f.fence.checkScoped(retained, f.id, "exposed")); assert.equal(f.batches.length, 0);
});
test("original scoped read deadline returns HOLD while metadata is gated and callback exit releases locks", async t => {
  const f = await setup(t), entered = deferred(), release = deferred(), drained = deferred();
  const owner = trackOwnerDrain(t);
  const original = StateStore.prototype.loadWalletArtifacts; let armed = false, expire: (() => void) | undefined;
  t.mock.method(StateStore.prototype, "loadWalletArtifacts", async function(this: StateStore, ...args: Parameters<typeof original>) {
    if (armed) { armed = false; entered.resolve(); await release.promise; try { return await original.apply(this, args); } finally { drained.resolve(); } }
    return original.apply(this, args);
  });
  const timer = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback: () => void, milliseconds: number, ...args: unknown[]) => {
    if (milliseconds === 20_000 && expire === undefined) expire = callback;
    return timer(callback, milliseconds, ...args);
  });
  await f.fence.withScope(f.id, "exposed", async scope => {
    armed = true; owner.arm(); const pending = f.fence.checkScoped(scope, f.id, "exposed"); await entered.promise; assert.ok(expire); expire();
    assert.equal((await pending).fact, null); assert.equal(f.batches.length, 0);
  });
  await f.state.withLocks([walletCustodyLock(f.state, "owner"), `operation:${f.id}`], async () => {});
  release.resolve(); await drained.promise; await owner.finished; await new Promise<void>(r => setImmediate(r)); assert.equal(f.batches.length, 0);
});
