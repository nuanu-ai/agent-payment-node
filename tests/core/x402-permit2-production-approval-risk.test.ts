import assert from "node:assert/strict";
import test from "node:test";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { InheritedNativeIpc } from "../../src/native-ipc.js";
import { StateStore } from "../../src/state.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { Permit2ProductionJournal } from "../../src/x402-permit2/production-journal.js";
import { Permit2ApprovalRiskCoordinator } from "../../src/x402-permit2/production-approval-risk.js";
import { Permit2ForegroundApprovalAuthority, type Permit2ForegroundApprovalProof } from "../../src/x402-permit2/production-approval-provenance.js";
import { TtyPermit2ForegroundApproval, permit2ApprovalDisplay, type Permit2ApprovalDisplay } from "../../src/x402-permit2/production-approval.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function setup(t: test.TestContext, sponsor = false) {
  const f = await journalFixture(t, sponsor); (f.input as { mode: string }).mode = "expired_unused";
  f.wire.finalized.timestamp = `0x${protocolSecond.toString(16)}`;
  let keyCalls = 0;
  const native = new LocalWalletNative(f.state, { load: async () => { keyCalls++; throw new Error("No key access"); }, create: async () => { keyCalls++; throw new Error("No key creation"); } });
  const capability = LocalWalletNative.resolvePermit2LocalCapability(native, f.root);
  const authority = (approve: (display: Permit2ApprovalDisplay) => Promise<void> = async () => {}) =>
    new Permit2ForegroundApprovalAuthority(f.journal, Object.freeze({}), native, capability, { approve }, f.now);
  return { ...f, native, capability, authority, keyCalls: () => keyCalls };
}
for (const sponsor of [false, true]) test(`owned ${sponsor ? "sponsored" : "allowance"} foreground flow issues only an unconsumed no-key continuation`, async t => {
  const f = await setup(t, sponsor), displays: Permit2ApprovalDisplay[] = [];
  const coordinator = new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, f.native, f.preparation, f.now,
    { approve: async display => { displays.push(display); assert.equal((await f.lease()).state, "reserved"); } });
  const result = await coordinator.run(f.record.operationId);
  assert.equal(displays.length, 1); assert.ok(result.continuation);
  assert.deepEqual(result.continuation, { kind: "permit2-private-signing-continuation" });
  assert.equal(result.status.lifecycle, "exposed_held"); assert.equal(result.status.observeOnly, true);
  assert.equal((await f.lease()).state, "unknown_finality"); assert.notEqual((await f.lease()).reservationDigest, f.reserved.usageReservationDigest);
  assert.equal(f.keyCalls(), 0); const requests = f.batches.length;
  const replay = await coordinator.run(f.record.operationId); assert.equal(replay.continuation, null);
  assert.equal(displays.length, 1); assert.equal(f.batches.length, requests);
  for (const secret of [f.permit2Signature, f.signed.paymentSignatureHeader, f.record.material.checked.request.url, "bodyBase64"])
    assert.equal(JSON.stringify({ result, displays }).includes(secret), false);
  assert.equal(Object.isFrozen(displays[0]), true);
});
test("selected IPC, prototype fake, raw or clone native capability cannot begin approval or risk", async t => {
  const f = await setup(t); let ui = 0; const approval = { approve: async () => { ui++; } };
  for (const native of [new InheritedNativeIpc(3, 4), Object.create(LocalWalletNative.prototype), { request: async () => ({}) }])
    assert.throws(() => new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, native, f.preparation, f.now, approval));
  assert.throws(() => new Permit2ForegroundApprovalAuthority(f.journal, {}, f.native, { ...f.capability }, approval, f.now));
  assert.throws(() => LocalWalletNative.resolvePermit2LocalCapability(f.native, `${f.root}/other`));
  (f.native as any).state = new StateStore(`${f.root}/foreign`);
  assert.equal(LocalWalletNative.resolvePermit2LocalCapability(f.native, f.root), f.capability); // Actual enrolled state, not reflected property.
  assert.equal(ui, 0); assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureAt, null); assert.equal(f.keyCalls(), 0);
});
test("refused foreground and concrete non-TTY approval leave reserved operation untouched", async t => {
  const f = await setup(t);
  const coordinator = new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, f.native, f.preparation, f.now,
    { approve: async () => { throw new Error("refused"); } });
  await assert.rejects(coordinator.run(f.record.operationId));
  const terminal = { fd: 9, write: async () => {}, read: async function* () {}, close: async () => {} };
  const dateMock = t.mock.method(Date, "now", () => f.now().getTime());
  await assert.rejects(new TtyPermit2ForegroundApproval({ openTerminal: async () => terminal, isTerminal: () => false }).approve(permit2ApprovalDisplay(f.reserved)),
    (error: any) => error.details?.nativeCode === "APN_TTY_UNAVAILABLE"); dateMock.mock.restore();
  assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureAt, null); assert.equal((await f.lease()).state, "reserved");
  assert.equal(f.batches.length, 0); assert.equal(f.keyCalls(), 0);
});
test("atomic first successful write under racing genuine approvals emits exactly one continuation", async t => {
  const f = await setup(t), id = f.record.operationId;
  const proofs = await Promise.all([f.authority().approveOwned(id), f.authority().approveOwned(id)]);
  const outcomes = await Promise.all(proofs.map(proof => f.journal.markApprovedSignatureRisk(id, proof)));
  assert.equal(outcomes.filter(r => r.continuation !== null).length, 1); assert.deepEqual(outcomes[0]!.record, outcomes[1]!.record);
  assert.equal((await f.lease()).state, "unknown_finality"); assert.equal(f.keyCalls(), 0);
});
test("raw/cloned/serialized/cross-journal/op UI proofs cannot substitute atomic first-write provenance", async t => {
  const f = await setup(t), id = f.record.operationId, proof = await f.authority().approveOwned(id);
  for (const invalid of [{ kind: proof.kind }, { ...proof }, JSON.parse(JSON.stringify(proof))] as Permit2ForegroundApprovalProof[])
    await assert.rejects(f.journal.markApprovedSignatureRisk(id, invalid));
  const foreignProof = await f.authority().approveOwned(id);
  await assert.rejects(new Permit2ProductionJournal(f.root, f.preparation, f.now).markApprovedSignatureRisk(id, foreignProof));
  const wrongOperationProof = await f.authority().approveOwned(id);
  await assert.rejects(f.journal.markApprovedSignatureRisk("f".repeat(64), wrongOperationProof));
  assert.equal((await f.journal.findOperation(id))!.exposureAt, null);
  const valid = await f.journal.markApprovedSignatureRisk(id, proof); assert.ok(valid.continuation);
  assert.equal((await f.journal.markApprovedSignatureRisk(id, proof)).continuation, null);
  assert.equal(Object.getOwnPropertyNames(f.journal).includes("riskCandidates"), false);
});
for (const phase of ["risk_write", "ledger", "hold_write", "lease_read"] as const) test(`failed ${phase} cannot issue a continuation and repair never recovers authority`, async t => {
  const f = await setup(t), id = f.record.operationId, proof = await f.authority().approveOwned(id);
  const undo: Array<() => void> = [];
  if (phase === "risk_write" || phase === "hold_write") {
    const original = (SecureStateStore.prototype as any).writeJson;
    const mock = t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, record: any, ...rest: any[]) {
      if (record?.exposureJournal && record.exposureJournal.holdConfirmed === (phase === "hold_write")) throw new Error(phase);
      return original.call(this, path, record, ...rest);
    }); undo.push(() => mock.mock.restore());
  } else if (phase === "ledger") {
    const mock = t.mock.method(AssetUsageLedger.prototype, "transition", async () => { throw new Error("ledger"); }); undo.push(() => mock.mock.restore());
  } else {
    const original = AssetUsageLedger.prototype.usageWithReservation; let reads = 0;
    const mock = t.mock.method(AssetUsageLedger.prototype, "usageWithReservation", async function(this: AssetUsageLedger, ...args: Parameters<typeof original>) {
      const result = await original.apply(this, args); if (result.reservation?.state === "unknown_finality" && ++reads >= 1) throw new Error("final lease read"); return result;
    }); undo.push(() => mock.mock.restore());
  }
  await assert.rejects(f.journal.markApprovedSignatureRisk(id, proof)); undo.forEach(fn => fn());
  const saved = (await f.journal.findOperation(id))!;
  if (phase === "risk_write") {
    assert.equal(saved.exposureAt, null); await assert.rejects(f.journal.markApprovedSignatureRisk(id, proof));
  } else {
    assert.notEqual(saved.exposureAt, null); await f.journal.confirmHold(id);
    assert.equal((await f.journal.markApprovedSignatureRisk(id, proof)).continuation, null);
    assert.equal((await f.lease()).state, "unknown_finality");
  }
  assert.equal(f.keyCalls(), 0);
});
for (const fault of ["expired_ui", "rollback", "owner", "window"] as const) test(`post-UI ${fault} denies first-risk authority`, async t => {
  const f = await setup(t), proof = await f.authority().approveOwned(f.record.operationId);
  if (fault === "expired_ui") f.advance(62); else if (fault === "rollback") f.advance(0); else if (fault === "owner") await f.revoke(); else f.advance(120);
  await assert.rejects(f.journal.markApprovedSignatureRisk(f.record.operationId, proof));
  assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureAt, null);
});
test("expiry after risk/hold keeps common hold but emits no continuation", async t => {
  const f = await setup(t), proof = await f.authority().approveOwned(f.record.operationId);
  const original = (SecureStateStore.prototype as any).writeJson;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...rest: any[]) {
    const result = await original.call(this, path, value, ...rest);
    if (value?.exposureJournal?.holdConfirmed === true) f.advance(62); return result;
  });
  await assert.rejects(f.journal.markApprovedSignatureRisk(f.record.operationId, proof));
  assert.equal((await f.lease()).state, "unknown_finality"); assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureJournal!.holdConfirmed, true);
});
test("UI wait is outside actual custody and revoked owner cannot pass the subsequent fence", async t => {
  const f = await setup(t), entered = deferred(), release = deferred();
  const coordinator = new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, f.native, f.preparation, f.now,
    { approve: async () => { entered.resolve(); await release.promise; } });
  const pending = coordinator.run(f.record.operationId); await entered.promise;
  await f.state.writeWallet((await f.state.loadWallet(f.record.profileHash))!); await f.revoke(); release.resolve();
  await assert.rejects(pending); assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureAt, null); assert.equal(f.keyCalls(), 0);
});

