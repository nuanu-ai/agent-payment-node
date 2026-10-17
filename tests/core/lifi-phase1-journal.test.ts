import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { BridgeEffectClaims } from "../../src/lifi/effect-authority.js";
import { BRIDGE_TELEMETRY_ROWS, type BridgeObservationTelemetry, type BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LIFI_SYNTHETIC_KEY, lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";

/** Every file under a state directory, so a test can restore that directory exactly as a backup restore would. */
async function files(root: string): Promise<Map<string, Buffer>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }), out = new Map<string, Buffer>();
  for (const entry of entries) if (entry.isFile()) { const path = join(entry.parentPath, entry.name); out.set(path, await readFile(path)); }
  return out;
}
async function restore(root: string, saved: Map<string, Buffer>): Promise<void> {
  for (const path of (await files(root)).keys()) if (!saved.has(path)) await rm(path);
  for (const [path, bytes] of saved) await writeFile(path, bytes);
}
const row = (physicalRequests: number): BridgeObservationTelemetry => ({ schemaVersion: "apn.bridge-observation-telemetry.v1",
  stage: "source_observation", effectRole: "approval", outcome: "missing", physicalRequests, httpAttempts: physicalRequests,
  logicalRpcItems: physicalRequests, batchCount: 0, maxBatchSize: 1, budgetRejectedBeforeTransport: 0,
  attemptsByEndpointRole: { primary: physicalRequests, receipt: 0, archive: 0 }, attemptsByMethodClass: { transaction: physicalRequests } });
/** The exact shape a 0.5.41 writer left after many polls: the whole telemetry history inside the last hashed transition. */
function withWriterTelemetry(op: BridgeOperationRecord, rows: readonly BridgeObservationTelemetry[]): BridgeOperationRecord {
  const copy = structuredClone(op) as any, last = copy.transitions.at(-1);
  copy.observationTelemetry = rows; last.observationTelemetry = rows; delete last.transitionHash; last.transitionHash = hashObject(last);
  delete copy.integrityHash; copy.integrityHash = hashObject(copy);
  return validateBridgeOperation(copy);
}

test("LIFI-07: telemetry-only polls never grow the hashed journal, and a long 0.5.41 history compacts on its next real change", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  s.source.safeApproval = false; s.source.safeBridge = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  let op = (await findStored(s.core.bridges.records, id))!; const size = canonicalJson(op).length, transitions = op.transitions.length;
  // Two hundred polls that only add read telemetry: the record, its size and its history stay exactly the same.
  for (let poll = 0; poll < 200; poll++) op = transitionBridge(op, { observationTelemetry: [...op.observationTelemetry ?? [], row(poll + 1)] }, op.updatedAt);
  assert.equal(op.transitions.length, transitions); assert.equal(canonicalJson(op).length, size);
  // A journal written by 0.5.41 with 100 rows still loads; its next real change keeps only the latest rows.
  const legacy = withWriterTelemetry(op, Array.from({ length: 100 }, (_, index) => row(index + 1)));
  const next = transitionBridge(legacy, { failure: { reason: "source_observation_unavailable", residualAllowance: null } },
    new Date(Date.parse(legacy.updatedAt) + 1).toISOString());
  assert.equal(next.transitions.length, legacy.transitions.length + 1); assert.equal(next.observationTelemetry?.length, BRIDGE_TELEMETRY_ROWS);
  assert.deepEqual(next.observationTelemetry?.at(-1), row(100)); assert.equal(validateBridgeOperation(next), next);
});

test("LIFI-06: a user can swap both RPC endpoints mid-bridge; proofs bind the chain, not the URL", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "base-arb");
  s.source.safeApproval = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const pending = (await findStored(s.core.bridges.records, id))!;
  assert.equal(pending.effects[0]!.phase, "included_success"); assert.equal(pending.effects[0]!.includedProof!.rpcOrigin, "https://rpc-8453.example");
  (s.source as { origin: string }).origin = "https://base-replacement.example";
  (s.destination as { origin: string }).origin = "https://arbitrum-replacement.example";
  s.source.safeApproval = true;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const completed = (await findStored(s.core.bridges.records, id))!;
  assert.equal(completed.state, "completed"); assert.equal(completed.intent.sourceRpcOrigin, "https://rpc-8453.example");
  assert.equal(completed.effects[0]!.safeProof!.rpcOrigin, "https://base-replacement.example");
  assert.equal(completed.destinationProof!.rpcOrigin, "https://arbitrum-replacement.example"); assert.equal(s.source.submissions.length, 2);
});

