import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { BRIDGE_FILE_LIMIT, BRIDGE_OPEN_FILE_LIMIT, BRIDGE_TERMINAL_FILE_LIMIT, bridgeCapacityRefusal, bridgeHistoryAdmits,
  bridgeTransitionKind } from "../../src/lifi/history-capacity.js";
import type { BridgeMutable, BridgeObservationTelemetry, BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { BridgeOperationRepository } from "../../src/lifi/operation-repository.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { bridgeAtTransition, transitionBridge } from "../../src/lifi/transitions.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { OperationService } from "../../src/operation-service.js";
import { addedKinds, appended, bridgeSafe, bytes, deferred, flaky, refused, sealed, sourceFlaky, stoppedSend, withDeferrals,
  written } from "./lifi-capacity-helpers.js";
import { LIFI_DESTINATION_HASH, lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";

const big = 9_007_199_254_740_991;
const rows: BridgeObservationTelemetry[] = Array.from({ length: 8 }, () => ({ schemaVersion: "apn.bridge-observation-telemetry.v1",
  stage: "residual_observation", effectRole: "bridge", outcome: "failure", physicalRequests: 10_000, httpAttempts: 10_000,
  logicalRpcItems: 100_000, batchCount: 10_000, maxBatchSize: 33, budgetRejectedBeforeTransport: 10_000,
  attemptsByEndpointRole: { primary: big, receipt: big, archive: big }, attemptsByMethodClass: { chain: big, transaction: big,
    receipt: big, block: big, code: big, storage: big, call: big, logs: big, other: big } }));

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

/**
 * A journal 0.5.96 filled while the bridge transaction was included but not yet safe: no reserve kept, at least `room`
 * bytes but less than one more copy left under 1 MiB, and its first safe source proof (a closing transition) to record.
 */
async function filledBeforeSafeSource(root: string, pair: "base-arb" | "eth-bnb", room: number) {
  const s = await lifiFixture(root, pair); s.source.safeBridge = false; s.destination.destinationAvailable = false;
  if (pair === "eth-bnb") s.destination.destinationCompositeOutcome = "recovered_weth";
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  let op = (await findStored(s.core.bridges.records, id))!, n = 0;
  assert.equal(op.effects.at(-1)!.phase, "included_success"); assert.equal(op.effects.at(-1)!.safeProof, null);
  for (let next = appended(op, sourceFlaky(n)); bytes(next) <= BRIDGE_FILE_LIMIT - room; next = appended(op, sourceFlaky(++n))) op = next;
  op = sealed(op); assert.equal(validateBridgeOperation(op), op);
  await writeFile(join(root, "bridge-operations", op.profileHash, `${id}.json`), `${canonicalJson(op)}\n`);
  s.source.safeBridge = true;
  return { s, id, op };
}

test("a journal 0.5.96 filled before the bridge was safe records that proof past 1 MiB and ends with the right outcome", async (t) => {
  for (const pair of ["base-arb", "eth-bnb"] as const) for (const room of [0, 24 * 1024]) await t.test(`${pair}, ${room} bytes kept`, async (child) => {
    const temporary = await temporaryState(); child.after(temporary.cleanup);
    const { s, id, op } = await filledBeforeSafeSource(temporary.root, pair, room);
    s.destination.destinationAvailable = true; s.provider.statusValue = "completed_observed";
    const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
    const ended = (await findStored(s.core.bridges.records, id))!;
    assert.equal(ended.state, pair === "base-arb" ? "completed" : "destination_failed"); assert.equal(ended.terminal, true);
    if (pair === "eth-bnb") assert.equal(ended.failure?.reason, "recovered_weth");
    // The safe proof is its own closing transition; the hint with no room left is saved with the destination proof and the end.
    assert.deepEqual(addedKinds(op, ended), ["closing", "terminal"]);
    const proven = bridgeAtTransition(ended, op.transitions.length);
    assert.equal(bridgeSafe(proven), true); assert.equal(proven.providerObservation, null); assert.equal(proven.terminal, false);
    assert.ok(bytes(proven) <= BRIDGE_OPEN_FILE_LIMIT && bytes(ended) <= BRIDGE_TERMINAL_FILE_LIMIT, `${bytes(proven)} ${bytes(ended)}`);
    // 0.5.97 kept 32 KiB beside that proof, so every resume refused it (bridge_record_capacity) and the journal never ended.
    assert.ok(bytes(proven) + 32 * 1024 > BRIDGE_FILE_LIMIT, `${bytes(proven)}`);
    if (room === 0) assert.ok(bytes(proven) > BRIDGE_FILE_LIMIT, `${bytes(proven)}`);
    await new OperationService(s.state).assertProfileAvailable(ended.profileHash);
  });
});

test("past 1 MiB such a journal refuses ordinary changes and new hints without writing, and still ends on delivery", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, op } = await filledBeforeSafeSource(temporary.root, "base-arb", 0);
  s.provider.hint = null;
  // The proof is saved; the flip to destination_pending after it is ordinary and refused, so this resume reports it.
  const first = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(first.ok, false); assert.equal(first.error?.message, "Bridge validation failed: bridge_record_capacity.");
  const proven = (await findStored(s.core.bridges.records, id))!;
  assert.deepEqual(addedKinds(op, proven), ["closing"]); assert.equal(bridgeSafe(proven), true); assert.equal(proven.state, "source_pending");
  assert.ok(bytes(proven) > BRIDGE_FILE_LIMIT && bytes(proven) <= BRIDGE_OPEN_FILE_LIMIT, `${bytes(proven)}`);
  const status = await s.core.execute({ command: "operation.status", operationId: id }); assert.equal(status.ok, true, status.error?.message);
  assert.equal((status.operation as { terminal: boolean }).terminal, false);
  const again = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(again.error?.message, "Bridge validation failed: bridge_record_capacity.");
  assert.equal(hashObject(await findStored(s.core.bridges.records, id)), hashObject(proven));
  assert.throws(() => transitionBridge(proven, sourceFlaky(1), proven.updatedAt), refused("bridge_record_capacity"));
  const hint = { status: "pending" as const, destinationTransactionHash: LIFI_DESTINATION_HASH, observedAt: proven.updatedAt, responseHash: null };
  assert.throws(() => transitionBridge(proven, { providerObservation: hint }, proven.updatedAt), refused("bridge_record_capacity"));
  s.provider.hint = LIFI_DESTINATION_HASH; s.provider.statusValue = "completed_observed"; s.destination.destinationAvailable = true;
  const done = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(done.ok, true, done.error?.message);
  const completed = (await findStored(s.core.bridges.records, id))!;
  assert.equal(completed.state, "completed"); assert.deepEqual(addedKinds(proven, completed), ["terminal"]);
  assert.ok(bytes(completed) <= BRIDGE_TERMINAL_FILE_LIMIT, `${bytes(completed)}`);
});

