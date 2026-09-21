import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { BASE_DEPLOYMENT_MIGRATION_CANDIDATE as candidate, assertBaseDeploymentMigrationProof,
  migrateBaseDeploymentOperation, type BaseMigrationObservation } from "../../src/lifi/base-deployment-migration.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import type { BridgeDeploymentIdentity } from "../../src/lifi/model.js";
import { validateBridgeOperation, validateLegacyBridgeOperation } from "../../src/lifi/operation-validation.js";
import { temporaryState } from "./helpers.js";
import { lifiFixture } from "./lifi-helpers.js";

const fixturePath = (name: string) => resolve(`tests/core/lifi-fixtures/base-historical-${name}-20260921.json`);
async function fixture(): Promise<BridgeOperationRecord> {
  return validateLegacyBridgeOperation(JSON.parse(await readFile(fixturePath("deployment-operation"), "utf8")));
}
async function observation(role: "source" | "destination"): Promise<BaseMigrationObservation> {
  return JSON.parse(await readFile(fixturePath(`${role}-proof`), "utf8"));
}
const sourceDeployment = candidate.verifiedSourceDeployment as BridgeDeploymentIdentity;
const destinationDeployment = candidate.newDestinationDeployment as BridgeDeploymentIdentity;

test("the one copied Base USDC legacy journal is exactly promoted without changing either effect", async () => {
  const old = await fixture(), source = await observation("source"), destination = await observation("destination");
  const proof = assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment);
  const migrated = migrateBaseDeploymentOperation(old, proof);
  assert.equal(migrated.alreadyCurrent, false); validateBridgeOperation(migrated.operation);
  assert.equal(migrated.operation.fingerprint, candidate.newFingerprint);
  assert.equal(migrated.operation.integrityHash, candidate.newIntegrityHash);
  assert.equal(migrated.operation.transitions.at(-1)!.transitionHash, candidate.newTransitionRoot);
  assert.deepEqual(migrated.operation.effects, old.effects);
  assert.deepEqual(migrated.operation.sourceProof, old.sourceProof);
  assert.deepEqual(migrated.operation.providerObservation, old.providerObservation);
  assert.equal(migrated.operation.state, "completed"); assert.equal(migrated.operation.terminal, true);
  assert.deepEqual(migrated.operation.destinationProof, proof);
  assert.equal(migrated.operation.effects[0]!.submissionAttempts, 1);
  assert.equal(migrated.operation.effects[1]!.submissionAttempts, 1);
  assert.equal(migrated.operation.intent.allowlist, null); assert.equal(migrated.operation.usageLease, null);
  assert.ok(migrated.operation.transitions.every((entry) => entry.usageLease === null));
  assert.deepEqual(migrated.operation.intent.sourceDeployment, old.intent.sourceDeployment);
  assert.deepEqual(migrated.operation.intent.destinationDeployment, candidate.newDestinationDeployment);
  const repeated = migrateBaseDeploymentOperation(migrated.operation);
  assert.equal(repeated.alreadyCurrent, true); assert.deepEqual(repeated.operation, migrated.operation);
  assert.deepEqual(repeated.previousOperation, old); assert.deepEqual(repeated.audit, migrated.audit);
});

test("Base migration requires finalized canonical source and fill proofs with exact Across correlation", async () => {
  const old = await fixture(), source = await observation("source"), destination = await observation("destination");
  assert.doesNotThrow(() => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment));
  const cases: Array<() => void> = [
    () => assertBaseDeploymentMigrationProof(old, { ...source, transaction: { ...source.transaction, safeBlock: null } }, sourceDeployment, destination, destinationDeployment),
    () => assertBaseDeploymentMigrationProof(old, source, { ...sourceDeployment, codeHash: "0".repeat(64) }, destination, destinationDeployment),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, { ...destination,
      transaction: { ...destination.transaction, transactionHash: `0x${"aa".repeat(32)}` } }, destinationDeployment),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination,
      { ...destinationDeployment, configurationHash: "f".repeat(64) }),
    () => { const forged = structuredClone(destination) as any; forged.receipt.logs[1].data = `0x${2766207n.toString(16).padStart(64, "0")}`;
      assertBaseDeploymentMigrationProof(old, source, sourceDeployment, forged, destinationDeployment); },
  ];
  for (const run of cases) assert.throws(run, (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED");
});

