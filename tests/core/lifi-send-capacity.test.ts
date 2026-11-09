import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { bridgeCapacityRefusal, bridgeSendRefusal, bridgeTransitionKind } from "../../src/lifi/history-capacity.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { bridgeAtTransition } from "../../src/lifi/transitions.js";
import { addedKinds, appended, bytes, stoppedSend, withDeferrals } from "./lifi-capacity-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";

// A LI.FI send whose journal met the ordinary line (1 MiB less 128 KiB, or 512 transitions) on its own, as the 0.5.97
// writer could: every transition below is one that writer admitted.
const ordinaryFits = (op: BridgeOperationRecord) => bridgeCapacityRefusal("ordinary", op, false) === null;
const claimPath = (root: string, op: BridgeOperationRecord, boundary: "sign" | "send", role: "approval" | "bridge") =>
  join(root, "bridge-effect-claims", op.profileHash, `${op.operationId}-${role}-${boundary}.json`);
async function store(root: string, op: BridgeOperationRecord): Promise<void> {
  assert.equal(validateBridgeOperation(op), op);
  await writeFile(join(root, "bridge-operations", op.profileHash, `${op.operationId}.json`), `${canonicalJson(op)}\n`);
}

test("an effect starts its send only with room for all of it below the ordinary bounds; refused, it expires into its halt", async (t) => {
  for (const pair of ["base-arb", "eth-bnb"] as const) await t.test(pair, async (child) => {
    const temporary = await temporaryState(); child.after(temporary.cleanup);
    // Just before the bridge's signing_started, where that one transition still fits but not the steps after it.
    const { s, id, stopped } = await stoppedSend(temporary.root, pair, "bridge", "signing_started", "after");
    const marked = withDeferrals(stopped, stopped.transitions.length - 1, ordinaryFits);
    const op = bridgeAtTransition(marked, marked.transitions.length - 2), submitted = s.source.submissions.length;
    assert.equal(op.effects.at(-1)!.phase, "unsealed"); assert.notEqual(bridgeSendRefusal(op, "bridge"), null);
    await rm(claimPath(temporary.root, op, "sign", "bridge")); await store(temporary.root, op);
    const early = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(early.ok, false); assert.match(early.error?.message ?? "", /bridge_(record|history)_capacity/u);
    // Refused before the SIGN claim: nothing is claimed, sealed or written.
    assert.equal(hashObject(await findStored(s.core.bridges.records, id)), hashObject(op));
    assert.equal(existsSync(claimPath(temporary.root, op, "sign", "bridge")), false); assert.equal(await s.custody.load(op, "bridge"), null);
    s.now.setTime(Date.parse(op.intent.expiresAt) + 1000);
    const late = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(late.ok, true, late.error?.message);
    const ended = (await findStored(s.core.bridges.records, id))!;
    assert.equal(ended.state, pair === "base-arb" ? "failed_after_approval" : "failed_before_effect");
    assert.equal(ended.failure?.reason, "unsent_apn_reprepare_required"); assert.equal(s.source.submissions.length, submitted);
  });
});

test("an effect sealed in custody whose sealed step met the ordinary line records it, then sends or expires into its halt", async (t) => {
  for (const late of [false, true]) await t.test(late ? "expired" : "in time", async (child) => {
    const temporary = await temporaryState(); child.after(temporary.cleanup);
    // Custody sealed the bridge, then the sealed save was refused: the journal stays at signing_started, with no SEND claim.
    const { s, id, stopped } = await stoppedSend(temporary.root, "base-arb", "bridge", "sealed", "before");
    const op = withDeferrals(stopped, stopped.transitions.length - 1, ordinaryFits), material = (await s.custody.load(op, "bridge"))!;
    assert.equal(op.effects.at(-1)!.phase, "signing_started"); assert.equal(existsSync(claimPath(temporary.root, op, "send", "bridge")), false);
    // As an ordinary transition (before this fix) that step was refused on every resume, before the expiry check could run.
    const step = appended(op, { effects: op.effects.map((e) => e.role !== "bridge" ? e
      : { ...e, phase: "sealed" as const, transactionHash: material.transactionHash, sealedMaterialHash: material.materialHash }) });
    assert.equal(bridgeCapacityRefusal("ordinary", step, false), "bridge_record_capacity");
    assert.equal(bridgeTransitionKind(op.transitions.at(-1)!, step.transitions.at(-1)!), "closing");
    await store(temporary.root, op); const submitted = s.source.submissions.length;
    if (late) s.now.setTime(Date.parse(op.intent.expiresAt) + 1000); else s.provider.statusValue = "completed_observed";
    const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
    const ended = (await findStored(s.core.bridges.records, id))!;
    if (late) {
      // Nothing was claimed for sending, so nothing was broadcast: the guard's expiry ends it, and the seal stays in custody.
      assert.equal(ended.state, "failed_after_approval"); assert.deepEqual(addedKinds(op, ended), ["closing", "terminal"]);
      assert.equal(ended.effects.at(-1)!.phase, "sealed"); assert.equal(s.source.submissions.length, submitted);
      assert.equal((await s.custody.load(op, "bridge"))?.materialHash, material.materialHash);
    } else {
      assert.equal(ended.state, "completed"); assert.equal(s.source.submissions.length, submitted + 1);
      assert.deepEqual(addedKinds(op, ended).slice(0, 3), ["closing", "closing", "closing"]);
    }
  });
});

