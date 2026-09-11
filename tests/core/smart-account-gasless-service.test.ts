import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import type { Hex } from "../../src/model.js";
import { OperationService } from "../../src/operation-service.js";
import { capabilityHash, metamaskSmartAccountX402CapabilitySnapshot, PROVIDER_PROFILE_VERSION } from "../../src/provider-profile.js";
import { RuntimeContext } from "../../src/runtime.js";
import { StateStore } from "../../src/state.js";
import { SA_MATERIAL_DOMAINS, saMaterialHash, saRequirementsHash } from "../../src/smart-account-gasless/integrity.js";
import { domainHash } from "../../src/canonical.js";
import type { SmartAccountGaslessRpcObservation, SmartAccountGaslessSealedMaterial } from "../../src/smart-account-gasless/model.js";
import type { SmartAccountGaslessOperationRecord } from "../../src/smart-account-gasless/operation-model.js";
import { SmartAccountGaslessOperationRepository } from "../../src/smart-account-gasless/operation-repository.js";
import type { SmartAccountGaslessApprovalPort, SmartAccountGaslessMaterialPort,
  SmartAccountGaslessObserveInput, SmartAccountGaslessProviderPort, SmartAccountGaslessRpcPort } from "../../src/smart-account-gasless/ports.js";
import { saError } from "../../src/smart-account-gasless/reasons.js";
import { SmartAccountGaslessService } from "../../src/smart-account-gasless/service.js";
import { SA_TEST_AT, saTestIntent } from "./smart-account-gasless-fixtures.js";

const PROFILE = "sa-synthetic", KEY = "service-fixture", TX = `0x${"6".repeat(64)}` as Hex;
const when = (seconds: number) => new Date(Date.parse(SA_TEST_AT) + seconds * 1000);
const hex = (digit: string): Hex => `0x${digit.repeat(64)}`;
const childMode = process.env.APN_SA_TEST_CHILD_STAGE;
type Calls = Record<"inspect" | "supported" | "snapshot" | "unspent" | "seal" | "load" | "expose" | "verify" | "settle" | "observe" | "approval", number>;