test("a destination proof saved on its own, as 0.5.96 did, passes 1 MiB in a journal that release filled; its end follows", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const completed = await completedRecord(temporary.root);
  const proven = completed.transitions.findIndex((entry) => entry.destinationProof !== null);
  let full = bridgeAtTransition(completed, proven - 1), n = 0;
  for (let next = appended(full, flaky(n)); bytes(next) <= BRIDGE_FILE_LIMIT; next = appended(full, flaky(++n))) full = next;
  full = sealed(full); assert.equal(validateBridgeOperation(full), full);
  const { at: _at, previousHash: _previous, transitionHash: _hash, ...end } = completed.transitions[proven]!;
  const closed = transitionBridge(full, { destinationProof: end.destinationProof }, full.updatedAt);
  assert.deepEqual(addedKinds(full, closed), ["closing"]); assert.equal(closed.terminal, false);
  assert.ok(bytes(closed) > BRIDGE_FILE_LIMIT && bytes(closed) <= BRIDGE_OPEN_FILE_LIMIT, `${bytes(closed)}`);
  const ended = transitionBridge(closed, { state: "completed", failure: end.failure }, closed.updatedAt);
  assert.equal(ended.state, "completed"); assert.ok(bytes(ended) <= BRIDGE_TERMINAL_FILE_LIMIT); assert.equal(validateBridgeOperation(ended), ended);
  // Neither a repeatable change nor a hint naming another transaction may take that room.
  assert.throws(() => transitionBridge(full, flaky(n), full.updatedAt), refused("bridge_record_capacity"));
  const other = { ...full.providerObservation!, destinationTransactionHash: `0x${"a1".repeat(32)}` as const };
  assert.throws(() => transitionBridge(full, { providerObservation: other }, full.updatedAt), refused("bridge_record_capacity"));
});

