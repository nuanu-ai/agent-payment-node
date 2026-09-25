import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import { StateStore } from "../../src/state.js";
import { freezeRelayUnsignedOperation, RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { advanceRelayEffectJournal, createRelayEffectJournal, relayRecoveryClass,
  RelayEffectJournalRepository, validateRelayEffectJournal } from "../../src/relay/effect-journal.js";
import { validateRelayQuote } from "../../src/relay/quote.js";
import { temporaryState } from "./helpers.js";

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14".toLowerCase();
const recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7".toLowerCase();
const at = "2026-09-30T00:00:00.000Z";
const later = "2026-09-30T00:01:00.000Z";
const marker = "a".repeat(64);
const tx = `0x${"b".repeat(64)}`;
async function operation() {
  const fixture = JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
  const quote = await validateRelayQuote(fixture, { payer, recipient, amountAtomic: "2500000",
    minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 });
  return freezeRelayUnsignedOperation({ schemaVersion: "apn.relay-unsigned-operation.v1", kind: "relay_unsigned",
    state: "prepared", terminal: false, profileHash: "1".repeat(64), operationId: "2".repeat(64),
    idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64), sourceChainId: 1,
    destinationChainId: 56, sourceAccount: payer, recipient, quoteDigest: quote.quoteDigest, quote,
    policyDigest: "5".repeat(64), policyRevision: 1,
    approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei,
    amountAtomic: "2500000", minOutputAtomic: quote.minimumOutputWei,
    createdAt: at, deadline: new Date(quote.deadline * 1000).toISOString() });
}
function reseal(journal: ReturnType<typeof createRelayEffectJournal>, change: Record<string, unknown>) {
  const { integrityHash: _, ...body } = { ...journal, ...change };
  return { ...body, integrityHash: hashObject(body) };
}

test("Relay journal binds exact quote and envelope, and rejects changed binding even when resealed", async () => {
  const op = await operation(); const journal = createRelayEffectJournal(op, at);
  assert.equal(journal.orderId, op.quote!.orderId);
  assert.deepEqual(journal.approvalEnvelope, op.quote!.approval);
  assert.deepEqual(journal.depositEnvelope, op.quote!.deposit);
  assert.equal(relayRecoveryClass(journal, op), "not_started");
  for (const change of [{ quoteDigest: "0".repeat(64) }, { orderId: "0xwrong" },
    { sourceOwner: recipient }, { approvalEnvelope: { ...journal.approvalEnvelope, gas: "1" } },
    { depositEnvelope: { ...journal.depositEnvelope, to: recipient } }]) {
    assert.throws(() => validateRelayEffectJournal(reseal(journal, change), op), { code: "APN_STATE_CORRUPT" });
  }
});