/** Lifecycle-only fake ports: no real signature, encrypted custody, RPC or provider is represented by these fixtures. */
async function fixture(root: string, create = true) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const state = new StateStore(root, { lockWaitMs: 1000 }), original = saTestIntent();
  const capability = metamaskSmartAccountX402CapabilitySnapshot(), binding = { ...original.binding, capabilityHash: capabilityHash(capability) };
  const calls: Calls = { inspect: 0, supported: 0, snapshot: 0, unspent: 0, seal: 0, load: 0, expose: 0, verify: 0, settle: 0, observe: 0, approval: 0 };
  const counterPath = join(root, "fixture-counts.json"), materialPath = join(root, "fixture-material.json");
  if (!create) Object.assign(calls, JSON.parse(await readFile(counterPath, "utf8")));
  let now = when(create ? 0 : Number(process.env.APN_SA_TEST_NOW_SECONDS ?? "60")), observation: "pending" | "success" | "unused" = "pending";
  let accepted = true, failInspect = false, failVerify = false, failSettle = false, corruptMaterial = false;
  let materialGone = false, freezeBinding = binding;
  let snapshotChange: "allowance" | "nonce" | "deployment" | null = null;
  let hook: (name: string) => Promise<void> = async () => {};
  const persistCounts = async () => await writeFile(counterPath, canonicalJson(calls), { mode: 0o600 });
  const call = async (name: keyof Calls) => { calls[name]++; await persistCounts(); await hook(name); };
  class Records extends SmartAccountGaslessOperationRepository {
    override async persist(op: SmartAccountGaslessOperationRecord): Promise<void> {
      await this.writeOperation(op); await hook(`operation:${op.state}`);
      await this.repairReceipt(op); await hook(`receipt:${op.state}`);
    }
  }
  const records = new Records(root), clock = { now: () => now };
  if (create) {
    await state.initialize();
    await state.writeProviderProfile({ schema_version: PROVIDER_PROFILE_VERSION, profile: PROFILE, profile_hash: binding.profileHash,
      provider_id: "metamask-smart-account", public_address: binding.ownerAddress, account_binding_hash: binding.accountBindingHash,
      trust_class: "external_owner_delegated_local_session", revision: binding.profileRevision,
      capability_snapshot: capability, capability_hash: binding.capabilityHash, observed_at: SA_TEST_AT, drift: { state: "bound", reason: "none" } });
    await persistCounts();
  }
  const loadMaterial = async (): Promise<SmartAccountGaslessSealedMaterial | null> => {
    if (materialGone) return null;
    try { return JSON.parse(await readFile(materialPath, "utf8")) as SmartAccountGaslessSealedMaterial; }
    catch (error) { if ((error as { code?: string }).code === "ENOENT") return null; throw error; }
  };
  const material: SmartAccountGaslessMaterialPort = {
    inspect: async expected => {
      await call("inspect"); if (failInspect) throw saError("sa_gasless_permission");
      assert.equal(expected.capabilityHash, binding.capabilityHash); return freezeBinding;
    },
    load: async () => { await call("load"); return await loadMaterial(); },
    seal: async op => {
      await call("seal");
      const durable = await records.findOperation(op.operationId);
      assert.equal(durable?.state, "material_pending"); assert.equal(durable?.signingAttempts, 1);
      const payload = { x402Version: 2 as const, accepted: op.intent.requirements, payload: {
        delegationManager: binding.delegationManager, delegator: binding.ownerAddress, permissionContext: "0x1234" as Hex } };
      const hashes = { encodedRootHash: binding.encodedRootHash, encodedChildHash: "1".repeat(64),
        permissionContextHash: domainHash(SA_MATERIAL_DOMAINS.permissionContext, payload.payload.permissionContext),
        payloadHash: domainHash(SA_MATERIAL_DOMAINS.payload, canonicalJson(payload)), requirementsHash: saRequirementsHash(op.intent.requirements),
        rootDelegationHash: binding.rootDelegationHash, childDelegationHash: hex("4") };
      const sealed = { descriptor: { ...hashes, materialHash: saMaterialHash(op.operationId, op.fingerprint, hashes), sealedAt: now.toISOString() },
        paymentPayload: payload, phase: "sealed" as const };
      await writeFile(materialPath, canonicalJson(sealed), { mode: 0o600 }); await hook("seal-written");
      return corruptMaterial ? { ...sealed, descriptor: { ...sealed.descriptor, materialHash: "f".repeat(64) } } : sealed;
    },
    markExposed: async (op, value) => {
      const durable = await records.findOperation(op.operationId); assert.equal(durable?.exposureAttempts, 1);
      const next = { ...value, phase: "exposed" as const }; await writeFile(materialPath, canonicalJson(next), { mode: 0o600 });
      await call("expose"); return next;
    },
  };
  const provider: SmartAccountGaslessProviderPort = {
    supported: async () => { await call("supported"); return { ...original.provider, observedAt: now.toISOString() }; },
    verify: async (op, value) => {
      const durable = await records.findOperation(op.operationId); assert.equal(durable?.state, "exposure_pending");
      assert.equal(durable.exposureAttempts, 1); assert.equal((await loadMaterial())?.phase, "exposed");
      assert.equal(value.phase, "exposed"); await call("verify");
      if (failVerify) throw saError("sa_gasless_verify_rejected");
      return { observedAt: now.toISOString(), payer: binding.ownerAddress, isValid: true, responseHash: "5".repeat(64) };
    },
    settle: async op => {
      const durable = await records.findOperation(op.operationId); assert.equal(durable?.state, "dispatch_pending");
      assert.equal(durable.submissionAttempts, 1); await call("settle");
      if (failSettle) throw new Error("synthetic-secret lost response");
      return { observedAt: now.toISOString(), transactionHash: TX, responseHash: "6".repeat(64) };
    },
  };
  const rpc: SmartAccountGaslessRpcPort = {
    chainId: 8453, endpointHash: original.initialSnapshot.endpointHash, endpointOrigin: original.initialSnapshot.endpointOrigin,
    snapshot: async (current, expectedPreparation) => {
      assert.equal(current.rootNonceAtomic, binding.rootNonceAtomic);
      if (calls.snapshot > 0) assert.deepEqual(expectedPreparation, original.initialSnapshot.preparationBlock);
      await call("snapshot");
      const snapshot = structuredClone(original.initialSnapshot);
      if (snapshotChange === "allowance") (snapshot.safeState as any).availableAtomic = "0";
      if (snapshotChange === "nonce") (snapshot.safeState as any).currentNonceAtomic = "1";
      if (snapshotChange === "deployment") (snapshot.safeState as any).ownerCodeHash = hex("f");
      return { ...snapshot, observedAt: now.toISOString() };
    },
    assertUnspent: async input => { assert.deepEqual(input.safeBlock, original.initialSnapshot.safeBlock); await call("unspent"); },
    observe: async input => { await call("observe"); return proof(input, observation, now); },
  };
  const approval: SmartAccountGaslessApprovalPort = { confirm: async input => {
    assert.equal(input.exactPhrase, `APPROVE GASLESS ${input.operationId} ${input.fingerprint}`);
    assert.equal((input.summary.transfer as any).frozen_fee_atomic, "0"); await call("approval"); return accepted;
  } };
  const context = () => new RuntimeContext({ state, clock, smartAccountGasless: { rpcFor: () => rpc, provider, material, approval, records } });
  const restart = () => new SmartAccountGaslessService(context()), service = restart();
  return { state, service, records, calls, restart, context, material, provider, rpc, binding,
    id: state.operationId(PROFILE, KEY), input: { profile: PROFILE, request: original.request, idempotencyKey: KEY },
    setHook(value: typeof hook) { hook = value; }, setNow(value: Date) { now = value; },
    phase(value: typeof observation) { observation = value; }, refuse() { accepted = false; }, noPermission() { failInspect = true; },
    rejectVerify() { failVerify = true; }, loseSettle() { failSettle = true; }, wrongMaterial() { corruptMaterial = true; },
    loseMaterial() { materialGone = true; }, replaceBinding() { freezeBinding = { ...binding, permissionRevision: binding.permissionRevision + 1 }; },
    changeSnapshot(value: typeof snapshotChange) { snapshotChange = value; },
  };
}
function proof(input: SmartAccountGaslessObserveInput, phase: "pending" | "success" | "unused", now: Date): SmartAccountGaslessRpcObservation {
  const observedAt = now.toISOString(), i = input.intent;
  if (phase === "pending") return { cursor: input.cursor, observation: { observedAt, phase: "pending", reason: "sa_gasless_unknown",
    candidateTxHash: null, evidenceHash: null }, settlement: null, unusedProof: null };
  if (phase === "success") return { cursor: input.cursor,
    observation: { observedAt, phase: "success", reason: null, candidateTxHash: TX, evidenceHash: "7".repeat(64) }, unusedProof: null,
    settlement: { observedAt, source: input.transactionHint === TX ? "provider_hint" : "rpc_discovered", txHash: TX,
      transactionBlock: { numberAtomic: "50000010", hash: hex("8"), timestampAtomic: String(i.afterUnix + 20) },
      finalityBlock: { numberAtomic: "50000020", hash: hex("9"), timestampAtomic: String(i.afterUnix + 40) },
      finality: "safe", outerSender: i.provider.facilitatorAddresses[0]!, transactionProofHash: "a".repeat(64), receiptHash: "b".repeat(64),
      contextHash: input.material.permissionContextHash, protocolHash: "c".repeat(64), rootDelegationHash: input.material.rootDelegationHash,
      childDelegationHash: input.material.childDelegationHash, childSpentAtomic: i.request.grossAtomic,
      debitAtomic: i.request.grossAtomic, deliveredAtomic: i.request.grossAtomic, feeAtomic: "0", refundAtomic: "0", unusedGrossAtomic: "0",
      ownerNativeDebitWei: "0", sessionNativeDebitWei: "0" } };
  const expiry = { numberAtomic: "50000150", hash: hex("a"), timestampAtomic: String(i.beforeUnix) };
  return { cursor: { ...input.cursor, nextBlockAtomic: "50000151", previousEndBlock: expiry, expiryBlock: expiry,
    childScanComplete: true, transferScanComplete: true },
    observation: { observedAt, phase: "expired_unused", reason: null, candidateTxHash: null, evidenceHash: "8".repeat(64) }, settlement: null,
    unusedProof: { observedAt, startBlock: input.cursor.startBlock, expiryBlock: expiry,
      finalityBlock: { numberAtomic: "50000200", hash: hex("b"), timestampAtomic: String(i.beforeUnix + 100) },
      childDelegationHash: input.material.childDelegationHash, childSpentAtomic: "0", childScanHash: "a".repeat(64),
      transferScanHash: "b".repeat(64), anchorsHash: "c".repeat(64), protocolHash: "d".repeat(64) } };
}
async function temporary(t: { after(action: () => Promise<void>): void }) {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-sa-service-"));
  t.after(async () => await rm(root, { recursive: true, force: true })); return root;
}

