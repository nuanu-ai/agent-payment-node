import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import type { GaslessIntent } from "../../src/gasless/model.js";
import { newGaslessOperation } from "../../src/gasless/transitions.js";
import { gaslessEnvelopeBinding } from "../../src/gasless/wire.js";
import { OperationService } from "../../src/operation-service.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

/** Rewrites the saved operation exactly as an earlier release with other constants would have sealed it. */
async function savedByEarlierRelease(root: string, s: Awaited<ReturnType<typeof gaslessFixture>>, id: string,
  change: (intent: GaslessIntent) => GaslessIntent) {
  const current = await s.record(id);
  const { unsignedEnvelopeHash: _hash, ...body } = change(current.intent);
  const intent = { ...body, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(body)) } as GaslessIntent;
  const earlier = newGaslessOperation({ profileHash: current.profileHash, operationId: id,
    idempotencyHash: current.idempotencyHash, requestHash: current.requestHash, intent });
  await rm(join(root, "gasless-operations", current.profileHash, `${id}.json`));
  await rm(join(root, "gasless-receipts", current.profileHash, `${id}.json`));
  await s.core.gasless.records.persist(earlier);
  return earlier;
}

test("a record saved under earlier protocol pins keeps loading and only its next effect is refused", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  await savedByEarlierRelease(temporary.root, s, id, intent => ({ ...intent,
    initialSnapshot: { ...intent.initialSnapshot, protocolHash: hashObject("earlier-release-protocol-pins") } }));

  // Status, the shared operation lookup and every other lookup keep working; nothing reports a corrupt state.
  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, true, status.error?.message);
  assert.equal((await new OperationService(s.state).required(id)).kind, "gasless_transfer");
  const other = await s.core.execute({ command: "operation.status", operationId: hashObject("another-operation") });
  assert.equal(other.ok, false); assert.equal(other.error?.code, "APN_OPERATION_NOT_FOUND");

  // The changed pin refuses the new effect before any owner material exists.
  const approved = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(approved.ok, true, approved.error?.message);
  const record = await s.record(id);
  assert.equal(record.state, "failed_before_effect"); assert.equal(record.failure, "gasless_protocol_upgraded");
  assert.equal(record.bootstrap.signingAttempts, 0); assert.equal(s.wrapping.loads, 0); assert.equal(s.rpc.sends.length, 0);
  await new OperationService(s.state).assertProfileAvailable(record.profileHash);
});

test("a record whose saved offer predates the current gas calibration loads and is refused at action time", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  await savedByEarlierRelease(temporary.root, s, id, intent => ({ ...intent,
    gas: { ...intent.gas, callGasLimit: (BigInt(intent.gas.callGasLimit) - 1n).toString() } }));
  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, true, status.error?.message);
  const approved = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(approved.ok, true, approved.error?.message);
  const record = await s.record(id);
  assert.equal(record.state, "failed_before_effect"); assert.equal(record.failure, "gasless_offer_outdated");
  assert.equal(record.bootstrap.signingAttempts, 0); assert.equal(s.rpc.sends.length, 0);
  assert.deepEqual(s.wait.waits, [], "a saved offer cannot change by waiting");
});

test("a tampered saved intent is still refused on load by its own envelope hash", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id, operation } = await s.prepare();
  const tampered = { ...operation.intent, recipientAtomic: (BigInt(operation.intent.recipientAtomic) + 1n).toString() };
  assert.throws(() => newGaslessOperation({ profileHash: operation.profileHash, operationId: id,
    idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash, intent: tampered }), { code: "APN_STATE_CORRUPT" });
});
