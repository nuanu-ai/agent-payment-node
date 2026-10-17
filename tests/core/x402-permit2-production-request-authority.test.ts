import assert from "node:assert/strict";
import test from "node:test";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { walletCustodyLock } from "../../src/encrypted-wallet-store.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { permit2ApprovalDisplay, TtyPermit2ForegroundApproval, type Permit2ApprovalPurpose } from "../../src/x402-permit2/production-approval.js";
import type { Permit2HttpAttempt, Permit2ProductionHttps } from "../../src/x402-permit2/production-http.js";
import { reconstructPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { productionApprovalFingerprint } from "../../src/x402-permit2/production-journal-codec.js";
import { Permit2ProductionJournal } from "../../src/x402-permit2/production-journal.js";
import { productionUsageIdentity } from "../../src/x402-permit2/production-repository.js";
import { sendPermit2Production } from "../../src/x402-permit2/production-send.js";
import { Permit2ProductionSigningFence, type Permit2MetadataLockScope } from "../../src/x402-permit2/production-signing-fence.js";
import type { HttpObservation } from "../../src/x402-model.js";
import { paidHttpFixture } from "./x402-permit2-production-http-fixture.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";

/** A transport that records what one admitted attempt would send; it never opens a socket. */
function recordingHttps() {
  const sent: string[] = [];
  const https = { submit: async (attempt: Permit2HttpAttempt) => {
    attempt.assertCurrent(); await attempt.owner(); attempt.step("construct"); attempt.step("end");
    sent.push(attempt.record.exposureJournal!.signed!.paymentSignatureHeader);
    return { status: 200, rawHeaderPairs: [], bodyBytes: Buffer.alloc(0) } as unknown as HttpObservation;
  } } as unknown as Permit2ProductionHttps;
  return { sent, https };
}
async function setup(t: test.TestContext, purpose: Permit2ApprovalPurpose = "sign-and-submit-once", sponsor = false) {
  const f = await paidHttpFixture(t, purpose, sponsor), transport = recordingHttps();
  return { ...f, sent: transport.sent, attempt: () => f.send(transport.https) };
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
for (const sponsor of [false, true]) test(`paid UI and actual ${sponsor ? "sponsored" : "allowance"} crypto write one durable request marker and send once, without key or RPC`, async t => {
  const f = await setup(t, "sign-and-submit-once", sponsor), before = { keys: f.keys(), signatures: f.signatures(), batches: f.batches.length };
  assert.equal(f.display().purpose, "sign-and-submit-once"); assert.equal(f.display().payTo, reconstructPermit2ProductionMaterial(f.record.material).payTo);
  t.mock.method(f.native, "request", async () => { throw new Error("No generic request or reentrant custody"); });
  const outcomes = await Promise.all([f.attempt(), f.attempt()]);
  assert.deepEqual(outcomes.map(o => o.outcome?.kind ?? null).sort(), [null, "observed"]);
  const saved = (await f.records.findOperation(f.id))!, j = saved.exposureJournal!;
  assert.equal(saved.state, "request_pending"); assert.deepEqual(j.request, { attempt: 1, requestHash: saved.material.checked.requestHash, headerHash: j.signed!.headerHash });
  assert.deepEqual(f.sent, [j.signed!.paymentSignatureHeader], "exactly one attempt sends the saved header");
  assert.equal((await f.lease()).state, "unknown_finality");
  assert.deepEqual({ keys: f.keys(), signatures: f.signatures(), batches: f.batches.length }, before);
  for (const secret of [j.signed!.paymentSignatureHeader, j.signed!.permit2Signature, saved.material.checked.request.url]) assert.equal(JSON.stringify(outcomes).includes(secret), false);
  assert.equal((await f.attempt()).outcome, null); assert.equal(f.sent.length, 1);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1);
});
test("a sign-only approval refuses the request before the marker while preserving signed held risk", async t => {
  const f = await setup(t, "sign-only"), batches = f.batches.length, keys = f.keys();
  await assert.rejects(f.attempt()); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
  assert.equal((await f.lease()).state, "unknown_finality"); assert.equal(f.batches.length, batches); assert.equal(f.keys(), keys); assert.equal(f.sent.length, 0);
});
test("an origin naming another bundle, lease, wallet or operation, or another state, never marks or sends; a public marker sends nothing", async t => {
  const f = await setup(t), origin = f.signed.origin, other = "f".repeat(64), { https } = recordingHttps();
  for (const changed of [{ ...origin, signedHash: other }, { ...origin, leaseDigest: other }, { ...origin, walletHash: other },
    { ...origin, approval: { ...origin.approval, operationId: other } }, { ...origin, approval: { ...origin.approval, purpose: "sign-only" as const } }])
    await assert.rejects(sendPermit2Production(f.journal, f.fence, changed, f.now, https));
  await assert.rejects(sendPermit2Production(f.journal, new Permit2ProductionSigningFence(`${f.root}/other`, f.input.rpcUrl, f.now), origin, f.now, https));
  await assert.rejects(sendPermit2Production({ root: `${f.root}/other` } as Permit2ProductionJournal, f.fence, origin, f.now, https));
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
  const ordinary = await f.journal.markRequestPending(f.id); assert.equal(ordinary.exposureJournal!.request!.attempt, 1);
  assert.equal((await f.attempt()).outcome, null); assert.equal(f.sent.length, 0);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1);
});
for (const fault of ["policy", "lease"] as const) test(`dispatch ${fault} drift refuses the marker and sends nothing`, async t => {
  const f = await setup(t), batches = f.batches.length, keys = f.keys();
  if (fault === "policy") await f.revoke();
  else await f.usage.transition({ ...productionUsageIdentity(f.record), reservationId: f.record.usageReservationId,
    policyDigest: f.record.material.owner.policyDigest, state: "finalized", outcomeDigest: "e".repeat(64), expectedCurrentStates: ["unknown_finality"], now: f.now() });
  await assert.rejects(f.attempt()); await assert.rejects(f.attempt()); assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null);
  assert.equal(f.batches.length, batches); assert.equal(f.keys(), keys); assert.equal(f.sent.length, 0);
});
test("expiry during the actual first-marker write keeps durable attempt 1 and the common hold but sends nothing", async t => {
  const f = await setup(t), original = (SecureStateStore.prototype as any).writeJson; let writes = 0;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...rest: any[]) {
    const result = await original.call(this, path, value, ...rest);
    if (value?.exposureJournal?.request != null) { writes++; f.advance(63); } return result;
  });
  await assert.rejects(f.attempt()); await assert.rejects(f.attempt()); assert.equal(writes, 1); assert.equal(f.sent.length, 0);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1); assert.equal((await f.lease()).state, "unknown_finality");
});
test("reflected journal helpers cannot fake first-marker persistence or its actual low-level failure", async t => {
  const f = await setup(t); let reflected = 0;
  for (const key of ["required", "locks", "lease", "save", "persistExposureLocked", "markRequestPending", "findOperation"])
    (f.journal as any)[key] = async () => { reflected++; return f.record; };
  assert.equal((await f.attempt()).outcome?.kind, "observed"); assert.equal(reflected, 0); assert.equal(f.sent.length, 1);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request!.attempt, 1);
});
test("a real first-marker store failure sends nothing and leaves the signed hold without a marker", async t => {
  const f = await setup(t), original = (SecureStateStore.prototype as any).writeJson; let writes = 0;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...rest: any[]) {
    if (value?.exposureJournal?.request != null) { writes++; throw new Error("Synthetic marker write failure"); }
    return original.call(this, path, value, ...rest);
  });
  // No marker was written, so a retry inside the approval window may try to write it again; nothing is ever sent.
  await assert.rejects(f.attempt()); await assert.rejects(f.attempt()); assert.equal(writes, 2); assert.equal(f.sent.length, 0);
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null); assert.equal((await f.lease()).state, "unknown_finality");
});
test("the dispatch scope reads signed metadata only: no exposed-crypto observation, no use after exit, no second signature", async t => {
  const f = await setup(t); let retained: Permit2MetadataLockScope | undefined;
  await f.fence.withScope(f.id, "dispatch", async scope => {
    retained = scope; const owned = await f.fence.scopeOwner(scope, f.id, "dispatch");
    assert.ok(owned.record.exposureJournal!.signed);
    await assert.rejects(f.fence.checkScoped(scope, f.id, "exposed"));
    await assert.rejects(f.fence.scopeOwner(scope, f.id, "exposed"));
  });
  await assert.rejects(f.fence.scopeOwner(retained!, f.id, "dispatch"));
  const approval = f.signed.origin.approval, saved = (await f.records.findOperation(f.id))!;
  await assert.rejects(LocalWalletNative.signPermit2Production(f.native, f.fence, f.journal,
    { approval, saved: { recordHash: saved.integrityHash, leaseDigest: f.signed.origin.leaseDigest, walletHash: f.signed.origin.walletHash } }, f.now));
  await f.state.withLocks([walletCustodyLock(f.state, "owner")], async () => {}); assert.equal((await f.attempt()).outcome?.kind, "observed");
});
test("an expired paid approval refuses the marker and keeps the signed hold", async t => {
  const f = await setup(t); f.advance(63); await assert.rejects(f.attempt());
  assert.equal((await f.records.findOperation(f.id))!.exposureJournal!.request, null); assert.equal(f.sent.length, 0);
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