test("ordinary public marker and held status repair cannot mint genuine foreground continuation", async t => {
  const f = await setup(t), id = f.record.operationId, proof = await f.authority().approveOwned(id);
  await f.journal.markSignatureRisk(id);
  assert.equal((await f.journal.markApprovedSignatureRisk(id, proof)).continuation, null);
  assert.equal((await f.journal.confirmHold(id)).exposureJournal!.holdConfirmed, true);
  assert.equal((await f.journal.markApprovedSignatureRisk(id, { kind: "permit2-foreground-approval-proof" })).continuation, null);
  assert.equal(f.keyCalls(), 0);
});

test("actual dedicated TTY compares the bound exact code and safely closes before any key access", async t => {
  const f = await setup(t, true); t.mock.method(Date, "now", () => f.now().getTime());
  let closed = 0, text = "";
  const display = permit2ApprovalDisplay(f.reserved);
  const { approvalCode } = await import("../../src/approval-code.js");
  const tty = new TtyPermit2ForegroundApproval({ isTerminal: () => true, openTerminal: async () => ({
    fd: 9, write: async value => { text += value; }, read: async function* () {
      yield Buffer.from(approvalCode("gasless", "x402-permit2-production.v2", display.fingerprint) + "\n");
    }, close: async () => { closed++; },
  }) });
  const proof = await f.authority(d => tty.approve(d)).approveOwned(f.record.operationId);
  assert.equal(closed, 1); assert.equal(text.includes(display.fingerprint), true);
  assert.equal(text.includes(f.record.material.checked.request.url), false); assert.equal(text.includes("Token permit: requested"), true);
  assert.ok((await f.journal.markApprovedSignatureRisk(f.record.operationId, proof)).continuation); assert.equal(f.keyCalls(), 0);
});
test("owned request/material changed during UI fails fingerprint before fresh RPC or risk", async t => {
  const f = await setup(t);
  const { checkPermit2Challenge } = await import("../../src/x402-permit2/checked-challenge.js");
  const { createPermit2ProductionMaterial } = await import("../../src/x402-permit2/production-material.js");
  const { productionRecordBody, sealPermit2ProductionRecord } = await import("../../src/x402-permit2/production-repository.js");
  const { canonicalJson } = await import("../../src/canonical.js"); const { writeFile } = await import("node:fs/promises"); const { join } = await import("node:path");
  const coordinator = new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, f.native, f.preparation, f.now, { approve: async () => {
    const { materialHash: _h, preparedCanonicalJson: _p, typedDataDigest: _t, eip2612Digest: _e, ...source } = f.reserved.material;
    const checked = checkPermit2Challenge(source.checked.challenge, { ...source.checked.request, headers: { "x-fixture": "changed" } });
    const material = createPermit2ProductionMaterial({ ...source, checked });
    const changed = sealPermit2ProductionRecord({ ...productionRecordBody(f.reserved), material });
    await writeFile(join(f.root, "permit2-production", `${f.record.operationId}.json`), canonicalJson(changed));
  } });
  await assert.rejects(coordinator.run(f.record.operationId)); assert.equal(f.batches.length, 0);
  assert.equal((await f.journal.findOperation(f.record.operationId))!.exposureAt, null); assert.equal(f.keyCalls(), 0);
});
test("terminal operation replays remain status-only before foreground UI and transport", async t => {
  const f = await setup(t), id = f.record.operationId; await f.journal.markSignatureRisk(id);
  f.advance(120); f.wire.finalized.timestamp = `0x${(protocolSecond + 120).toString(16)}`;
  const observed = await f.observe("expired_unused"); assert.ok(observed.proof); await f.journal.finalize(id, observed.proof, "expired_unused");
  const batches = f.batches.length; let ui = 0;
  const coordinator = new Permit2ApprovalRiskCoordinator(f.root, f.input.rpcUrl, f.native, f.preparation, f.now, { approve: async () => { ui++; } });
  const result = await coordinator.run(id); assert.equal(result.status.lifecycle, "expired_no_effect"); assert.equal(result.continuation, null);
  assert.equal(f.batches.length, batches); assert.equal(ui, 0); assert.equal(f.keyCalls(), 0);
});

test("approved risk returns immutable owned snapshots while ordinary risk retains its API semantics", async t => {
  const f = await setup(t), id = f.record.operationId;
  const result = await f.journal.markApprovedSignatureRisk(id, await f.authority().approveOwned(id));
  assert.ok(result.continuation);
  function frozen(value: unknown): void {
    if (value !== null && typeof value === "object") {
      assert.equal(Object.isFrozen(value), true);
      for (const child of Object.values(value)) frozen(child);
    }
  }
  frozen(result.record);
  const materialHash = result.record.material.materialHash;
  assert.throws(() => { (result.record.material as any).materialHash = "changed"; }, TypeError);
  assert.throws(() => { (result.record.exposureJournal as any).holdConfirmed = false; }, TypeError);
  assert.equal(result.record.material.materialHash, materialHash);
  const replay = await f.journal.markApprovedSignatureRisk(id, { kind: "permit2-foreground-approval-proof" });
  assert.equal(replay.continuation, null); frozen(replay.record);
  const ordinary = await f.journal.markSignatureRisk(id);
  assert.equal(Object.isFrozen(ordinary), false); assert.equal(f.keyCalls(), 0);
});
