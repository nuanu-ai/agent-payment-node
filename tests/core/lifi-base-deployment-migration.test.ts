import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { BASE_DEPLOYMENT_MIGRATION_CANDIDATE as candidate, assertBaseDeploymentMigrationProof,
  migrateBaseDeploymentOperation, type BaseMigrationObservation } from "../../src/lifi/base-deployment-migration.js";
import type { BridgeChainId } from "../../src/lifi/chains.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import type { BridgeDeploymentIdentity, BridgeTool } from "../../src/lifi/model.js";
import type { BridgeRpcPort } from "../../src/lifi/ports.js";
import { BridgeRpc, type RpcBatchReadItem, type RpcReadSession } from "../../src/lifi/rpc.js";
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
const sourceFinality = candidate.sourceSafeBlock;
const destinationFinality = candidate.destinationSafeBlock;

test("the one copied Base USDC legacy journal is exactly promoted without changing either effect", async () => {
  const old = await fixture(), source = await observation("source"), destination = await observation("destination");
  const proof = assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment,
    sourceFinality, destinationFinality);
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
  assert.doesNotThrow(() => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment,
    sourceFinality, destinationFinality));
  const cases: Array<() => void> = [
    () => assertBaseDeploymentMigrationProof(old, { ...source, transaction: { ...source.transaction, safeBlock: null } }, sourceDeployment,
      destination, destinationDeployment, sourceFinality, destinationFinality),
    () => assertBaseDeploymentMigrationProof(old, source, { ...sourceDeployment, codeHash: "0".repeat(64) }, destination,
      destinationDeployment, sourceFinality, destinationFinality),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, { ...destination,
      transaction: { ...destination.transaction, transactionHash: `0x${"aa".repeat(32)}` } }, destinationDeployment,
      sourceFinality, destinationFinality),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination,
      { ...destinationDeployment, configurationHash: "f".repeat(64) }, sourceFinality, destinationFinality),
    () => { const forged = structuredClone(destination) as any; forged.receipt.logs[1].data = `0x${2766207n.toString(16).padStart(64, "0")}`;
      assertBaseDeploymentMigrationProof(old, source, sourceDeployment, forged, destinationDeployment, sourceFinality, destinationFinality); },
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment,
      { ...sourceFinality, hash: `0x${"11".repeat(32)}` }, destinationFinality),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment,
      { ...sourceFinality, timestampAtomic: (BigInt(sourceFinality.timestampAtomic) + 1n).toString() }, destinationFinality),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment,
      sourceFinality, { ...destinationFinality, hash: `0x${"22".repeat(32)}` }),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment,
      sourceFinality, { ...destinationFinality, timestampAtomic: (BigInt(destinationFinality.timestampAtomic) + 1n).toString() }),
    () => assertBaseDeploymentMigrationProof(old, { ...source, transaction: { ...source.transaction,
      safeBlock: { ...sourceFinality, hash: `0x${"33".repeat(32)}` } } }, sourceDeployment, destination, destinationDeployment,
      sourceFinality, destinationFinality),
    () => assertBaseDeploymentMigrationProof(old, { ...source, transaction: { ...source.transaction,
      safeBlock: { ...sourceFinality, timestampAtomic: (BigInt(sourceFinality.timestampAtomic) + 1n).toString() } } }, sourceDeployment,
      destination, destinationDeployment, sourceFinality, destinationFinality),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, { ...destination, transaction: { ...destination.transaction,
      safeBlock: { ...destinationFinality, hash: `0x${"44".repeat(32)}` } } }, destinationDeployment,
      sourceFinality, destinationFinality),
    () => assertBaseDeploymentMigrationProof(old, source, sourceDeployment, { ...destination, transaction: { ...destination.transaction,
      safeBlock: { ...destinationFinality, timestampAtomic: (BigInt(destinationFinality.timestampAtomic) + 1n).toString() } } },
      destinationDeployment, sourceFinality, destinationFinality),
  ];
  for (const run of cases) assert.throws(run, (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED");
});