if (childMode === undefined) {
test("prepare is side-effect free, freezes exact economics, and resolves repeated keys before all current preconditions", async t => {
  const f = await fixture(await temporary(t)), before = await f.state.loadProviderProfile(f.binding.profileHash);
  const prepared = await f.service.prepare(f.input), calls = { ...f.calls };
  assert.equal(prepared.transfer.frozen_net_atomic, "10000"); assert.equal(prepared.transfer.frozen_fee_atomic, "0");
  assert.equal(f.calls.seal + f.calls.verify + f.calls.settle, 0);
  f.noPermission(); f.setNow(when(600));
  assert.deepEqual(await f.restart().prepare(f.input), prepared); assert.deepEqual(f.calls, calls);
  assert.deepEqual(await f.state.loadProviderProfile(f.binding.profileHash), before);
  await assert.rejects(() => f.service.prepare({ ...f.input, request: { ...f.input.request, grossAtomic: "10001" } }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  assert.deepEqual(f.calls, calls);
});
test("approved invocation writes every effect marker before one signature, verify and settle; exposed recovery only observes", async t => {
  const f = await fixture(await temporary(t)); await f.service.prepare(f.input);
  const result = await f.service.approve(f.id);
  assert.equal(result.state, "unknown_finality"); assert.deepEqual([f.calls.approval, f.calls.seal, f.calls.verify, f.calls.settle], [1, 1, 1, 1]);
  assert.equal(f.calls.unspent, 2); assert.equal(result.permission.guard_held, true);
  const effects = { ...f.calls }; f.noPermission(); f.loseMaterial(); f.setNow(when(600)); f.phase("success");
  const done = await f.restart().resume(f.id);
  assert.equal(done.state, "completed"); assert.equal(done.permission.guard_held, false);
  for (const key of Object.keys(effects) as Array<keyof Calls>) if (key !== "observe") assert.equal(f.calls[key], effects[key], key);
  const terminalCalls = { ...f.calls }, receipt = await f.service.receipt(f.id);
  assert.deepEqual(await f.restart().approve(f.id), done); assert.deepEqual(await f.restart().resume(f.id), done);
  assert.deepEqual(await f.service.receipt(f.id), receipt); assert.deepEqual(f.calls, terminalCalls);
});
test("foreground rejection and expiration close before effect; unavailable foreground input remains awaiting", async t => {
  const root = await temporary(t);
  for (const reason of ["rejected", "expired", "missing"] as const) {
    const f = await fixture(join(root, reason)); await f.service.prepare(f.input);
    if (reason === "rejected") f.refuse();
    if (reason === "expired") f.setNow(when(300));
    if (reason === "missing") f.setHook(async name => { if (name === "approval") throw saError("sa_gasless_approval"); });
    if (reason === "missing") {
      await assert.rejects(() => f.service.approve(f.id), { code: "APN_FOREGROUND_APPROVAL_REQUIRED" });
      assert.equal((await f.service.status(f.id)).state, "awaiting_approval");
    } else {
      const result = await f.service.approve(f.id); assert.equal(result.state, "failed_before_effect");
      assert.equal(result.reason, reason === "rejected" ? "sa_gasless_approval_rejected" : "sa_gasless_expired");
    }
    assert.equal(f.calls.seal + f.calls.verify + f.calls.settle, 0);
  }
});
test("verification rejection or lost settlement never proves no effects and never re-posts on resume", async t => {
  const root = await temporary(t);
  for (const which of ["verify", "settle"] as const) {
    const f = await fixture(join(root, which)); await f.service.prepare(f.input);
    if (which === "verify") f.rejectVerify(); else f.loseSettle();
    const unknown = await f.service.approve(f.id);
    assert.equal(unknown.state, "unknown_finality"); assert.equal(unknown.permission.guard_held, true);
    assert.equal(unknown.transfer.actual_sender_debit_atomic, null);
    const attempts = [f.calls.seal, f.calls.verify, f.calls.settle];
    f.setNow(when(600)); f.phase("unused");
    const closed = await f.restart().resume(f.id); assert.equal(closed.state, "expired_unused");
    assert.deepEqual([f.calls.seal, f.calls.verify, f.calls.settle], attempts);
    assert.equal(JSON.stringify(closed).includes("synthetic-secret"), false);
  }
});
test("authority, expiry, clock and spent-map changes at awaited boundaries prevent the next external effect", async t => {
  const root = await temporary(t);
  for (const change of ["before-sign", "before-exposure", "after-verify", "expired-seal", "rollback", "spent"] as const) {
    const f = await fixture(join(root, change)); await f.service.prepare(f.input);
    f.setHook(async name => {
      if (change === "before-sign" && name === "approval") f.replaceBinding();
      if (change === "before-exposure" && name === "seal-written") f.replaceBinding();
      if (change === "after-verify" && name === "verify") f.replaceBinding();
      if (change === "expired-seal" && name === "seal") f.setNow(when(301));
      if (change === "rollback" && name === "seal-written") f.setNow(when(-1));
      if (change === "spent" && name === "unspent") throw saError("sa_gasless_evidence");
    });
    const result = await f.service.approve(f.id);
    assert.equal(f.calls.settle, 0, change);
    assert.equal(f.calls.verify, change === "after-verify" ? 1 : 0, change);
    assert.equal(f.calls.seal, change === "before-sign" ? 0 : 1, change);
    assert.notEqual(result.state, "completed");
    if (change === "after-verify") assert.equal(result.permission.guard_held, true);
    if (change === "expired-seal") assert.equal(result.permission.status, "sealed_local");
  }
});
test("every post-verify guard failure suppresses settle and survives fresh-process observation without effects", async t => {
  const root = await temporary(t);
  for (const change of ["spent", "expiry", "rollback", "allowance", "nonce", "deployment"] as const) {
    const stateRoot = join(root, change), f = await fixture(stateRoot); await f.service.prepare(f.input);
    f.setHook(async name => {
      if (name === "operation:verified_pending") {
        if (change === "expiry") f.setNow(when(301));
        if (change === "rollback") f.setNow(when(-1));
        if (change === "allowance" || change === "nonce" || change === "deployment") f.changeSnapshot(change);
      }
      if (change === "spent" && name === "unspent" && f.calls.unspent === 2) throw saError("sa_gasless_evidence");
    });
    const result = await f.service.approve(f.id);
    assert.deepEqual([f.calls.seal, f.calls.expose, f.calls.verify, f.calls.settle], [1, 1, 1, 0], change);
    if (change === "spent") assert.equal(f.calls.unspent, 2);
    if (["allowance", "nonce", "deployment"].includes(change)) assert.equal(f.calls.snapshot, 4);
    assert.equal(result.permission.guard_held, true, change); assert.equal(result.terminal, false, change);
    const before = await f.records.findOperation(f.id); assert.ok(before);
    assert.deepEqual([before.signingAttempts, before.exposureAttempts, before.submissionAttempts], [1, 1, 0]);
    const calls = { ...f.calls }, resumed = await child(stateRoot, "none", "resume", 600);
    assert.equal(resumed.code, 0, resumed.output);
    const afterCalls = JSON.parse(await readFile(join(stateRoot, "fixture-counts.json"), "utf8")) as Calls;
    for (const key of Object.keys(calls) as Array<keyof Calls>) {
      assert.equal(afterCalls[key], calls[key] + (key === "observe" ? 1 : 0), `${change}:${key}`);
    }
    const after = await f.records.findOperation(f.id); assert.ok(after);
    assert.deepEqual([after.signingAttempts, after.exposureAttempts, after.submissionAttempts], [1, 1, 0]);
    assert.equal(after.terminal, false); assert.equal((await f.service.status(f.id)).permission.guard_held, true);
  }
});
test("missing or changed material after its public identity never permits another signature or disclosure", async t => {
  const root = await temporary(t), f = await fixture(root); await f.service.prepare(f.input);
  f.setHook(async name => { if (name === "operation:material_sealed") throw new Error("synthetic crash after operation write"); });
  await assert.rejects(() => f.service.approve(f.id));
  f.setHook(async () => {}); f.loseMaterial();
  await assert.rejects(() => f.restart().resume(f.id), { code: "APN_STATE_CORRUPT" });
  assert.deepEqual([f.calls.seal, f.calls.verify, f.calls.settle], [1, 0, 0]);
  assert.equal((await f.service.status(f.id)).permission.guard_held, true);
});
test("all default OperationService instances see Smart Account idempotency and profile guards", async t => {
  const f = await fixture(await temporary(t)); await f.service.prepare(f.input);
  const operations = new OperationService(f.state);
  assert.equal((await operations.required(f.id)).kind, "smart_account_gasless_transfer");
  for (const kind of ["direct_transfer", "x402_fetch", "rail_transfer", "bridge_route", "gasless_transfer", "metamask_gasless_transfer"] as const) {
    await assert.rejects(() => operations.resolvePrepare({ kind, profileHash: f.binding.profileHash, operationId: f.id,
      idempotencyHash: f.state.idempotencyHash(KEY), requestHash: ("a".repeat(64)) }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  }
  await assert.rejects(() => operations.assertProfileAvailable(f.binding.profileHash), { code: "APN_OPERATION_BLOCKED" });
  const calls = { ...f.calls };
  const both = await Promise.allSettled([f.service.prepare({ ...f.input, idempotencyKey: "another-a" }),
    f.restart().prepare({ ...f.input, idempotencyKey: "another-b" })]);
  assert.equal(both.filter(r => r.status === "fulfilled").length, 0); assert.deepEqual(f.calls, calls);
});
test("fresh-process crash prefixes preserve at-most-once calls and exposed recovery never uses private material", async t => {
  const root = await temporary(t);
  const stages = ["operation:material_pending", "seal", "seal-written", "operation:material_sealed", "operation:exposure_pending",
    "expose", "verify", "operation:verified_pending", "operation:dispatch_pending", "settle", "operation:submitted_pending"];
  for (const [index, stage] of stages.entries()) {
    const stateRoot = join(root, String(index)), f = await fixture(stateRoot); await f.service.prepare(f.input);
    assert.equal((await child(stateRoot, stage, "approve")).code, 42, stage);
    const interrupted = await f.records.findOperation(f.id), before = JSON.parse(await readFile(join(stateRoot, "fixture-counts.json"), "utf8")) as Calls;
    assert.ok(interrupted); const resumed = await child(stateRoot, "none", "resume"); assert.equal(resumed.code, 0, resumed.output);
    const after = JSON.parse(await readFile(join(stateRoot, "fixture-counts.json"), "utf8")) as Calls;
    for (const count of [after.seal, after.verify, after.settle]) assert.ok(count <= 1, `${stage}: ${canonicalJson(after)}`);
    if (interrupted.exposureAttempts === 1) {
      for (const key of ["seal", "load", "inspect", "expose", "verify", "settle", "supported"] as const) assert.equal(after[key], before[key], `${stage}:${key}`);
      assert.equal((await f.records.findOperation(f.id))?.state, "unknown_finality");
    } else if (stage === "operation:material_pending" || stage === "seal") {
      const record = await f.records.findOperation(f.id);
      assert.equal(record?.state, "failed_before_effect"); assert.equal(record?.failure?.reason, "sa_gasless_material_unavailable");
    }
  }
});
}

async function child(root: string, stage: string, action: "approve" | "resume", nowSeconds = 60): Promise<{ code: number | null; output: string }> {
  return await new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [fileURLToPath(import.meta.url)], { env: {
      PATH: process.env.PATH ?? "/usr/bin", APN_SA_TEST_CHILD_STATE: root, APN_SA_TEST_CHILD_STAGE: stage,
      APN_SA_TEST_CHILD_ACTION: action, APN_SA_TEST_NOW_SECONDS: String(nowSeconds) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; processChild.stdout.on("data", value => { output += String(value); });
    processChild.stderr.on("data", value => { output += String(value); }); processChild.once("error", reject);
    processChild.once("close", code => resolve({ code, output }));
  });
}
if (childMode !== undefined) {
  const root = process.env.APN_SA_TEST_CHILD_STATE;
  if (root === undefined) throw new Error("Synthetic child state missing.");
  const f = await fixture(root, false);
  f.setHook(async name => { if (name === childMode) process.exit(42); });
  const result = process.env.APN_SA_TEST_CHILD_ACTION === "approve" ? await f.service.approve(f.id) : await f.service.resume(f.id);
  process.stdout.write(`${canonicalJson({ state: result.state, calls: f.calls })}\n`);
}
