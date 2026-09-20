import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { BridgeObservation } from "../../src/lifi/observation.js";
import { LINEA_DEPLOYMENT_MIGRATION_CANDIDATE as candidate, assertLineaDeploymentMigrationProof,
  migrateLineaDeploymentOperation } from "../../src/lifi/deployment-migration.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import type { BridgeDeploymentIdentity, BridgeTransactionProof } from "../../src/lifi/model.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { BridgeRpc } from "../../src/lifi/rpc.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import type { EvmRpcCall } from "../../src/evm-ports.js";
import { temporaryState } from "./helpers.js";
import { lifiFixture } from "./lifi-helpers.js";

async function fixture(): Promise<BridgeOperationRecord> {
  return validateBridgeOperation(JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/linea-historical-deployment-operation-20260921.json"), "utf8")));
}
const proof = { chainId: 59144, transactionHash: candidate.destinationTransactionHash, block: candidate.destinationBlock,
  safeBlock: { ...candidate.destinationBlock, numberAtomic: "32092056" }, rpcOrigin: candidate.newDeployment.rpcOrigin,
  status: "success" } as unknown as BridgeTransactionProof;
const deployment = candidate.newDeployment as BridgeDeploymentIdentity;
function capturedRpc(capture: any): EvmRpcCall {
  const values = new Map(capture.requests.map((row: any) => [canonicalJson([row.request.method, row.request.params]), row.response.result]));
  return async (method, params) => structuredClone(values.get(canonicalJson([method, params])));
}

test("recognized Linea historical deployment is refused before migration and exactly resealed", async () => {
  const old = await fixture();
  const observer = new BridgeObservation({} as never, { chainId: 59144, origin: deployment.rpcOrigin, deployment: async () => deployment } as never, {} as never, async () => old);
  await assert.rejects(async () => await (observer as any).historicalDeployment(old, (observer as any).destination, proof, old.intent.destinationDeployment),
    (error: unknown) => error instanceof ApnError && error.code === "APN_PROVIDER_PROTOCOL" && error.message.includes("historical_deployment_identity"));
  assertLineaDeploymentMigrationProof(proof, deployment);
  const migrated = migrateLineaDeploymentOperation(old, deployment);
  assert.equal(migrated.alreadyCurrent, false); validateBridgeOperation(migrated.operation);
  assert.deepEqual(migrated.operation.intent.destinationDeployment, deployment);
  assert.equal(migrated.operation.effects[0]!.submissionAttempts, 1);
  assert.equal(migrated.operation.effects[0]!.transactionHash, old.effects[0]!.transactionHash);
  assert.deepEqual(migrated.operation.effects[0]!.envelope, old.effects[0]!.envelope);
  assert.deepEqual(migrated.operation.sourceProof, old.sourceProof);
  assert.deepEqual(migrated.operation.providerObservation, old.providerObservation);
  assert.deepEqual(migrated.operation.destinationScan, old.destinationScan);
  assert.deepEqual(migrated.operation.usageLease, old.usageLease);
  const normalized = structuredClone(migrated.operation) as any;
  normalized.intent.destinationDeployment = old.intent.destinationDeployment;
  normalized.fingerprint = old.fingerprint; normalized.integrityHash = old.integrityHash;
  normalized.approval.fingerprint = old.approval!.fingerprint;
  normalized.transitions.forEach((entry: any, index: number) => {
    entry.previousHash = old.transitions[index]!.previousHash; entry.transitionHash = old.transitions[index]!.transitionHash;
    if (entry.approval !== null) entry.approval.fingerprint = old.transitions[index]!.approval!.fingerprint;
  });
  assert.deepEqual(normalized, old);
  assert.deepEqual(migrated.audit.touchedFields, ["intent.destinationDeployment", "fingerprint", "approval.fingerprint",
    "transitions[].approval.fingerprint", "transitions[].previousHash", "transitions[].transitionHash", "integrityHash"]);
  const repeated = migrateLineaDeploymentOperation(migrated.operation, deployment);
  assert.equal(repeated.alreadyCurrent, true); assert.deepEqual(repeated.operation, migrated.operation); assert.deepEqual(repeated.audit, migrated.audit);
});

test("Linea deployment migration fails closed for forged, terminal, unsent and alternate identities", async () => {
  const old = await fixture();
  for (const mutate of [
    (op: any) => { op.intent.destinationDeployment.contractHash = "0".repeat(64); },
    (op: any) => { op.terminal = true; op.state = "completed"; },
    (op: any) => { op.effects[0].submissionAttempts = 0; },
    (op: any) => { op.providerObservation.destinationTransactionHash = `0x${"aa".repeat(32)}`; },
  ]) {
    const forged = structuredClone(old) as any; mutate(forged);
    assert.throws(() => migrateLineaDeploymentOperation(forged, deployment), (error: unknown) => error instanceof ApnError);
  }
  const alternate = { ...deployment, configurationHash: "f".repeat(64) };
  assert.throws(() => assertLineaDeploymentMigrationProof(proof, alternate), (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED");
  assert.throws(() => assertLineaDeploymentMigrationProof({ ...proof, safeBlock: null }, deployment), (error: unknown) => error instanceof ApnError);
});

test("repair-deployment persists an audit-bound journal without provider, custody, signing or submission access", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-linea", { initializeWallet: false, policy: false });
  const old = await fixture(), profile = old.profileHash, id = old.operationId;
  await mkdir(resolve(temporary.root, "bridge-operations", profile), { recursive: true, mode: 0o700 });
  await mkdir(resolve(temporary.root, "bridge-receipts", profile), { recursive: true, mode: 0o700 });
  await writeFile(resolve(temporary.root, "bridge-operations", profile, `${id}.json`), `${JSON.stringify(old)}\n`, { mode: 0o600 });
  const receipt = await readFile(resolve("tests/core/lifi-fixtures/linea-historical-deployment-receipt-20260921.json"));
  await writeFile(resolve(temporary.root, "bridge-receipts", profile, `${id}.json`), receipt, { mode: 0o600 });
  let providerCalls = 0, custodyCalls = 0, observeCalls = 0, deploymentCalls = 0;
  s.provider.status = async () => { providerCalls++; throw new Error("provider forbidden"); };
  s.custody.load = async () => { custodyCalls++; throw new Error("custody forbidden"); };
  s.custody.seal = async () => { custodyCalls++; throw new Error("custody forbidden"); };
  (s.destination as any).origin = deployment.rpcOrigin;
  s.destination.observe = async (hash) => { observeCalls++; assert.equal(hash, candidate.destinationTransactionHash); return { transaction: proof, receipt: {} as never }; };
  s.destination.deployment = async (_tool, _peer, _token, block) => { deploymentCalls++; assert.deepEqual(block, candidate.destinationBlock); return deployment; };
  s.destination.send = async () => { throw new Error("send forbidden"); };
  const result = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(result.ok, true, result.error?.message); assert.equal((result.data as any).status, "migrated");
  assert.equal(providerCalls, 0); assert.equal(custodyCalls, 0); assert.equal(observeCalls, 1); assert.equal(deploymentCalls, 1);
  const saved = (await s.core.bridges.records.findOperation(id))!;
  assert.deepEqual(saved.intent.destinationDeployment, deployment); assert.equal(saved.effects[0]!.submissionAttempts, 1);
  const audit = JSON.parse(await readFile(resolve(temporary.root, "bridge-migrations", profile, `${id}.json`), "utf8"));
  assert.equal(audit.auditDigest, (result.data as any).audit.auditDigest);
  const receiptPath = resolve(temporary.root, "bridge-receipts", profile, `${id}.json`);
  const currentReceipt = await readFile(receiptPath);
  const staleHashTamper = JSON.parse(currentReceipt.toString("utf8")); staleHashTamper.reason = "forged_reason";
  const staleBytes = Buffer.from(`${JSON.stringify(staleHashTamper)}\n`); await writeFile(receiptPath, staleBytes, { mode: 0o600 });
  const staleRejected = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(staleRejected.ok, false); assert.equal(staleRejected.error?.code, "APN_STATE_CORRUPT");
  assert.deepEqual(await readFile(receiptPath), staleBytes);
  const { receipt_hash: _oldHash, ...forgedBody } = staleHashTamper;
  const forgedBytes = Buffer.from(`${JSON.stringify({ ...forgedBody, receipt_hash: hashObject(forgedBody) })}\n`);
  await writeFile(receiptPath, forgedBytes, { mode: 0o600 });
  const forgedRejected = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(forgedRejected.ok, false); assert.equal(forgedRejected.error?.code, "APN_STATE_CORRUPT");
  assert.deepEqual(await readFile(receiptPath), forgedBytes);
  assert.equal(observeCalls, 1); assert.equal(deploymentCalls, 1); assert.equal(providerCalls, 0); assert.equal(custodyCalls, 0);
  await writeFile(receiptPath, currentReceipt, { mode: 0o600 });
  const currentRepeat = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(currentRepeat.ok, true, currentRepeat.error?.message); assert.equal((currentRepeat.data as any).status, "already_current");
  // Simulate interruption after the operation replacement but before its derived receipt replacement.
  await writeFile(receiptPath, receipt, { mode: 0o600 });
  const repeated = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(repeated.ok, true, repeated.error?.message); assert.equal((repeated.data as any).status, "already_current");
  assert.equal(observeCalls, 1); assert.equal(deploymentCalls, 1);
  assert.equal((await s.core.bridges.records.loadReceipt(profile, id)).operation_binding_hash, saved.integrityHash);
});

test("migrated captured journal reaches canonical terminal destination proof without resend", async () => {
  const old = await fixture(), migrated = migrateLineaDeploymentOperation(old, deployment).operation;
  const capture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/linea-native-fill-rpc-20260920.json"), "utf8"));
  const destination = new BridgeRpc(59144, capture.rpcOrigin, capturedRpc(capture));
  destination.deployment = async (_tool, _peer, _token, block) => { assert.deepEqual(block, candidate.destinationBlock); return deployment; };
  let sends = 0; destination.send = async () => { sends++; throw new Error("send forbidden"); };
  const request = migrated.intent.materialization.request;
  const source = { account: async (owner: string, spender: string, token: string) => ({ chainId: 1, rpcOrigin: migrated.intent.sourceRpcOrigin,
    block: migrated.effects[0]!.safeProof!.block, owner, token, spender, balanceAtomic: "0", nativeBalanceWei: "0", allowanceAtomic: "0",
    latestNonceAtomic: "0", pendingNonceAtomic: "0" }) } as never;
  const provider = { status: async () => migrated.providerObservation! } as never;
  let current = migrated;
  const observation = new BridgeObservation(source, destination, provider, async (op, patch) => {
    current = transitionBridge(op, patch, "2026-09-21T05:00:00.000Z"); return current;
  });
  const completed = await observation.destinationProof(current);
  assert.equal(completed.state, "completed"); assert.equal(completed.terminal, true);
  assert.equal(completed.destinationProof?.transactionHash, candidate.destinationTransactionHash);
  assert.equal(completed.destinationProof?.amountAtomic, request.minOutputAtomic === "0" ? capture.expected.amountAtomic : capture.expected.amountAtomic);
  assert.equal(completed.effects[0]!.submissionAttempts, 1); assert.equal(sends, 0);
});
