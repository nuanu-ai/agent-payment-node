import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../../src/canonical.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { Permit2ProductionRepository, publicPermit2Production, productionRecordBody, sealPermit2ProductionRecord } from "../../src/x402-permit2/production-repository.js";
import { OperationService } from "../../src/operation-service.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";

test("risk and attempt races preserve one immutable exposure and private request marker", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  assert.equal(f.reserved.exposureJournal, undefined);
  assert.equal(publicPermit2Production(f.reserved).lifecycle, "unsigned");
  const historicalRisk = sealPermit2ProductionRecord({ ...productionRecordBody(f.reserved), state: "exposure_unknown",
    exposureAt: f.reserved.updatedAt });
  assert.equal(historicalRisk.exposureJournal, undefined);
  assert.equal(publicPermit2Production(historicalRisk).lifecycle, "exposed_held");
  const risk = await Promise.all([f.journal.markSignatureRisk(id), f.journal.markSignatureRisk(id)]);
  assert.deepEqual(risk[0], risk[1]); assert.equal(risk[0]!.exposureJournal!.holdConfirmed, true);
  assert.equal((await f.lease()).state, "unknown_finality");
  assert.equal(publicPermit2Production(risk[0]!).lifecycle, "exposed_held");
  await f.journal.storeSigned(id, f.signed);
  const attempts = await Promise.all([f.journal.markRequestPending(id), f.journal.markRequestPending(id)]);
  assert.deepEqual(attempts[0], attempts[1]); assert.equal(attempts[0]!.exposureJournal!.request!.attempt, 1);
  assert.equal(publicPermit2Production(attempts[0]!).lifecycle, "request_attempted");
  assert.deepEqual(await f.journal.markSignatureRisk(id), attempts[0]);
  const projected = JSON.stringify(publicPermit2Production(attempts[0]!));
  for (const secret of ["private", f.permit2Signature, f.signed.paymentSignatureHeader, "bodyBase64", "approvalFingerprint"])
    assert.equal(projected.includes(secret), false);
  f.advance(120); await assert.rejects(f.preparation.releaseExpired(id));
  await assert.rejects(new OperationService(f.state).assertEvmAccountAvailable(f.record.profileHash, 43114, f.prepared.payer));
});

for (const sponsor of [false, true]) test(`checked ${sponsor ? "sponsored" : "allowance"} settlement alone finalizes common consumption`, async t => {
  const f = await journalFixture(t, sponsor), id = f.record.operationId;
  await f.journal.markSignatureRisk(id); await f.journal.storeSigned(id, f.signed); await f.journal.markRequestPending(id);
  const observed = await f.observe("settlement"); assert.ok(observed.proof);
  const terminal = await f.journal.finalize(id, observed.proof, "settlement");
  assert.equal(terminal.state, "settled"); assert.equal(terminal.terminal, true);
  assert.equal((await f.lease()).state, "finalized"); assert.equal((await f.lease()).amountAtomic, "10000");
  assert.equal(publicPermit2Production(terminal).lifecycle, "settled");
  await assert.rejects(f.journal.finalize(id, observed.proof, "settlement"));
  assert.deepEqual(await f.journal.reconcileTerminal(id), terminal);
  await new OperationService(f.state).assertEvmAccountAvailable(f.record.profileHash, 43114, f.prepared.payer);
});

for (const signed of [false, true]) test(`checked signed-risk expiry ${signed ? "with" : "without"} saved bundle cleans revoked policy`, async t => {
  const f = await journalFixture(t, true), id = f.record.operationId;
  await f.journal.markSignatureRisk(id);
  if (signed) await f.journal.storeSigned(id, f.signed);
  f.advance(120); await f.revoke(); await assert.rejects(f.preparation.releaseExpired(id));
  const observed = await f.observe("expired_unused"); assert.ok(observed.proof);
  const terminal = await f.journal.finalize(id, observed.proof, "expired_unused");
  assert.equal(terminal.state, "expired_no_effect"); assert.equal(terminal.releaseDigest, null);
  assert.equal((await f.lease()).state, "released_unsubmitted");
  assert.equal((await f.usage.usageReadOnly({ account: f.prepared.payer, chain: f.prepared.chain,
    asset: { kind: "token", identifier: f.prepared.token } }, f.now())).amountAtomic, "0");
  await new OperationService(f.state).assertEvmAccountAvailable(f.record.profileHash, 43114, f.prepared.payer);
});

