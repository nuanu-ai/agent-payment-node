import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { adaptLegacyBridgeOperation } from "../../src/lifi/legacy-operation.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { legacyBridgeReceipt } from "../../src/lifi/receipt.js";
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
  assert.equal((status.operation as any).journal_compatibility.resumable, false);
  assert.equal((status.operation as any).policy.allowlist.availability, "legacy_unknown");
  assert.deepEqual((await s.core.execute({ command: "receipt.get", operationId: prepared.id })).receipt, fixture.receipt);
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