test("LIFI-11: every route claims SIGN and SEND; a journal restored to a sealed approval catches up and never resends", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "base-arb");
  const { id, operation } = await s.prepare();
  const opPath = join(temporary.root, "bridge-operations", operation.profileHash, `${id}.json`);
  let snapshot: { op: Buffer; usage: Map<string, Buffer> } | undefined;
  const persist = s.core.bridges.records.persist.bind(s.core.bridges.records);
  s.core.bridges.records.persist = async (next) => {
    await persist(next);
    if (snapshot === undefined && next.effects[0]!.phase === "sealed") snapshot = { op: await readFile(opPath),
      usage: await files(join(temporary.root, "asset-usage")) };
  };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const completed = (await findStored(s.core.bridges.records, id))!, claims = new BridgeEffectClaims(temporary.root);
  assert.equal(completed.state, "completed"); assert.equal(s.source.submissions.length, 2);
  for (const role of ["approval", "bridge"] as const) assert.equal((await claims.sendClaim(completed, role))?.transactionHash,
    completed.effects.find((effect) => effect.role === role)!.transactionHash);
  // Restore the journal and the usage ledger to the sealed, unsent approval: the SEND claims survive outside them, so APN
  // records each attempt and observes it instead of sending again, for both effects in turn.
  await writeFile(opPath, snapshot!.op); await restore(join(temporary.root, "asset-usage"), snapshot!.usage);
  for (let resume = 0; resume < 3; resume++) await s.core.execute({ command: "operation.resume", operationId: id });
  const caughtUp = (await findStored(s.core.bridges.records, id))!;
  assert.equal(caughtUp.state, "completed"); assert.equal(s.source.submissions.length, 2);
  assert.deepEqual(caughtUp.effects.map((effect) => effect.transactionHash), completed.effects.map((effect) => effect.transactionHash));
});

/** A process that died after the durable signing_started save and before custody sealed: no material, no SEND claim. */
async function interruptedSeal(root: string) {
  const s = await lifiFixture(root, "base-arb"), { id } = await s.prepare(), seal = s.custody.seal.bind(s.custody);
  let interrupt = true;
  s.custody.seal = async (...args) => { if (interrupt) { interrupt = false; throw new Error("synthetic crash before sealing"); } return await seal(...args); };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, false);
  const op = (await findStored(s.core.bridges.records, id))!;
  assert.deepEqual(op.effects.map((effect) => [effect.role, effect.phase, effect.submissionAttempts]), [["approval", "signing_started", 0], ["bridge", "unsealed", 0]]);
  assert.equal(await s.custody.load(op, "approval"), null); assert.equal(s.source.submissions.length, 0);
  return { s, id, op };
}

test("sign-step wedge: signing_started without material or SEND claim re-seals the identical envelope and continues", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { s, id, op } = await interruptedSeal(temporary.root);
  // Before the fix every resume threw bridge_committed_signing_material_missing and the wallet stayed blocked.
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const completed = (await findStored(s.core.bridges.records, id))!;
  assert.equal(completed.state, "completed"); assert.equal(s.source.submissions.length, 2);
  // RFC 6979 signing of the unchanged envelope gives the same bytes the interrupted seal would have produced.
  const e = op.effects[0]!.envelope, c = e.economics;
  const expected = await privateKeyToAccount(LIFI_SYNTHETIC_KEY).signTransaction({ type: "eip1559", chainId: e.chainId, to: e.to, data: e.data,
    value: BigInt(e.valueAtomic), nonce: Number(c.nonceAtomic), gas: BigInt(c.gasLimitAtomic), maxFeePerGas: BigInt(c.maxFeePerGasAtomic),
    maxPriorityFeePerGas: BigInt(c.maxPriorityFeePerGasAtomic), accessList: [] });
  assert.equal(completed.effects[0]!.transactionHash, keccak256(expected)); assert.equal(s.source.submissions[0], expected);
});

test("sign-step wedge: an interrupted seal past the deadline ends failed_before_effect without signing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { s, id, op } = await interruptedSeal(temporary.root);
  s.now.setTime(Date.parse(op.intent.expiresAt) + 1); const loads = s.wrapping.loads;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const ended = (await findStored(s.core.bridges.records, id))!;
  assert.equal(ended.state, "failed_before_effect"); assert.equal(ended.terminal, true);
  assert.equal(ended.effects[0]!.phase, "unsealed"); assert.equal(s.source.submissions.length, 0); assert.equal(s.wrapping.loads, loads);
});

test("sign-step wedge: a SEND claim keeps its observe-only path and is never re-signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { s, id, op } = await interruptedSeal(temporary.root);
  const e = op.effects[0]!.envelope, c = e.economics;
  const rawTransaction = await privateKeyToAccount(LIFI_SYNTHETIC_KEY).signTransaction({ type: "eip1559", chainId: e.chainId, to: e.to, data: e.data,
    value: BigInt(e.valueAtomic), nonce: Number(c.nonceAtomic), gas: BigInt(c.gasLimitAtomic), maxFeePerGas: BigInt(c.maxFeePerGasAtomic),
    maxPriorityFeePerGas: BigInt(c.maxPriorityFeePerGasAtomic), accessList: [] });
  const body = { schemaVersion: "apn.bridge-effect.v1" as const, profileHash: op.profileHash, operationId: op.operationId, role: "approval" as const,
    fingerprint: op.fingerprint, envelopeHash: e.envelopeHash, rawTransaction, transactionHash: keccak256(rawTransaction) };
  await new BridgeEffectClaims(temporary.root).claim(op, "approval", "send", { ...body, materialHash: hashObject(body) });
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, false); assert.equal(resumed.error?.details?.reason, "bridge_effect_send_claim_unresolved");
  const held = (await findStored(s.core.bridges.records, id))!;
  assert.equal(held.effects[0]!.phase, "signing_started"); assert.equal(held.terminal, false); assert.equal(s.source.submissions.length, 0);
  assert.equal(await s.custody.load(held, "approval"), null);
});
