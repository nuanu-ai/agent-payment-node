import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { EncryptedWalletStore, walletCustodyLock } from "../../src/encrypted-wallet-store.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { Permit2ForegroundApprovalAuthority } from "../../src/x402-permit2/production-approval-provenance.js";
import { permit2ApprovalDisplay, TtyPermit2ForegroundApproval, type Permit2ApprovalDisplay, type Permit2ApprovalPurpose } from "../../src/x402-permit2/production-approval.js";
import { reconstructPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { productionApprovalFingerprint } from "../../src/x402-permit2/production-journal-codec.js";
import { Permit2ProductionJournal } from "../../src/x402-permit2/production-journal.js";
import { Permit2ProductionRepository, productionUsageIdentity } from "../../src/x402-permit2/production-repository.js";
import { Permit2ProductionSigningFence } from "../../src/x402-permit2/production-signing-fence.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
async function setup(t: test.TestContext, purpose: Permit2ApprovalPurpose = "sign-and-submit-once", sponsor = false) {
  const f = await journalFixture(t, sponsor, 120); (f.input as { mode: string }).mode = "expired_unused";
  f.wire.finalized.timestamp = `0x${protocolSecond.toString(16)}`;
  let keys = 0, signatures = 0, displayed: Permit2ApprovalDisplay | undefined;
  const wrapping = { load: async () => { keys++; return Buffer.alloc(32, 7); }, create: async () => { throw new Error("No key creation"); } };
  await new EncryptedWalletStore(f.state, wrapping).save({ profile: "owner", address: f.record.material.wallet.account,
    chainId: 8453, createdAt: f.record.createdAt, bindingHash: f.record.material.wallet.bindingHash },
  { version: "apn.wallet-secret.v1", privateKey: `0x${"1".repeat(64)}`, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 7));
  const native = new LocalWalletNative(f.state, wrapping), fence = new Permit2ProductionSigningFence(f.root, f.input.rpcUrl, f.now);
  const capability = LocalWalletNative.resolvePermit2LocalCapability(native, f.root);
  const proof = await new Permit2ForegroundApprovalAuthority(f.journal, {}, native, capability,
    { approve: async d => { displayed = d; } }, f.now).approveOwned(f.record.operationId, purpose);
  const approved = await f.journal.markApprovedSignatureRisk(f.record.operationId, proof); assert.ok(approved.continuation);
  const originalSign = secp256k1.sign;
  t.mock.method(secp256k1, "sign", (...args: Parameters<typeof originalSign>) => { signatures++; return originalSign(...args); });
  const signed = await native.signPermit2Production(f.journal, fence, f.record.operationId, approved.continuation);
  const records = new Permit2ProductionRepository(f.root), id = f.record.operationId;
  return { ...f, native, fence, signed, id, records, wrapping, keys: () => keys, signatures: () => signatures,
    display: () => displayed!, begin: () => native.beginPermit2ProductionRequest(f.journal, fence, id, signed.signingOrigin) };
}
test("purpose is visibly disclosed and binds actual display/fingerprint without changing ordinary durable risk semantics", async t => {
  const f = await journalFixture(t), base = productionApprovalFingerprint(f.record);
  const only = permit2ApprovalDisplay(f.record), paid = permit2ApprovalDisplay(f.record, "sign-and-submit-once");
  assert.equal(only.purpose, "sign-only"); assert.equal(paid.purpose, "sign-and-submit-once");
  assert.notEqual(only.displayHash, paid.displayHash); assert.notEqual(only.fingerprint, paid.fingerprint);
  for (const key of ["amountAtomic", "payTo", "requestHash", "headersHash", "bodyHash", "urlHash"] as const) assert.equal(only[key], paid[key]);
  assert.equal(productionApprovalFingerprint(f.record), base);
  assert.throws(() => permit2ApprovalDisplay(f.record, "submit-again" as Permit2ApprovalPurpose));
});
for (const sponsor of [false, true]) test(`genuine paid UI and actual ${sponsor ? "sponsored" : "allowance"} crypto mint only first durable request grant without key/RPC/HTTP`, async t => {
  const f = await setup(t, "sign-and-submit-once", sponsor), before = { keys: f.keys(), signatures: f.signatures(), batches: f.batches.length };
  assert.equal(f.display().purpose, "sign-and-submit-once"); assert.equal(f.display().payTo, reconstructPermit2ProductionMaterial(f.record.material).payTo);
  t.mock.method(f.native, "request", async () => { throw new Error("No generic request or reentrant custody"); });
  const [a, b] = await Promise.allSettled([f.begin(), f.begin()]);
  assert.equal(a.status, "fulfilled"); assert.equal(b.status, "rejected");
  const result = a.value; assert.ok(result.requestGrant); assert.equal(Object.isFrozen(result.requestGrant), true);
  assert.deepEqual(result.requestGrant, { kind: "permit2-native-request-grant" });
  const saved = (await f.records.findOperation(f.id))!, j = saved.exposureJournal!;
  assert.equal(saved.state, "request_pending"); assert.deepEqual(j.request, { attempt: 1, requestHash: saved.material.checked.requestHash, headerHash: j.signed!.headerHash });
  assert.equal((await f.lease()).state, "unknown_finality");
  assert.deepEqual({ keys: f.keys(), signatures: f.signatures(), batches: f.batches.length }, before);
  for (const secret of [j.signed!.paymentSignatureHeader, j.signed!.permit2Signature, saved.material.checked.request.url]) assert.equal(JSON.stringify(result).includes(secret), false);
  await assert.rejects(f.begin()); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1);
});
test("default sign-only origin refuses request before marker while preserving signed held risk", async t => {
  const f = await setup(t, "sign-only"), batches = f.batches.length, keys = f.keys();
  await assert.rejects(f.begin()); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
  assert.equal((await f.lease()).state, "unknown_finality"); assert.equal(f.batches.length, batches); assert.equal(f.keys(), keys);
});
test("wrong native/root/journal/id, clone, raw signature, public marker and fake execution never reconstruct first-request authority", async t => {
  const f = await setup(t), origin = f.signed.signingOrigin;
  for (const candidate of [{ kind: origin.kind }, { ...origin }, JSON.parse(JSON.stringify(origin)),
    (await f.records.findOperation(f.id))!.exposureJournal!.signed!, { attempt: 1, requestHash: f.record.material.checked.requestHash }])
    await assert.rejects(f.native.beginPermit2ProductionRequest(f.journal, f.fence, f.id, candidate as typeof origin));
  const foreign = new LocalWalletNative(f.state, f.wrapping), subclass = new (class extends LocalWalletNative {})(f.state, f.wrapping);
  await assert.rejects(foreign.beginPermit2ProductionRequest(f.journal, f.fence, f.id, origin));
  await assert.rejects(subclass.beginPermit2ProductionRequest(f.journal, f.fence, f.id, origin));
  await assert.rejects(f.native.beginPermit2ProductionRequest(new Permit2ProductionJournal(f.root, f.preparation, f.now), f.fence, f.id, origin));
  await assert.rejects(f.native.beginPermit2ProductionRequest({ root: `${f.root}/other` } as Permit2ProductionJournal, f.fence, f.id, origin));
  await assert.rejects(f.native.beginPermit2ProductionRequest(f.journal, f.fence, "f".repeat(64), origin));
  await assert.rejects(Permit2ProductionJournal.markNativeRequestPending(f.journal, f.id, { kind: "permit2-native-request-execution" }));
  const ordinary = await f.journal.markRequestPending(f.id); assert.equal(ordinary.exposureJournal!.request!.attempt, 1);
  const replay = await f.begin(); assert.equal(replay.requestGrant, null); await assert.rejects(f.begin());
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1);
});
for (const fault of ["policy", "lease"] as const) test(`dispatch ${fault} drift refuses marker and consumes paid origin without recovery grant`, async t => {
  const f = await setup(t), batches = f.batches.length, keys = f.keys();
  if (fault === "policy") await f.revoke();
  else await f.usage.transition({ ...productionUsageIdentity(f.record), reservationId: f.record.usageReservationId,
    policyDigest: f.record.material.owner.policyDigest, state: "finalized", outcomeDigest: "e".repeat(64), expectedCurrentStates: ["unknown_finality"], now: f.now() });
  await assert.rejects(f.begin()); await assert.rejects(f.begin()); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
  assert.equal(f.batches.length, batches); assert.equal(f.keys(), keys);
});
test("expiry during actual first-marker write preserves durable attempt1 and common hold but returns no grant", async t => {
  const f = await setup(t), original = (SecureStateStore.prototype as any).writeJson; let writes = 0;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...rest: any[]) {
    const result = await original.call(this, path, value, ...rest);
    if (value?.exposureJournal?.request != null) { writes++; f.advance(63); } return result;
  });
  await assert.rejects(f.begin()); await assert.rejects(f.begin()); assert.equal(writes, 1);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1); assert.equal((await f.lease()).state, "unknown_finality");
});
test("reflected journal helpers cannot fake native first-marker persistence or its actual low-level failure", async t => {
  const f = await setup(t); let reflected = 0;
  for (const key of ["required", "locks", "lease", "save", "persistExposureLocked", "markRequestPending", "findOperation"])
    (f.journal as any)[key] = async () => { reflected++; return f.record; };
  const result = await f.begin(); assert.ok(result.requestGrant); assert.equal(reflected, 0);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1);
});
test("real first-marker store failure consumes origin and remains signed/held with no public-marker recovery authority", async t => {
  const f = await setup(t), original = (SecureStateStore.prototype as any).writeJson; let writes = 0;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...rest: any[]) {
    if (value?.exposureJournal?.request != null) { writes++; throw new Error("Synthetic marker write failure"); }
    return original.call(this, path, value, ...rest);
  });
  await assert.rejects(f.begin()); await assert.rejects(f.begin()); assert.equal(writes, 1);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null); assert.equal((await f.lease()).state, "unknown_finality");
});
test("genuine dispatch scope admits signed metadata but never exposed crypto scope/facts or caller request execution", async t => {
  const f = await setup(t); let retained: unknown;
  await Permit2ProductionSigningFence.withNativeDispatchScope(f.fence, f.root, f.id, async scope => {
    retained = scope; const owned = await Permit2ProductionSigningFence.nativeDispatchScopeOwner(f.fence, scope, f.root, f.id);
    assert.ok(owned.record.exposureJournal!.signed);
    assert.throws(() => Permit2ProductionSigningFence.assertNativeScope(f.fence, scope, f.root, f.id));
    await assert.rejects(Permit2ProductionSigningFence.checkNativeScoped(f.fence, scope, f.root, f.id));
    await assert.rejects(f.fence.checkScoped(scope, f.id, "exposed"));
  });
  await assert.rejects(Permit2ProductionSigningFence.nativeDispatchScopeOwner(f.fence, retained as any, f.root, f.id));
  await assert.rejects(f.native.signPermit2Production(f.journal, f.fence, f.id, { kind: "permit2-private-signing-continuation" }));
  await f.state.withLocks([walletCustodyLock(f.state, "owner")], async () => {}); assert.ok((await f.begin()).requestGrant);
});