test("Relay journal is create only, durable after reopen, and preserves one submission attempt", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const op = await operation();
  const prepared = new RelayUnsignedOperationRepository(temp.root);
  await prepared.initialize(); await prepared.persistLocked(op);
  const repo = new RelayEffectJournalRepository(temp.root);
  let journal = await repo.create(op.profileHash, op.operationId, at);
  const state = new StateStore(temp.root), operations = new OperationService(state);
  await assert.rejects(operations.assertProfileAvailable(op.profileHash), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(repo.create(op.profileHash, op.operationId, at), { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(await new RelayEffectJournalRepository(temp.root).load(op.profileHash, op.operationId), journal);
  journal = await repo.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "mark_submission", role: "approval", marker, at });
  assert.equal(relayRecoveryClass(journal, op), "observation_only");
  await assert.rejects(operations.assertProfileAvailable(op.profileHash), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(repo.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "mark_submission", role: "approval", marker: "c".repeat(64), at }), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(repo.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "mark_submission", role: "deposit", marker, at }), { code: "APN_OPERATION_BLOCKED" });
  const reopened = new RelayEffectJournalRepository(temp.root);
  assert.deepEqual(await reopened.load(op.profileHash, op.operationId), journal);
  const oldHash = journal.integrityHash;
  journal = await reopened.transition(op.profileHash, op.operationId, oldHash,
    { kind: "record_transaction", role: "approval", transactionHash: tx });
  await assert.rejects(repo.transition(op.profileHash, op.operationId, oldHash,
    { kind: "observe", role: "approval", outcome: "confirmed", at: later }), { code: "APN_OPERATION_BLOCKED" });
  journal = await repo.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "observe", role: "approval", outcome: "confirmed", at: later });
  assert.equal(relayRecoveryClass(journal, op), "approval_confirmed");
  journal = await repo.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "mark_submission", role: "deposit", marker: "d".repeat(64), at: later });
  assert.equal(relayRecoveryClass(journal, op), "observation_only");
  assert.throws(() => advanceRelayEffectJournal(journal, op,
    { kind: "mark_submission", role: "deposit", marker: "e".repeat(64), at: later }), { code: "APN_OPERATION_BLOCKED" });
  journal = await repo.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "observe", role: "deposit", outcome: "confirmed", at: later });
  assert.equal(relayRecoveryClass(journal, op), "completed");
  assert.deepEqual(await new RelayEffectJournalRepository(temp.root).load(op.profileHash, op.operationId), journal);
  await operations.assertProfileAvailable(op.profileHash);
  const status = await operations.relayStatus(op);
  assert.equal(status.state, "source_confirmed"); assert.equal(status.terminal, true);
  assert.equal(status.sourceEffectTerminal, true);
  assert.equal(status.sourceJournalIntegrityHash, journal.integrityHash);
  assert.equal(status.proofClass, "source_effect_confirmed");
  assert.equal("paidAcceptance" in status, false); assert.equal("destinationProof" in status, false);
  assert.equal("statusLocator" in status, false);
  await assert.rejects(repo.transition(op.profileHash, op.operationId, journal.integrityHash,
    { kind: "mark_submission", role: "deposit", marker: "e".repeat(64), at: later }),
  { code: "APN_OPERATION_BLOCKED" });
  const { quoteDigest: _digest, ...quoteFields } = op.quote!;
  const baseFields = { ...quoteFields, routeReference: "ethereum-usdc-base-eth-v1" as const,
    orderData: { ...quoteFields.orderData, inputs: [{ ...quoteFields.orderData.inputs[0]!, refunds: [
      quoteFields.orderData.inputs[0]!.refunds[0]!,
      { ...quoteFields.orderData.inputs[0]!.refunds[1]!, chainId: "base" as const } ] }],
      output: { ...quoteFields.orderData.output, chainId: "base" as const } } };
  const baseQuote = { ...baseFields, quoteDigest: hashObject(baseFields) };
  const other = freezeRelayUnsignedOperation((({ integrityHash: _, ...fields }) => ({ ...fields,
    operationId: "6".repeat(64), idempotencyHash: "7".repeat(64), requestHash: "8".repeat(64),
    destinationChainId: 8453 as const, quoteDigest: baseQuote.quoteDigest, quote: baseQuote }))(op));
  await prepared.persistLocked(other);
  await assert.rejects(operations.assertProfileAvailable(op.profileHash), {
    code: "APN_OPERATION_BLOCKED", details: { blockingOperationId: other.operationId, blockingState: "prepared" },
  });
  const path = join(temp.root, "relay-effect-journals", op.profileHash, `${op.operationId}.json`);
  const tampered = reseal(journal, { orderId: "changed" });
  await writeFile(path, `${JSON.stringify(tampered)}\n`);
  await assert.rejects(repo.load(op.profileHash, op.operationId), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(operations.assertProfileAvailable(op.profileHash), { code: "APN_STATE_CORRUPT" });
});

test("Relay effect phases reject skips and failures never permit another attempt", async () => {
  const op = await operation(); let journal = createRelayEffectJournal(op, at);
  assert.throws(() => advanceRelayEffectJournal(journal, op,
    { kind: "observe", role: "approval", outcome: "confirmed", at }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => advanceRelayEffectJournal(journal, op,
    { kind: "record_transaction", role: "approval", transactionHash: tx }), { code: "APN_OPERATION_BLOCKED" });
  journal = advanceRelayEffectJournal(journal, op, { kind: "mark_submission", role: "approval", marker, at });
  journal = advanceRelayEffectJournal(journal, op, { kind: "observe", role: "approval", outcome: "failed", at: later });
  assert.equal(relayRecoveryClass(journal, op), "failed");
  assert.throws(() => advanceRelayEffectJournal(journal, op,
    { kind: "mark_submission", role: "approval", marker: "c".repeat(64), at: later }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => advanceRelayEffectJournal(journal, op,
    { kind: "mark_submission", role: "deposit", marker: "c".repeat(64), at: later }), { code: "APN_OPERATION_BLOCKED" });
});