test("Base candidate refuses alternate operation, route, amount, address, transaction and digests", async () => {
  const old = await fixture(), source = await observation("source"), destination = await observation("destination");
  const proof = assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment);
  const mutations = [
    (op: any) => { op.operationId = "a".repeat(64); },
    (op: any) => { op.intent.materialization.request.toChainId = 42161; },
    (op: any) => { op.intent.materialization.request.amountAtomic = "2776699"; },
    (op: any) => { op.intent.materialization.request.recipient = "0x1111111111111111111111111111111111111111"; },
    (op: any) => { op.effects[1].transactionHash = `0x${"bb".repeat(32)}`; },
    (op: any) => { op.integrityHash = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(old) as any; mutate(forged);
    assert.throws(() => migrateBaseDeploymentOperation(forged, proof), (error: unknown) => error instanceof ApnError);
  }
  const current = migrateBaseDeploymentOperation(old, proof).operation as any;
  current.integrityHash = "f".repeat(64);
  assert.throws(() => migrateBaseDeploymentOperation(current), (error: unknown) => error instanceof ApnError);
});

test("repair-deployment migrates the copied journal audit-first and is restart-idempotent without custody or send", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-base", { initializeWallet: false, policy: false });
  const old = await fixture(), id = old.operationId, profile = old.profileHash;
  await mkdir(resolve(temporary.root, "bridge-operations", profile), { recursive: true, mode: 0o700 });
  await mkdir(resolve(temporary.root, "bridge-receipts", profile), { recursive: true, mode: 0o700 });
  await writeFile(resolve(temporary.root, "bridge-operations", profile, `${id}.json`), `${JSON.stringify(old)}\n`, { mode: 0o600 });
  const legacyReceipt = await readFile(fixturePath("deployment-receipt"));
  const receiptPath = resolve(temporary.root, "bridge-receipts", profile, `${id}.json`);
  await writeFile(receiptPath, legacyReceipt, { mode: 0o600 });
  const source = await observation("source"), destination = await observation("destination");
  let sourceObservations = 0, destinationObservations = 0, deployments = 0, sends = 0, custody = 0;
  (s.source as any).origin = candidate.verifiedSourceDeployment.rpcOrigin;
  (s.destination as any).origin = candidate.newDestinationDeployment.rpcOrigin;
  s.source.observe = async (hash, expected) => { sourceObservations++; assert.equal(hash, candidate.sourceTransactionHash); assert.equal(expected?.role, "bridge"); return source; };
  s.destination.observe = async (hash, expected) => { destinationObservations++; assert.equal(hash, candidate.destinationTransactionHash); assert.equal(expected, undefined); return destination; };
  s.source.deployment = async (_tool, _peer, _token, block) => { deployments++; assert.deepEqual(block, candidate.sourceBlock); return sourceDeployment; };
  s.destination.deployment = async (_tool, _peer, _token, block) => { deployments++; assert.deepEqual(block, candidate.destinationBlock); return destinationDeployment; };
  s.source.send = s.destination.send = async () => { sends++; throw new Error("send forbidden"); };
  s.custody.load = async () => { custody++; throw new Error("custody forbidden"); };
  s.custody.seal = async () => { custody++; throw new Error("custody forbidden"); };
  const result = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(result.ok, true, result.error?.message); assert.equal((result.data as any).status, "migrated");
  assert.equal(sourceObservations, 1); assert.equal(destinationObservations, 1); assert.equal(deployments, 2);
  assert.equal(sends, 0); assert.equal(custody, 0);
  const saved = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(saved.integrityHash, candidate.newIntegrityHash); assert.deepEqual(saved.effects, old.effects);
  const auditPath = resolve(temporary.root, "bridge-migrations", profile, `${id}.json`);
  const audit = JSON.parse(await readFile(auditPath, "utf8")); assert.equal(audit.auditDigest, (result.data as any).audit.auditDigest);
  const currentReceipt = await readFile(receiptPath);
  const repeated = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(repeated.ok, true); assert.equal((repeated.data as any).status, "already_current");
  assert.equal(sourceObservations, 1); assert.equal(destinationObservations, 1); assert.equal(deployments, 2);
  // Interruption after the operation replacement but before receipt replacement is repaired from the immutable audit.
  await writeFile(receiptPath, legacyReceipt, { mode: 0o600 });
  const restarted = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(restarted.ok, true); assert.equal((restarted.data as any).status, "already_current");
  assert.deepEqual(await readFile(receiptPath), currentReceipt);
  const forgedAudit = { ...audit, newIntegrityHash: "0".repeat(64) };
  await writeFile(auditPath, `${JSON.stringify(forgedAudit)}\n`, { mode: 0o600 });
  const rejected = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(rejected.ok, false); assert.equal(rejected.error?.code, "APN_STATE_CORRUPT");
});
