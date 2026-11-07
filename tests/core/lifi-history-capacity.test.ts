import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { BRIDGE_FILE_LIMIT, BRIDGE_TERMINAL_FILE_LIMIT, bridgeCapacityRefusal, bridgeHistoryAdmits,
  bridgeTransitionKind } from "../../src/lifi/history-capacity.js";
import { BRIDGE_TERMINAL, bridgeSnapshot, sealBridgeOperation, type BridgeMutable, type BridgeObservationTelemetry,
  type BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { bridgeAtTransition, transitionBridge } from "../../src/lifi/transitions.js";
import { OperationService } from "../../src/operation-service.js";
import { LIFI_DESTINATION_HASH, lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";

const bytes = (op: BridgeOperationRecord) => Buffer.byteLength(canonicalJson(op), "utf8") + 1;
/**
 * One appended transition exactly as transitionBridge builds it, without its capacity rules: what an earlier release
 * wrote. Its integrity hash is stale (same length) until `sealed`, so long histories are built without rehashing each step.
 */
function appended(op: BridgeOperationRecord, patch: Partial<BridgeMutable>): BridgeOperationRecord {
  const next = { ...op, ...patch } as BridgeOperationRecord;
  const entry = { ...bridgeSnapshot(next), at: op.updatedAt, previousHash: op.transitions.at(-1)!.transitionHash };
  return { ...next, terminal: BRIDGE_TERMINAL.includes(next.state),
    transitions: [...op.transitions, { ...entry, transitionHash: hashObject(entry) }] };
}
function sealed(op: BridgeOperationRecord): BridgeOperationRecord {
  const { integrityHash: _old, ...body } = op;
  return sealBridgeOperation(body);
}
const written = (op: BridgeOperationRecord, patch: Partial<BridgeMutable>) => sealed(appended(op, patch));
/** A destination read that failed with different details on every resume: each one was a new ordinary transition. */
const flaky = (n: number): Partial<BridgeMutable> => ({ state: "unknown_finality", failure: {
  reason: "destination_observation_unavailable", residualAllowance: null, observationRpc: {
    schemaVersion: "apn.bridge-observation-rpc-failure.v1", stage: "destination_receipt", effectRole: "bridge",
    code: "APN_RPC_PROTOCOL", reason: "bridge_RPC_HTTP_status", rpcMethod: "eth_getTransactionReceipt",
    httpStatus: 500 + (n % 100), attempts: 1 + (n % 10) } } });
/** A pre-sign guard deferral flipping between rate limited and unavailable: ordinary transitions of about 2 KiB. */
const deferred = (n: number): Partial<BridgeMutable> => ({ failure: { residualAllowance: null,
  reason: n % 2 === 0 ? "pre_sign_rpc_rate_limited" : "pre_sign_rpc_unavailable" } });
const big = 9_007_199_254_740_991;
const rows: BridgeObservationTelemetry[] = Array.from({ length: 8 }, () => ({ schemaVersion: "apn.bridge-observation-telemetry.v1",
  stage: "residual_observation", effectRole: "bridge", outcome: "failure", physicalRequests: 10_000, httpAttempts: 10_000,
  logicalRpcItems: 100_000, batchCount: 10_000, maxBatchSize: 33, budgetRejectedBeforeTransport: 10_000,
  attemptsByEndpointRole: { primary: big, receipt: big, archive: big }, attemptsByMethodClass: { chain: big, transaction: big,
    receipt: big, block: big, code: big, storage: big, call: big, logs: big, other: big } }));
const refused = (reason: string) => (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" &&
  error.message === `Bridge validation failed: ${reason}.`;

async function completedRecord(root: string): Promise<BridgeOperationRecord> {
  const s = await lifiFixture(root, "base-arb"), { id } = await s.prepare();
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const op = (await findStored(s.core.bridges.records, id))!; assert.equal(op.state, "completed");
  return op;
}

test("a bridge whose journal reached the file bound still records its closing proofs and completes through resume", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "base-arb");
  s.destination.destinationAvailable = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  let op = (await findStored(s.core.bridges.records, id))!; assert.equal(op.state, "destination_pending");
  // Resumes on a flaky destination RPC, each adding one ordinary transition, until the next one is refused for room.
  let n = 0;
  for (let next = appended(op, flaky(n)); bridgeCapacityRefusal("ordinary", next, false) === null; next = appended(op, flaky(++n))) op = next;
  op = sealed(op);
  assert.ok(op.transitions.length > 60 && op.transitions.length < 512, `${op.transitions.length}`);
  assert.equal(validateBridgeOperation(op), op); assert.ok(bytes(op) <= BRIDGE_FILE_LIMIT - 128 * 1024);
  assert.throws(() => transitionBridge(op, flaky(n), op.updatedAt), refused("bridge_record_capacity"));
  const path = join(temporary.root, "bridge-operations", op.profileHash, `${id}.json`);
  await writeFile(path, `${canonicalJson(op)}\n`);
  // A real resume whose only change is a state flip is refused and changes nothing.
  const flip = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(flip.ok, false); assert.equal(flip.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(flip.error?.message, "Bridge validation failed: bridge_record_capacity.");
  assert.equal(hashObject(await findStored(s.core.bridges.records, id)), hashObject(op));
  // The destination lands: the settled provider hint is closing, the destination proof lands with the end it decides.
  s.destination.destinationAvailable = true; s.provider.statusValue = "completed_observed";
  const done = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(done.ok, true, done.error?.message);
  const completed = (await findStored(s.core.bridges.records, id))!;
  assert.equal(completed.state, "completed"); assert.equal(completed.terminal, true); assert.ok(bytes(completed) <= BRIDGE_FILE_LIMIT);
  const added = completed.transitions.slice(op.transitions.length);
  assert.deepEqual(added.map((entry, index) => bridgeTransitionKind(index === 0 ? op.transitions.at(-1)! : added[index - 1]!, entry)),
    ["closing", "terminal"]);
  assert.notEqual(completed.transitions.at(-1)!.destinationProof, null); assert.equal(completed.transitions.at(-2)!.destinationProof, null);
  await new OperationService(s.state).assertProfileAvailable(completed.profileHash);
});

test("a journal an earlier release filled to the file limit still takes its terminal transition, without its telemetry", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const completed = await completedRecord(temporary.root);
  const start = bridgeAtTransition(completed, completed.transitions.findIndex((entry) => entry.state === "execution_pending"));
  const end: Partial<BridgeMutable> = { state: "failed_before_effect", observationTelemetry: rows,
    failure: { reason: "unsent_apn_operation_blocked", residualAllowance: null } };
  // Filled with no reserve, as before: stop once the terminal transition with its telemetry no longer fits the file.
  let op = start, n = 0;
  const step = bytes(appended(appended(start, deferred(0)), deferred(1))) - bytes(appended(start, deferred(0)));
  const coarse = (BRIDGE_FILE_LIMIT - bytes(appended(start, end))) / step - 4;
  while (n < coarse) op = appended(op, deferred(n++));
  for (; appended(op, end).transitions.length <= 512 && bytes(appended(op, end)) <= BRIDGE_FILE_LIMIT; n++) op = appended(op, deferred(n));
  op = sealed(op); assert.ok(bytes(op) <= BRIDGE_FILE_LIMIT); assert.equal(validateBridgeOperation(op), op);
  assert.ok(bytes(written(op, { ...end, observationTelemetry: [] })) <= BRIDGE_FILE_LIMIT, "fixture: fits without telemetry");
  assert.throws(() => transitionBridge(op, deferred(n), op.updatedAt), refused("bridge_record_capacity"));
  const ended = transitionBridge(op, end, op.updatedAt);
  assert.equal(ended.state, "failed_before_effect"); assert.equal(ended.terminal, true); assert.ok(bytes(ended) <= BRIDGE_FILE_LIMIT);
  assert.deepEqual(ended.observationTelemetry, []); assert.deepEqual(ended.transitions.at(-1)!.observationTelemetry, []);
  assert.equal(validateBridgeOperation(ended), ended);
});

test("past 512 transitions a journal admits only closing ones, and its last slot only the terminal one", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const completed = await completedRecord(temporary.root);
  const proven = completed.transitions.findIndex((entry) => entry.destinationProof !== null);
  assert.equal(proven, completed.transitions.length - 1, "the proof and its end are one transition");
  // A journal of 512 transitions ending before the destination proof, as a release without closing room could leave it.
  let full = bridgeAtTransition(completed, proven - 1), n = 0;
  for (; full.transitions.length < 512; n++) full = appended(full, flaky(n));
  full = sealed(full); assert.equal(validateBridgeOperation(full), full);
  assert.throws(() => transitionBridge(full, flaky(n), full.updatedAt), refused("bridge_history_capacity"));
  // The proof and completion are admitted as one 513th transition, and as 0.5.96 recorded them, a closing proof then the end.
  const { at: _at, previousHash: _previous, transitionHash: _hash, ...end } = completed.transitions[proven]!;
  const tail = (from: BridgeOperationRecord) => written(from, { ...end,
    effects: end.effects.map(({ envelopeHash: _h, ...e }, i) => ({ ...e, envelope: from.effects[i]!.envelope })) });
  const closed = tail(full), twoStep = tail(written(full, { destinationProof: end.destinationProof }));
  assert.equal(closed.transitions.length, 513); assert.equal(closed.state, "completed"); assert.equal(validateBridgeOperation(closed), closed);
  assert.equal(twoStep.transitions.length, 514); assert.equal(validateBridgeOperation(twoStep), twoStep);
  assert.throws(() => validateBridgeOperation(tail(written(full, flaky(n)))), { code: "APN_STATE_CORRUPT" });
  assert.deepEqual([bridgeHistoryAdmits("ordinary", 512), bridgeHistoryAdmits("ordinary", 513), bridgeHistoryAdmits("closing", 519),
    bridgeHistoryAdmits("closing", 520), bridgeHistoryAdmits("terminal", 520), bridgeHistoryAdmits("terminal", 521)],
  [true, false, true, false, true, false]);
});

