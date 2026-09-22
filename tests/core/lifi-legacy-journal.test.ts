import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { keccak256 } from "viem";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { BRIDGE_DEPLOYMENT_PROOF_POLICY_CUTOVER, bridgeApprovalPolicyBinding, legacyBridgeApprovalPolicyHash } from "../../src/lifi/economics.js";
import { adaptLegacyBridgeOperation } from "../../src/lifi/legacy-operation.js";
import { bridgeIntentBinding, type BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { BridgeOperationRepository } from "../../src/lifi/operation-repository.js";
import { bridgeReceipt, legacyBridgeReceipt } from "../../src/lifi/receipt.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

function downgradeFixture(record: BridgeOperationRecord): Record<string, any> {
  const raw = structuredClone(record) as Record<string, any>;
  delete raw.usageLease;
  delete raw.intent.allowlist;
  if (raw.destinationProof !== null) {
    delete raw.destinationProof.nativeBalance;
    delete raw.destinationProof.nativeTransfer;
  }
  const binding = { schemaVersion: raw.schemaVersion, kind: raw.kind, profileHash: raw.profileHash,
    operationId: raw.operationId, idempotencyHash: raw.idempotencyHash, requestHash: raw.requestHash,
    intent: raw.intent, envelopes: raw.effects.map((effect: any) => effect.envelope) };
  raw.fingerprint = hashObject(binding);
  if (raw.approval !== null) raw.approval.fingerprint = raw.fingerprint;
  let previousHash = raw.fingerprint;
  for (const transition of raw.transitions) {
    delete transition.usageLease;
    if (transition.destinationProof !== null) {
      delete transition.destinationProof.nativeBalance;
      delete transition.destinationProof.nativeTransfer;
    }
    if (transition.approval !== null) transition.approval.fingerprint = raw.fingerprint;
    transition.previousHash = previousHash;
    delete transition.transitionHash;
    transition.transitionHash = hashObject(transition);
    previousHash = transition.transitionHash;
  }
  delete raw.integrityHash;
  raw.integrityHash = hashObject(raw);
  return raw;
}

async function installLegacyFixture(root: string, record: BridgeOperationRecord) {
  const raw = downgradeFixture(record), operationPath = join(root, "bridge-operations", raw.profileHash, `${raw.operationId}.json`);
  const legacy = adaptLegacyBridgeOperation(raw), receipt = legacyBridgeReceipt(legacy);
  const receiptPath = join(root, "bridge-receipts", raw.profileHash, `${raw.operationId}.json`);
  await mkdir(dirname(operationPath), { recursive: true }); await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(operationPath, `${canonicalJson(raw)}\n`); await writeFile(receiptPath, `${canonicalJson(receipt)}\n`);
  return { raw, receipt, operationPath, receiptPath };
}

function preProofBindingFixture(record: BridgeOperationRecord, policyHash = legacyBridgeApprovalPolicyHash(record.intent.materialization)):
  BridgeOperationRecord {
  const raw = structuredClone(record) as BridgeOperationRecord;
  (raw.intent as { policyHash: string }).policyHash = policyHash;
  (raw as { fingerprint: string }).fingerprint = hashObject(bridgeIntentBinding(raw));
  if (raw.approval !== null) (raw.approval as { fingerprint: string }).fingerprint = raw.fingerprint;
  let previousHash = raw.fingerprint;
  for (const transition of raw.transitions) {
    if (transition.approval !== null) (transition.approval as { fingerprint: string }).fingerprint = raw.fingerprint;
    (transition as { previousHash: string }).previousHash = previousHash;
    const mutable = transition as BridgeOperationRecord["transitions"][number] & { transitionHash: string };
    const { transitionHash: _old, ...body } = mutable;
    mutable.transitionHash = hashObject(body); previousHash = mutable.transitionHash;
  }
  const mutable = raw as BridgeOperationRecord & { integrityHash: string };
  const { integrityHash: _old, ...body } = mutable; mutable.integrityHash = hashObject(body);
  return raw;
}

async function installPreProofBindingFixture(root: string, record: BridgeOperationRecord) {
  const raw = preProofBindingFixture(record), validated = validateBridgeOperation(raw);
  const operationPath = join(root, "bridge-operations", raw.profileHash, `${raw.operationId}.json`);
  const receiptPath = join(root, "bridge-receipts", raw.profileHash, `${raw.operationId}.json`);
  await mkdir(dirname(operationPath), { recursive: true }); await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(operationPath, `${canonicalJson(raw)}\n`); await writeFile(receiptPath, `${canonicalJson(bridgeReceipt(validated))}\n`);
  return { raw, operationPath, receiptPath };
}

test("legacy failed LI.FI journal stays readable and cannot be resumed, signed, sent, or hidden from new prepares", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const prepared = await s.prepare("across", "legacy-failed-structural-fixture");
  s.approval.accepted = false;
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: prepared.id })).ok, true);
  const current = (await s.core.bridges.records.findOperation(prepared.id))!;
  assert.equal(current.state, "failed_before_effect");
  const fixture = await installLegacyFixture(temporary.root, current);
  const before = await readFile(fixture.operationPath, "utf8"), sends = s.source.submissions.length;

  const status = await s.core.execute({ command: "operation.status", operationId: prepared.id });
  assert.equal(status.ok, true, status.error?.message); assert.equal((status.operation as any).state, "failed_before_effect");
  assert.equal(Object.hasOwn(status.operation as object, "pre_sign_rpc_failure"), false);
  assert.equal((status.operation as any).journal_compatibility.resumable, false);
  assert.equal((status.operation as any).policy.allowlist.availability, "legacy_unknown");
  const receipt = await s.core.execute({ command: "receipt.get", operationId: prepared.id });
  assert.deepEqual(receipt.receipt, fixture.receipt);
  assert.equal(Object.hasOwn(receipt.receipt as object, "pre_sign_rpc_failure"), false);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: prepared.id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: prepared.id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(s.source.submissions.length, sends); assert.equal(await readFile(fixture.operationPath, "utf8"), before);

  const replay = await s.core.execute(prepared.input);
  assert.equal(replay.ok, true, replay.error?.message); assert.equal((replay.operation as any).state, "failed_before_effect");
  const fresh = await s.prepare("stargateV2", "new-after-legacy-failed");
  assert.equal(fresh.operation.state, "awaiting_approval");
  const conflict = await s.core.execute({ ...prepared.input, route: "route-stargateV2" });
  assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
});