test("expired paid origin is consumed before await and cannot revive after private-clock rollback", async t => {
  const f = await setup(t); f.advance(63); await assert.rejects(f.begin()); f.advance(1);
  await assert.rejects(f.begin()); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
  assert.equal((await f.lease()).state, "unknown_finality");
});
test("actual paid-purpose TTY explicitly authorizes one paid request for displayed frozen amount/payee/request", async t => {
  const f = await journalFixture(t), d = permit2ApprovalDisplay(f.reserved, "sign-and-submit-once");
  t.mock.method(Date, "now", () => f.now().getTime()); const { approvalCode } = await import("../../src/approval-code.js");
  let text = "", closed = 0;
  const tty = new TtyPermit2ForegroundApproval({ isTerminal: () => true, openTerminal: async () => ({
    fd: 9, write: async value => { text += value; }, read: async function* () {
      yield Buffer.from(approvalCode("gasless", "x402-permit2-production.v2", d.fingerprint) + "\n");
    }, close: async () => { closed++; },
  }) });
  await tty.approve(d); assert.equal(closed, 1); assert.ok(text.includes("exactly one paid request"));
  for (const value of [d.amountAtomic, d.payTo, d.requestHash, d.displayHash, d.fingerprint]) assert.ok(text.includes(value));
  assert.equal(text.includes(f.record.material.checked.request.url), false);
});