/** A journal 0.5.96 filled: every change was appended until the next one would pass 1 MiB, leaving less than one copy. */
async function filledByOldWriter(root: string, pair: "base-arb" | "eth-bnb") {
  const s = await lifiFixture(root, pair); s.destination.destinationAvailable = false;
  if (pair === "eth-bnb") { s.provider.statusValue = "completed_observed"; s.destination.destinationCompositeOutcome = "recovered_weth"; }
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  let op = (await findStored(s.core.bridges.records, id))!, n = 0; assert.equal(op.state, "destination_pending");
  for (let next = appended(op, flaky(n)); bytes(next) <= BRIDGE_FILE_LIMIT; next = appended(op, flaky(++n))) op = next;
  op = sealed(op); assert.equal(validateBridgeOperation(op), op);
  assert.ok(BRIDGE_FILE_LIMIT - bytes(op) < Buffer.byteLength(canonicalJson(op.transitions.at(-1))), "less than one copy of room");
  await writeFile(join(root, "bridge-operations", op.profileHash, `${id}.json`), `${canonicalJson(op)}\n`);
  s.destination.destinationAvailable = true;
  return { s, id, op };
}

test("a journal 0.5.96 filled to 1 MiB still ends: completed on delivery, destination_failed on the BNB recovered path", async (t) => {
  for (const pair of ["base-arb", "eth-bnb"] as const) await t.test(pair, async (child) => {
    const temporary = await temporaryState(); child.after(temporary.cleanup);
    const { s, id, op } = await filledByOldWriter(temporary.root, pair); s.provider.statusValue = "completed_observed";
    const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
    const ended = (await findStored(s.core.bridges.records, id))!;
    assert.equal(ended.state, pair === "base-arb" ? "completed" : "destination_failed"); assert.equal(ended.terminal, true);
    if (pair === "eth-bnb") assert.equal(ended.failure?.reason, "recovered_weth");
    // One terminal transition holds the proof, the end and the settled hint there was no room to save on its own.
    assert.equal(ended.transitions.length, op.transitions.length + 1); assert.notEqual(ended.destinationProof, null);
    assert.equal(ended.providerObservation?.status, "completed_observed");
    assert.ok(bytes(ended) > BRIDGE_FILE_LIMIT && bytes(ended) <= BRIDGE_TERMINAL_FILE_LIMIT, `${bytes(ended)}`);
    await new OperationService(s.state).assertProfileAvailable(ended.profileHash);
  });
});