test("serialized proof, mismatched operation and opaque raw outcome cannot issue terminal intent", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  await f.journal.markSignatureRisk(id); await f.journal.storeSigned(id, f.signed);
  const observed = await f.observe("settlement"); assert.ok(observed.proof);
  await assert.rejects(f.journal.finalize(id, JSON.parse(JSON.stringify(observed.proof)), "settlement"));
  await assert.rejects(f.journal.finalize("f".repeat(64), observed.proof, "settlement"));
  await assert.rejects(f.journal.finalize(id, observed.projection as any, "settlement"));
  const saved = await f.journal.findOperation(id); assert.equal(saved!.exposureJournal!.terminalIntent, null);
  await f.journal.finalize(id, observed.proof, "settlement");
});

test("risk crash before common hold retains exposure and replay only repairs the hold", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  const original = AssetUsageLedger.prototype.transition;
  const stub = t.mock.method(AssetUsageLedger.prototype, "transition", async () => { throw new Error("ledger crash"); });
  await assert.rejects(f.journal.markSignatureRisk(id), /ledger crash/);
  const risk = await f.journal.findOperation(id);
  assert.equal(risk!.exposureAt !== null, true); assert.equal(risk!.exposureJournal!.holdConfirmed, false);
  await assert.rejects(f.journal.storeSigned(id, f.signed));
  stub.mock.restore(); assert.equal(AssetUsageLedger.prototype.transition, original);
  const recovered = await f.journal.markSignatureRisk(id);
  assert.equal(recovered.exposureJournal!.holdConfirmed, true); assert.equal((await f.lease()).state, "unknown_finality");
});

test("terminal intent crash before ledger requires a fresh capability, never serialized intent", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  await f.journal.markSignatureRisk(id); await f.journal.storeSigned(id, f.signed);
  const observed = await f.observe("settlement"); assert.ok(observed.proof);
  const stub = t.mock.method(AssetUsageLedger.prototype, "transition", async () => { throw new Error("terminal ledger crash"); });
  await assert.rejects(f.journal.finalize(id, observed.proof, "settlement"), /terminal ledger crash/); stub.mock.restore();
  const pending = await f.journal.reconcileTerminal(id); assert.equal(pending.state, "terminal_pending");
  assert.equal((await f.lease()).state, "unknown_finality");
  await assert.rejects(f.journal.finalize(id, observed.proof, "settlement"));
  f.advance(120); const conflicting = await f.observe("expired_unused"); assert.ok(conflicting.proof);
  await assert.rejects(f.journal.finalize(id, conflicting.proof, "expired_unused"));
  const fresh = await f.observe("settlement"); assert.ok(fresh.proof);
  assert.equal((await f.journal.finalize(id, fresh.proof, "settlement")).state, "settled");
});

test("terminal ledger crash before final journal reconciles matching persisted intent without new proof", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  await f.journal.markSignatureRisk(id); await f.journal.storeSigned(id, f.signed);
  const observed = await f.observe("settlement"); assert.ok(observed.proof);
  const prototype = Permit2ProductionRepository.prototype as any;
  const original = prototype.writeJson;
  const stub = t.mock.method(prototype, "writeJson", async function(this: Permit2ProductionRepository, path: string, value: unknown, createOnly: boolean) {
    if ((value as any).state === "settled") throw new Error("final journal crash");
    return original.call(this, path, value, createOnly);
  });
  await assert.rejects(f.journal.finalize(id, observed.proof, "settlement"), /final journal crash/);
  assert.equal((await f.lease()).state, "finalized"); stub.mock.restore();
  assert.equal((await f.journal.reconcileTerminal(id)).state, "settled");
});

test("unsigned persistence cannot fabricate terminal intent or mutate first signed bundle", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  await f.journal.markSignatureRisk(id); const saved = await f.journal.storeSigned(id, f.signed);
  await assert.rejects(f.preparation.records.persistLocked(saved));
  await assert.rejects(f.journal.storeSigned(id, { ...f.signed, headerHash: "f".repeat(64) }));
  assert.deepEqual(await f.journal.findOperation(id), saved);
  const forged = { ...productionRecordBody(saved), exposureJournal: { ...saved.exposureJournal!, terminalIntent: { outcome: "settled", outcomeDigest: "f".repeat(64) } } };
  assert.throws(() => sealPermit2ProductionRecord(forged as any));
});

test("revoked current owner refuses initial risk without exposure", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  await f.revoke(); await assert.rejects(f.journal.markSignatureRisk(id));
  assert.equal((await f.journal.findOperation(id))!.exposureAt, null);
  assert.equal((await f.lease()).state, "reserved");
});