test("an unrecorded SEND claim whose submitting step met the ordinary line is caught up and observed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // The SEND claim was written, the submitting save refused; nothing was broadcast, but the claim alone cannot show that.
  const { s, id, stopped } = await stoppedSend(temporary.root, "base-arb", "bridge", "submitting", "before");
  const start = stopped.transitions.findIndex((entry) => entry.effects.at(-1)!.phase === "signing_started");
  const op = withDeferrals(stopped, start, ordinaryFits), submitted = s.source.submissions.length;
  assert.equal(op.effects.at(-1)!.phase, "sealed"); assert.equal(existsSync(claimPath(temporary.root, op, "send", "bridge")), true);
  await store(temporary.root, op);
  // The claimed attempt is recorded (submitting, then unknown); only the observation's ordinary failure detail is refused.
  const first = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(first.error?.message, "Bridge validation failed: bridge_record_capacity.");
  const caught = (await findStored(s.core.bridges.records, id))!, bridge = caught.effects.at(-1)!;
  assert.deepEqual(addedKinds(op, caught), ["closing", "closing"]);
  assert.deepEqual([bridge.phase, bridge.submissionAttempts, bridge.transactionHash], ["unknown_finality", 1, op.effects.at(-1)!.transactionHash]);
  // Had those exact bytes reached the network (a restored journal), they are observed and the bridge completes; APN sends nothing.
  s.source.submissions.push((await s.custody.load(op, "bridge"))!.rawTransaction); s.provider.statusValue = "completed_observed";
  const done = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(done.ok, true, done.error?.message);
  assert.equal((await findStored(s.core.bridges.records, id))!.state, "completed"); assert.equal(s.source.submissions.length, submitted + 1);
});

test("the first effect to sign reserves room for the later one's send too, so an approval never goes out alone", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, id, stopped } = await stoppedSend(temporary.root, "base-arb", "approval", "signing_started", "after");
  // Before the approval's SIGN, filled until only its own four steps still fit: all the check asked before this fix
  // (the check for the last effect still counts only its own steps). The bridge's send would then have been refused.
  const pre = bridgeAtTransition(stopped, stopped.transitions.length - 2);
  const op = withDeferrals(pre, pre.transitions.length, (next) => bridgeSendRefusal(next, "bridge") === null);
  assert.equal(op.effects[0]!.phase, "unsealed"); assert.notEqual(bridgeSendRefusal(op, "approval"), null);
  await rm(claimPath(temporary.root, op, "sign", "approval")); await store(temporary.root, op);
  const early = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(early.ok, false); assert.match(early.error?.message ?? "", /bridge_(record|history)_capacity/u);
  assert.equal(hashObject(await findStored(s.core.bridges.records, id)), hashObject(op));
  assert.equal(existsSync(claimPath(temporary.root, op, "sign", "approval")), false); assert.equal(s.source.submissions.length, 0);
  // No approval was sent, so it ends with nothing spent instead of failed_after_approval with its gas and allowance.
  s.now.setTime(Date.parse(op.intent.expiresAt) + 1000);
  const late = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(late.ok, true, late.error?.message);
  assert.equal((await findStored(s.core.bridges.records, id))!.state, "failed_before_effect"); assert.equal(s.source.submissions.length, 0);
});

test("a restored 0.5.96 journal past the ordinary line with a surviving SEND claim records the claimed send and observes it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // The bridge was claimed for sending and sealed in custody; the journal restored from before its signing_started, which
  // 0.5.96 grew with no reserve to about 930 KiB (past the ordinary line), still holds it unsealed.
  const { s, id, stopped } = await stoppedSend(temporary.root, "base-arb", "bridge", "submitting", "before");
  const pre = bridgeAtTransition(stopped, stopped.transitions.findIndex((entry) => entry.effects.at(-1)!.phase === "signing_started") - 1);
  const op = withDeferrals(pre, pre.transitions.length, (next) => bytes(next) <= 930 * 1024), submitted = s.source.submissions.length;
  assert.equal(op.effects.at(-1)!.phase, "unsealed"); assert.equal(existsSync(claimPath(temporary.root, op, "send", "bridge")), true);
  assert.ok(bytes(op) + 128 * 1024 > 1024 * 1024, `${bytes(op)}`);
  await store(temporary.root, op);
  // signing_started, sealed, submitting and unknown_finality are recorded from the claim and custody; the observation's
  // own failure detail after them is ordinary and refused, as any ordinary change is there.
  const first = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(first.error?.message, "Bridge validation failed: bridge_record_capacity.");
  const caught = (await findStored(s.core.bridges.records, id))!, bridge = caught.effects.at(-1)!;
  assert.deepEqual(addedKinds(op, caught), ["closing", "closing", "closing", "closing"]);
  assert.deepEqual([bridge.phase, bridge.submissionAttempts, bridge.transactionHash], ["unknown_finality", 1, stopped.effects.at(-1)!.transactionHash]);
  assert.equal(s.source.submissions.length, submitted);
  // Once those exact bytes are seen on chain the bridge completes; APN never sends them itself.
  s.source.submissions.push((await s.custody.load(op, "bridge"))!.rawTransaction); s.provider.statusValue = "completed_observed";
  const done = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(done.ok, true, done.error?.message);
  assert.equal((await findStored(s.core.bridges.records, id))!.state, "completed"); assert.equal(s.source.submissions.length, submitted + 1);
});