test("a provider hint that keeps changing uses up the closing room but cannot keep the delivered bridge from ending", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "base-arb");
  s.destination.destinationAvailable = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  let op = (await findStored(s.core.bridges.records, id))!, n = 0;
  for (let next = appended(op, flaky(n)); bridgeCapacityRefusal("ordinary", next, false) === null; next = appended(op, flaky(++n))) op = next;
  op = sealed(op); await writeFile(join(temporary.root, "bridge-operations", op.profileHash, `${id}.json`), `${canonicalJson(op)}\n`);
  const lengths: number[] = [];
  for (let flap = 0; flap < 16; flap++) {
    s.provider.hint = `0x${(flap % 2 === 0 ? "a1" : "b2").repeat(32)}`;
    assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, false);
    lengths.push((await findStored(s.core.bridges.records, id))!.transitions.length);
  }
  assert.ok(lengths[0]! > op.transitions.length && lengths.at(-1) === lengths.at(-2), `${op.transitions.length} ${lengths}`);
  s.provider.hint = LIFI_DESTINATION_HASH; s.provider.statusValue = "completed_observed"; s.destination.destinationAvailable = true;
  const done = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(done.ok, true, done.error?.message);
  const completed = (await findStored(s.core.bridges.records, id))!;
  assert.equal(completed.state, "completed"); assert.equal(completed.transitions.length, lengths.at(-1)! + 1);
  assert.equal(completed.providerObservation?.destinationTransactionHash, LIFI_DESTINATION_HASH);
});