test("Base candidate refuses alternate operation, route, amount, address, transaction and digests", async () => {
  const old = await fixture(), source = await observation("source"), destination = await observation("destination");
  const proof = assertBaseDeploymentMigrationProof(old, source, sourceDeployment, destination, destinationDeployment,
    sourceFinality, destinationFinality);
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
  s.source.block = async (tag) => { assert.equal(tag, sourceFinality.numberAtomic); return sourceFinality; };
  s.destination.block = async (tag) => { assert.equal(tag, destinationFinality.numberAtomic); return destinationFinality; };
  s.source.send = s.destination.send = async () => { sends++; throw new Error("send forbidden"); };
  s.custody.load = async () => { custody++; throw new Error("custody forbidden"); };
  s.custody.seal = async () => { custody++; throw new Error("custody forbidden"); };
  const pending = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(pending.ok, true); assert.equal((pending.data as any).status, "pending");
  assert.deepEqual((await s.core.bridges.records.findStoredOperation(id) as any).raw.effects, old.effects);
  const checkpointPath = resolve(temporary.root, "bridge-migrations", profile, `${id}.source.json`);
  const checkpoint = await readFile(checkpointPath);
  const tampered = JSON.parse(checkpoint.toString()); tampered.observation.transaction.status = "reverted";
  await writeFile(checkpointPath, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
  const corrupt = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(corrupt.ok, false); assert.equal(corrupt.error?.code, "APN_STATE_CORRUPT");
  await writeFile(checkpointPath, checkpoint, { mode: 0o600 });
  s.destination.observe = async () => ({ ...destination, transaction: { ...destination.transaction, status: "reverted" } });
  const reverted = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(reverted.ok, false); assert.equal(reverted.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal((await s.core.bridges.records.findStoredOperation(id) as any).raw.integrityHash, old.integrityHash);
  s.destination.observe = async (hash) => { destinationObservations++; assert.equal(hash, candidate.destinationTransactionHash); return destination; };
  const result = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(result.ok, true, result.error?.message); assert.equal((result.data as any).status, "migrated");
  assert.equal(sourceObservations, 1); assert.equal(destinationObservations, 1); assert.equal(deployments, 3);
  assert.equal(sends, 0); assert.equal(custody, 0);
  const saved = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(saved.integrityHash, candidate.newIntegrityHash); assert.deepEqual(saved.effects, old.effects);
  const auditPath = resolve(temporary.root, "bridge-migrations", profile, `${id}.json`);
  const audit = JSON.parse(await readFile(auditPath, "utf8")); assert.equal(audit.auditDigest, (result.data as any).audit.auditDigest);
  const currentReceipt = await readFile(receiptPath);
  const repeated = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(repeated.ok, true); assert.equal((repeated.data as any).status, "already_current");
  assert.equal(sourceObservations, 1); assert.equal(destinationObservations, 1); assert.equal(deployments, 3);
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

test("repair-deployment fits its production 29-request BridgeRpc session shape with archive chunks capped at three", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const requests: Array<{ origin: string; route: "primary" | "archive"; items: Array<{ id: string; method: string; params: unknown[] }> }> = [];
  const repairSessions: RpcReadSession[] = [];
  const shapeRpc = (chainId: BridgeChainId, session: RpcReadSession): BridgeRpcPort => {
    const origin = chainId === 1 ? candidate.verifiedSourceDeployment.rpcOrigin : candidate.newDestinationDeployment.rpcOrigin;
    const archiveOrigin = `${origin}/archive`;
    const attempt = (route: "primary" | "archive") => async (body: string) => {
      const parsed = JSON.parse(body) as { id: string; method: string; params: unknown[] } | Array<{ id: string; method: string; params: unknown[] }>;
      const items = Array.isArray(parsed) ? parsed : [parsed]; requests.push({ origin: route === "archive" ? archiveOrigin : origin, route, items });
      const response = items.map((item) => ({ jsonrpc: "2.0", id: item.id, result: "0x1" }));
      return Array.isArray(parsed) ? response : response[0];
    };
    const read = async (route: "primary" | "archive", methods: readonly string[], archiveDeployment = false) => {
      const transport = attempt(route), items = methods.map((method, index) => ({ method, params: [`0x${chainId.toString(16)}`, index, requests.length],
        cachePolicy: "none" as const, decoder: (value: unknown) => value, batchAttempt: transport })) satisfies RpcBatchReadItem[];
      return archiveDeployment ? await session.readArchiveDeploymentBatch(archiveOrigin, chainId, items) :
        await session.readBatch(route === "archive" ? archiveOrigin : origin, chainId, items);
    };
    const rpc = new BridgeRpc(chainId, origin, async () => "0x1");
    rpc.observe = async () => {
      for (const methods of [["eth_chainId"], ["eth_getTransactionByHash"], ["eth_getTransactionReceipt"],
        ["eth_getBlockByNumber"], ["eth_getBlockByNumber"], ["eth_call"]]) await read("primary", methods);
      await read("archive", ["eth_chainId", "eth_getBlockByNumber", "eth_getBlockByNumber"]);
      return await observation(chainId === 1 ? "source" : "destination");
    };
    rpc.deployment = async (_tool: BridgeTool) => {
      await read("archive", Array.from({ length: chainId === 1 ? 15 : 23 }, (_, index) =>
        index % 3 === 0 ? "eth_getCode" : index % 3 === 1 ? "eth_getStorageAt" : "eth_call"), true);
      return chainId === 1 ? sourceDeployment : destinationDeployment;
    };
    rpc.block = async () => {
      await read("primary", ["eth_getBlockByNumber"]);
      return chainId === 1 ? sourceFinality : destinationFinality;
    };
    return rpc;
  };
  const rpcFor = (chainId: BridgeChainId, session?: RpcReadSession) => {
    assert.ok(session); if (!repairSessions.includes(session)) repairSessions.push(session); return shapeRpc(chainId, session);
  };
  const clockStart = Date.parse("2026-09-22T00:00:00.000Z"); let clockReads = 0;
  const s = await lifiFixture(temporary.root, "eth-base", { initializeWallet: false, policy: false, rpcFor,
    clockNow: () => new Date(clockStart + Math.floor(clockReads++ / 5) * 750) });
  const old = await fixture(), id = old.operationId, profile = old.profileHash;
  await mkdir(resolve(temporary.root, "bridge-operations", profile), { recursive: true, mode: 0o700 });
  await mkdir(resolve(temporary.root, "bridge-receipts", profile), { recursive: true, mode: 0o700 });
  await writeFile(resolve(temporary.root, "bridge-operations", profile, `${id}.json`), `${JSON.stringify(old)}\n`, { mode: 0o600 });
  await writeFile(resolve(temporary.root, "bridge-receipts", profile, `${id}.json`), await readFile(fixturePath("deployment-receipt")), { mode: 0o600 });
  const pending = await s.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(pending.ok, true, JSON.stringify(pending.error)); assert.equal((pending.data as any).status, "pending");
  assert.equal(requests.length, 12);
  assert.equal(repairSessions.length, 1); assert.equal(repairSessions[0]!.telemetry().httpRequests, 12);
  const checkpointPath = resolve(temporary.root, "bridge-migrations", profile, `${id}.source.json`);
  assert.ok(JSON.parse(await readFile(checkpointPath, "utf8")).digest);
  const restart = await lifiFixture(temporary.root, "eth-base", { initializeWallet: false, policy: false, rpcFor,
    clockNow: () => new Date(clockStart + Math.floor(clockReads++ / 5) * 750) });
  const result = await restart.core.execute({ command: "operation.repair-deployment", operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error)); assert.equal((result.data as any).status, "migrated");
  assert.equal(repairSessions.length, 2);
  assert.deepEqual(repairSessions.map((session) => session.telemetry().httpRequests), [12, 17]);
  assert.deepEqual(repairSessions.map((session) => session.telemetry().httpAttempts), [12, 17]);
  assert.deepEqual(repairSessions.map((session) => session.physicalBudget?.remaining()), [12, 7]);
  const archive = requests.filter((request) => request.route === "archive");
  assert.equal(requests.length, 29); assert.ok(archive.every((request) => request.items.length <= 3));
  assert.deepEqual(archive.slice(2).map((request) => request.items.length), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2]);
});
