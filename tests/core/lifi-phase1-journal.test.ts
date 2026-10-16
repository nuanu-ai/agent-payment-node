import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { BridgeEffectClaims } from "../../src/lifi/effect-authority.js";
import { BRIDGE_TELEMETRY_ROWS, type BridgeObservationTelemetry, type BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

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
  let op = (await s.core.bridges.records.findOperation(id))!; const size = canonicalJson(op).length, transitions = op.transitions.length;
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
  const pending = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(pending.effects[0]!.phase, "included_success"); assert.equal(pending.effects[0]!.includedProof!.rpcOrigin, "https://rpc-8453.example");
  (s.source as { origin: string }).origin = "https://base-replacement.example";
  (s.destination as { origin: string }).origin = "https://arbitrum-replacement.example";
  s.source.safeApproval = true;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const completed = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(completed.state, "completed"); assert.equal(completed.intent.sourceRpcOrigin, "https://rpc-8453.example");
  assert.equal(completed.effects[0]!.safeProof!.rpcOrigin, "https://base-replacement.example");
  assert.equal(completed.destinationProof!.rpcOrigin, "https://arbitrum-replacement.example"); assert.equal(s.source.submissions.length, 2);
});

test("LIFI-11: every route claims SIGN and SEND; a journal restored to a sealed approval catches up and never resends", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "base-arb");
  const { id, operation } = await s.prepare();
  const opPath = join(temporary.root, "bridge-operations", operation.profileHash, `${id}.json`);
  const receiptPath = join(temporary.root, "bridge-receipts", operation.profileHash, `${id}.json`);
  let snapshot: { op: Buffer; receipt: Buffer; usage: Map<string, Buffer> } | undefined;
  const persist = s.core.bridges.records.persist.bind(s.core.bridges.records);
  s.core.bridges.records.persist = async (next) => {
    await persist(next);
    if (snapshot === undefined && next.effects[0]!.phase === "sealed") snapshot = { op: await readFile(opPath), receipt: await readFile(receiptPath),
      usage: await files(join(temporary.root, "asset-usage")) };
  };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const completed = (await s.core.bridges.records.findOperation(id))!, claims = new BridgeEffectClaims(temporary.root);
  assert.equal(completed.state, "completed"); assert.equal(s.source.submissions.length, 2);
  for (const role of ["approval", "bridge"] as const) assert.equal((await claims.sendClaim(completed, role))?.transactionHash,
    completed.effects.find((effect) => effect.role === role)!.transactionHash);
  // Restore the journal and the usage ledger to the sealed, unsent approval: the SEND claims survive outside them, so APN
  // records each attempt and observes it instead of sending again, for both effects in turn.
  await writeFile(opPath, snapshot!.op); await writeFile(receiptPath, snapshot!.receipt); await restore(join(temporary.root, "asset-usage"), snapshot!.usage);
  for (let resume = 0; resume < 3; resume++) await s.core.execute({ command: "operation.resume", operationId: id });
  const caughtUp = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(caughtUp.state, "completed"); assert.equal(s.source.submissions.length, 2);
  assert.deepEqual(caughtUp.effects.map((effect) => effect.transactionHash), completed.effects.map((effect) => effect.transactionHash));
});