test("a journal 0.5.96 filled to 512 transitions before the bridge was safe takes its proof past 512 and ends", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "eth-bnb");
  s.source.safeBridge = false; s.destination.destinationAvailable = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const sent = (await findStored(s.core.bridges.records, id))!, pending = sent.transitions.findIndex((entry) => entry.state === "execution_pending");
  // Pre-sign guard deferrals (small copies) before the send, then the send itself, as 0.5.96 could journal them under 1 MiB.
  let full = bridgeAtTransition(sent, pending), n = 0;
  while (full.transitions.length + sent.transitions.length - pending - 1 < 512) full = appended(full, deferred(n++));
  for (const { at: _at, previousHash: _previous, transitionHash: _hash, ...entry } of sent.transitions.slice(pending + 1)) {
    full = appended(full, { ...entry, effects: entry.effects.map(({ envelopeHash: _h, ...e }, i) => ({ ...e, envelope: full.effects[i]!.envelope })) });
  }
  full = sealed(full); assert.equal(validateBridgeOperation(full), full);
  assert.equal(full.transitions.length, 512); assert.ok(bytes(full) <= BRIDGE_FILE_LIMIT, `${bytes(full)}`); assert.equal(bridgeSafe(full), false);
  assert.throws(() => transitionBridge(full, sourceFlaky(0), full.updatedAt), refused("bridge_history_capacity"));
  await writeFile(join(temporary.root, "bridge-operations", full.profileHash, `${id}.json`), `${canonicalJson(full)}\n`);
  s.source.safeBridge = true; s.destination.destinationAvailable = true; s.provider.statusValue = "completed_observed";
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const ended = (await findStored(s.core.bridges.records, id))!;
  // The proof is the 513th transition and the settled hint, with room to spare, the 514th; the end is the 515th.
  assert.equal(ended.state, "completed"); assert.deepEqual(addedKinds(full, ended), ["closing", "closing", "terminal"]);
  assert.equal(bridgeSafe(ended.transitions[512]!), true); assert.equal(ended.transitions[512]!.providerObservation, null);
});

test("the reader holds an open journal to 1.5 MiB and a finished one to 1 MiB + 576 KiB", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const completed = await completedRecord(temporary.root);
  const proven = completed.transitions.findIndex((entry) => entry.destinationProof !== null);
  const { at: _at, previousHash: _previous, transitionHash: _hash, ...end } = completed.transitions[proven]!;
  const ended = (from: BridgeOperationRecord) => written(from, { ...end,
    effects: end.effects.map(({ envelopeHash: _h, ...e }, i) => ({ ...e, envelope: from.effects[i]!.envelope })) });
  const records = new BridgeOperationRepository(temporary.root);
  const load = async (op: BridgeOperationRecord) => {
    await writeFile(join(temporary.root, "bridge-operations", op.profileHash, `${op.operationId}.json`), `${canonicalJson(op)}\n`);
    return await records.loadOperation(op.profileHash, op.operationId);
  };
  // Built with no capacity rules at all: only the reader's hard bounds decide.
  let open = bridgeAtTransition(completed, proven - 1), n = 0;
  for (let next = appended(open, flaky(n)); bytes(next) <= BRIDGE_OPEN_FILE_LIMIT; next = appended(open, flaky(++n))) open = next;
  open = sealed(open); assert.equal((await load(open))?.integrityHash, open.integrityHash);
  await assert.rejects(load(written(open, flaky(n))), { code: "APN_STATE_CORRUPT" });
  const finished = ended(open); assert.ok(bytes(finished) > BRIDGE_OPEN_FILE_LIMIT && bytes(finished) <= BRIDGE_TERMINAL_FILE_LIMIT);
  assert.equal((await load(finished))?.state, "completed");
  let over = open;
  for (; bytes(ended(over)) <= BRIDGE_TERMINAL_FILE_LIMIT; n++) over = appended(over, flaky(n));
  await assert.rejects(load(ended(sealed(over))), { code: "APN_STATE_CORRUPT" });
  assert.deepEqual([BRIDGE_OPEN_FILE_LIMIT, BRIDGE_TERMINAL_FILE_LIMIT], [1536 * 1024, 1024 * 1024 + 576 * 1024]);
});

test("a reorg of the unsafe bridge inclusion in a journal 0.5.96 filled is recorded past 1 MiB, and the bridge still ends", async (t) => {
  for (const outcome of ["completed", "failed_confirmed_revert"] as const) await t.test(outcome, async (child) => {
    const temporary = await temporaryState(); child.after(temporary.cleanup);
    const { s, id, op } = await filledBeforeSafeSource(temporary.root, "base-arb", 0);
    // The inclusion moved to another block before it was safe; there it succeeded again, or reverted.
    s.source.changedBlock = true; if (outcome === "failed_confirmed_revert") s.source.reverted.add("bridge");
    s.destination.destinationAvailable = true; s.provider.statusValue = "completed_observed";
    const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
    const ended = (await findStored(s.core.bridges.records, id))!;
    assert.equal(ended.state, outcome); assert.deepEqual(addedKinds(op, ended), ["closing", "closing", "terminal"]);
    // The lost inclusion is its own transition, as the phase rules require before a revert; the safe proof follows it.
    const lost = ended.transitions[op.transitions.length]!.effects.at(-1)!, proven = ended.transitions[op.transitions.length + 1]!.effects.at(-1)!;
    assert.deepEqual([lost.phase, lost.includedProof], ["unknown_finality", null]);
    assert.notEqual(proven.safeProof!.block.hash, op.effects.at(-1)!.includedProof!.block.hash);
    assert.ok(bytes(ended) > BRIDGE_FILE_LIMIT && bytes(ended) <= BRIDGE_TERMINAL_FILE_LIMIT, `${bytes(ended)}`);
  });
});