test("risk write failure keeps unsigned record and never changes the common lease", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  const prototype = Permit2ProductionRepository.prototype as any, original = prototype.writeJson;
  const stub = t.mock.method(prototype, "writeJson", async function(this: Permit2ProductionRepository, path: string, value: unknown, createOnly: boolean) {
    if ((value as any).exposureAt !== null) throw new Error("risk journal crash");
    return original.call(this, path, value, createOnly);
  });
  await assert.rejects(f.journal.markSignatureRisk(id), /risk journal crash/); stub.mock.restore();
  assert.equal((await f.journal.findOperation(id))!.state, "reserved"); assert.equal((await f.lease()).state, "reserved");
});

test("fresh expiry after crash keeps original consumed evidence and stable nonce-bound outcome", async t => {
  const f = await journalFixture(t, true), id = f.record.operationId;
  await f.journal.markSignatureRisk(id); f.advance(120);
  const observed = await f.observe("expired_unused"); assert.ok(observed.proof);
  const stub = t.mock.method(AssetUsageLedger.prototype, "transition", async () => { throw new Error("expiry ledger crash"); });
  await assert.rejects(f.journal.finalize(id, observed.proof, "expired_unused"), /expiry ledger crash/); stub.mock.restore();
  const first = (await f.journal.findOperation(id))!.exposureJournal!.terminalIntent!;
  f.wire.finalized.hash = `0x${"d".repeat(64)}`; f.wire.finalized.timestamp = `0x${(Number.parseInt(f.wire.finalized.timestamp, 16) + 10).toString(16)}`;
  const fresh = await f.observe("expired_unused"); assert.ok(fresh.proof);
  assert.notEqual(fresh.projection.blockHash, first.blockHash);
  const terminal = await f.journal.finalize(id, fresh.proof, "expired_unused");
  assert.deepEqual(terminal.exposureJournal!.terminalIntent, first);
  assert.equal((await f.lease()).outcomeDigest, first.outcomeDigest);
});

test("a contradictory finalized settlement block holds the first durable terminal intent", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  await f.journal.markSignatureRisk(id); await f.journal.storeSigned(id, f.signed);
  const observed = await f.observe("settlement"); assert.ok(observed.proof);
  const stub = t.mock.method(AssetUsageLedger.prototype, "transition", async () => { throw new Error("settlement ledger crash"); });
  await assert.rejects(f.journal.finalize(id, observed.proof, "settlement")); stub.mock.restore();
  const first = (await f.journal.findOperation(id))!.exposureJournal!.terminalIntent!;
  const hash = `0x${"d".repeat(64)}` as const;
  f.wire.block.hash = hash; f.wire.tx.blockHash = hash; f.wire.receipt.blockHash = hash;
  for (const log of f.wire.receipt.logs) log.blockHash = hash;
  const contradictory = await f.observe("settlement"); assert.ok(contradictory.proof);
  await assert.rejects(f.journal.finalize(id, contradictory.proof, "settlement"));
  assert.deepEqual((await f.journal.findOperation(id))!.exposureJournal!.terminalIntent, first);
  assert.equal((await f.lease()).state, "unknown_finality");
});

test("async caller mutation cannot substitute stored signed material", async t => {
  const f = await journalFixture(t), id = f.record.operationId; await f.journal.markSignatureRisk(id);
  const clone = { ...f.signed }, pending = f.journal.storeSigned(id, clone);
  clone.headerHash = "f".repeat(64); clone.paymentSignatureHeader = "forged";
  const saved = await pending; assert.deepEqual(saved.exposureJournal!.signed, f.signed);
});

test("historical exposure record remains readable and exposed without migration or writeback", async t => {
  const f = await journalFixture(t);
  const historical = sealPermit2ProductionRecord({ ...productionRecordBody(f.reserved), state: "exposure_unknown",
    exposureAt: f.reserved.updatedAt });
  const path = join(f.root, "permit2-production", `${historical.operationId}.json`);
  await writeFile(path, canonicalJson(historical));
  const before = await readFile(path, "utf8"), loaded = await f.journal.findOperation(historical.operationId);
  assert.deepEqual(loaded, historical); assert.equal(Object.hasOwn(loaded!, "exposureJournal"), false);
  assert.equal(publicPermit2Production(loaded!).lifecycle, "exposed_held");
  assert.equal(publicPermit2Production(loaded!).observeOnly, true);
  assert.equal(await readFile(path, "utf8"), before);
});