test("legacy completed LI.FI journal and exact receipt remain readable without fabricated destination evidence", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "arb-eth");
  const prepared = await s.prepare("stargateV2", "legacy-completed-structural-fixture");
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: prepared.id })).ok, true);
  const current = (await s.core.bridges.records.findOperation(prepared.id))!;
  assert.equal(current.state, "completed");
  const fixture = await installLegacyFixture(temporary.root, current), sends = s.source.submissions.length;

  const status = await s.core.execute({ command: "operation.status", operationId: prepared.id });
  assert.equal(status.ok, true, status.error?.message); assert.equal((status.operation as any).state, "completed");
  assert.equal((status.operation as any).destination_proof.nativeBalance, undefined);
  assert.equal((status.operation as any).destination_proof.nativeTransfer, undefined);
  assert.equal((status.operation as any).journal_compatibility.native_balance_proof, "legacy_unknown");
  assert.equal((status.operation as any).journal_compatibility.native_transfer_proof, "legacy_unknown");
  assert.deepEqual((await s.core.execute({ command: "receipt.get", operationId: prepared.id })).receipt, fixture.receipt);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: prepared.id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(s.source.submissions.length, sends);
  const replay = await s.core.execute(prepared.input);
  assert.equal(replay.ok, true); assert.equal((replay.operation as any).state, "completed");
});

test("legacy adapter rejects corrupt hashes and bindings, while upgraded records cannot use the legacy fallback", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const prepared = await s.prepare("across", "legacy-corruption-fixture");
  s.approval.accepted = false; await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  const current = (await s.core.bridges.records.findOperation(prepared.id))!, fixture = await installLegacyFixture(temporary.root, current);

  const corruptHash = structuredClone(fixture.raw); corruptHash.integrityHash = "0".repeat(64);
  await writeFile(fixture.operationPath, `${canonicalJson(corruptHash)}\n`);
  assert.equal((await s.core.execute({ command: "operation.status", operationId: prepared.id })).error?.code, "APN_STATE_CORRUPT");

  const corruptBinding = structuredClone(fixture.raw); corruptBinding.intent.sourceRpcOrigin = "https://other-rpc.example";
  delete corruptBinding.integrityHash; corruptBinding.integrityHash = hashObject(corruptBinding);
  await writeFile(fixture.operationPath, `${canonicalJson(corruptBinding)}\n`);
  assert.equal((await s.core.execute({ command: "operation.status", operationId: prepared.id })).error?.code, "APN_STATE_CORRUPT");

  const upgradedRoot = await temporaryState(); t.after(upgradedRoot.cleanup);
  const upgraded = await lifiFixture(upgradedRoot.root, "eth-base", { now: new Date("2026-09-20T12:00:00.000Z") });
  const upgradedPrepared = await upgraded.prepare("across", "upgraded-missing-fields");
  const stripped = downgradeFixture(upgradedPrepared.operation), path = join(upgradedRoot.root, "bridge-operations", stripped.profileHash, `${stripped.operationId}.json`);
  await writeFile(path, `${canonicalJson(stripped)}\n`);
  assert.equal((await upgraded.core.execute({ command: "operation.status", operationId: upgradedPrepared.id })).error?.code, "APN_STATE_CORRUPT");
});