test("past the line a lost inclusion cannot repeat: the unsafe re-inclusion after it is refused, its safe proof is not", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, op } = await filledBeforeSafeSource(temporary.root, "base-arb", 0);
  s.source.changedBlock = true; s.source.safeBridge = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const refusedResume = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(refusedResume.error?.message, "Bridge validation failed: bridge_record_capacity.");
    const stored = (await findStored(s.core.bridges.records, id))!;
    assert.deepEqual(addedKinds(op, stored), ["closing"]); assert.equal(stored.effects.at(-1)!.includedProof, null);
  }
  s.source.safeBridge = true; s.destination.destinationAvailable = true; s.provider.statusValue = "completed_observed";
  const done = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(done.ok, true, done.error?.message);
  const ended = (await findStored(s.core.bridges.records, id))!;
  assert.equal(ended.state, "completed"); assert.deepEqual(addedKinds(op, ended), ["closing", "closing", "terminal"]);
});

/**
 * A journal 0.5.96 filled with pre-sign deferrals (to 1 MiB, or to 512 transitions where copies are small) whose last
 * transition marks an effect signing_started: the process died before custody sealed anything.
 */
async function filledAtUnsignedSeal(root: string, pair: "base-arb" | "eth-bnb") {
  const { s, id, stopped } = await stoppedSend(root, pair, "bridge", "signing_started", "after");
  const op = withDeferrals(stopped, stopped.transitions.length - 1, (next) => next.transitions.length <= 512 && bytes(next) <= BRIDGE_FILE_LIMIT);
  assert.equal(validateBridgeOperation(op), op); assert.equal(op.effects.at(-1)!.phase, "signing_started");
  await writeFile(join(root, "bridge-operations", op.profileHash, `${id}.json`), `${canonicalJson(op)}\n`);
  return { s, id, op };
}

test("a journal 0.5.96 filled at an unsigned seal waits until expiry, then ends with the release folded into its halt", async (t) => {
  for (const pair of ["base-arb", "eth-bnb"] as const) await t.test(pair, async (child) => {
    const temporary = await temporaryState(); child.after(temporary.cleanup); const { s, id, op } = await filledAtUnsignedSeal(temporary.root, pair);
    // The release (signing_started back to unsealed) is ordinary: refused for room, nothing changes, the next resume retries.
    const early = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(early.ok, false); assert.match(early.error?.message ?? "", /bridge_(record|history)_capacity/u);
    assert.equal(hashObject(await findStored(s.core.bridges.records, id)), hashObject(op));
    s.now.setTime(Date.parse(op.intent.expiresAt) + 1000);
    const late = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(late.ok, true, late.error?.message);
    const ended = (await findStored(s.core.bridges.records, id))!;
    assert.equal(ended.state, pair === "base-arb" ? "failed_after_approval" : "failed_before_effect");
    assert.equal(ended.failure?.reason, "unsent_apn_reprepare_required"); assert.deepEqual(addedKinds(op, ended), ["terminal"]);
    assert.equal(ended.effects.at(-1)!.phase, "unsealed"); assert.ok(bytes(ended) <= BRIDGE_TERMINAL_FILE_LIMIT, `${bytes(ended)}`);
    await new OperationService(s.state).assertProfileAvailable(ended.profileHash);
  });
});

test("salvage reads a damaged bridge journal past 1 MiB under the bridge bound instead of calling it record_not_json", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, op } = await filledBeforeSafeSource(temporary.root, "base-arb", 0);
  let big = op, n = 0;
  for (; bytes(big) <= BRIDGE_FILE_LIMIT + 64 * 1024; n++) big = appended(big, sourceFlaky(n));
  // Canonical JSON whose binding the bridge reader refuses: the index quarantines it and salvages what it names.
  await writeFile(join(temporary.root, "bridge-operations", op.profileHash, `${id}.json`), `${canonicalJson({ ...big, integrityHash: "0".repeat(64) })}\n`);
  await assert.rejects(new OperationService(s.state).assertProfileAvailable(op.profileHash), { code: "APN_OPERATION_BLOCKED" });
  const entry = await new OperationIndex(s.state).find(id);
  assert.deepEqual([entry?.state, entry?.unreadableReason, entry?.idempotencyHash], ["unreadable", "record_invalid", op.idempotencyHash]);
});