test("pre-proof-binding operation loads across restart and can only use full fresh deployment validation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "base-arb");
  const prepared = await s.prepare("stargateV2", "pre-proof-binding-full-refresh");
  await installPreProofBindingFixture(temporary.root, prepared.operation);
  let retainedProofCalls = 0;
  Object.assign(s.source, { refreshDeployment: async () => { retainedProofCalls += 1; throw new Error("retained proof forbidden"); } });
  Object.assign(s.destination, { refreshDeployment: async () => { retainedProofCalls += 1; throw new Error("retained proof forbidden"); } });
  s.approval.accepted = false;
  const result = await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
  assert.equal(result.ok, true, result.error?.message); assert.equal(retainedProofCalls, 0);
  assert.equal((result.operation as { state: string }).state, "failed_before_effect"); assert.equal(s.source.submissions.length, 0);
  const restarted = new BridgeOperationRepository(temporary.root), loaded = await restarted.findOperation(prepared.id);
  assert.equal(loaded?.terminal, true); assert.equal(loaded?.state, "failed_before_effect");
  assert.deepEqual(loaded?.effects.map((effect) => ({ attempts: effect.submissionAttempts, hash: effect.transactionHash })),
    [{ attempts: 0, hash: null }, { attempts: 0, hash: null }]);
});

test("pre-proof-binding completed and unknown-finality records preserve effects and hashes on state roundtrip", async (t) => {
  for (const state of ["completed", "unknown_finality"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, "base-arb"); s.source.allowance = s.request.amountAtomic;
    const prepared = await s.prepare("stargateV2", `pre-proof-binding-${state}`);
    if (state === "unknown_finality") {
      const send = s.source.send.bind(s.source);
      s.source.send = async (raw) => { await send(raw); s.source.missingHashes.add(keccak256(raw)); throw new Error("synthetic timeout after acceptance"); };
    }
    await s.core.execute({ command: "bridge.approve", operationId: prepared.id });
    const current = (await s.core.bridges.records.findOperation(prepared.id))!;
    assert.equal(current.state, state);
    await installPreProofBindingFixture(temporary.root, current);
    const loaded = await new BridgeOperationRepository(temporary.root).findOperation(prepared.id);
    assert.equal(loaded?.state, state); assert.equal(loaded?.terminal, state === "completed");
    assert.deepEqual(loaded?.effects.map((effect) => ({ phase: effect.phase, attempts: effect.submissionAttempts, hash: effect.transactionHash })),
      current.effects.map((effect) => ({ phase: effect.phase, attempts: effect.submissionAttempts, hash: effect.transactionHash })));
  }
});

test("pre-proof-binding compatibility rejects an integrity-consistent unknown policy binding", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "base-arb"); const prepared = await s.prepare("stargateV2", "pre-proof-binding-tamper");
  const raw = preProofBindingFixture(prepared.operation, "0".repeat(64));
  const operationPath = join(temporary.root, "bridge-operations", raw.profileHash, `${raw.operationId}.json`);
  await writeFile(operationPath, `${canonicalJson(raw)}\n`);
  await assert.rejects(new BridgeOperationRepository(temporary.root).findOperation(prepared.id), { code: "APN_STATE_CORRUPT" });
});

test("pre-proof policy compatibility is strictly before the immutable merge cutover", async (t) => {
  for (const [preparedAt, acceptsLegacy] of [
    ["2026-09-22T05:46:59.999Z", true],
    [BRIDGE_DEPLOYMENT_PROOF_POLICY_CUTOVER, false],
    ["2026-09-22T05:47:00.001Z", false],
  ] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root, "base-arb", { now: new Date(preparedAt) });
    const prepared = await s.prepare("stargateV2", `proof-cutover-${preparedAt}`);
    assert.equal(bridgeApprovalPolicyBinding(prepared.operation.intent.materialization, prepared.operation.intent.policyHash,
      prepared.operation.intent.preparedAt), "deployment-proof-v1");
    const raw = preProofBindingFixture(prepared.operation), operationPath = join(temporary.root, "bridge-operations",
      raw.profileHash, `${raw.operationId}.json`);
    await writeFile(operationPath, `${canonicalJson(raw)}\n`);
    const before = await readFile(operationPath, "utf8"), calls = s.source.calls.length + s.destination.calls.length;
    const submissions = s.source.submissions.length;
    const status = await s.core.execute({ command: "operation.status", operationId: prepared.id });
    assert.equal(status.ok, acceptsLegacy, preparedAt);
    assert.equal(status.error?.code, acceptsLegacy ? undefined : "APN_STATE_CORRUPT", preparedAt);
    assert.equal(s.source.calls.length + s.destination.calls.length, calls, `status must not issue RPC at ${preparedAt}`);
    assert.equal(s.source.submissions.length, submissions, `status must not submit at ${preparedAt}`);
    assert.equal(await readFile(operationPath, "utf8"), before, `status must not rewrite state at ${preparedAt}`);
  }
});
