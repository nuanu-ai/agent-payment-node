import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import type { HttpObservation } from "../../src/x402-model.js";
import { appendX402Transition, sealX402Operation, type X402OperationRecord } from "../../src/x402-state-integrity.js";
import { TestClock, makeCore, temporaryState } from "./helpers.js";
import { ExactX402Native, QueuedHttp, RecoveryRpc, X402_TEST_ACCOUNT, challengeObservation, paidObservation } from "./x402-helpers.js";
import { X402_TRANSACTION, X402_URL, canonicalPaymentResponseHeader } from "./x402-vectors.js";

async function authorized(t: TestContext, paid: readonly (HttpObservation | Error)[]) {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const http = new QueuedHttp([challengeObservation(), ...paid]);
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const clock = new TestClock();
  const core = makeCore({ root: temporary.root, native: new ExactX402Native(), rpc, http, clock });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const prepared = await core.execute({ command: "x402.fetch.prepare", profile: "default", url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey: "state-recovery" });
  const operationId = (prepared.operation as { readonly operationId: string }).operationId;
  assert.equal((await core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  rpc.x402Calls.length = 0;
  const stored = async () => await core.context.state.findX402Operation(operationId) as X402OperationRecord;
  const resume = async () => await core.execute({ command: "operation.resume", operationId });
  return { core, rpc, http, clock, operationId, stored, resume };
}

const state = (outcome: { readonly operation: unknown }) => (outcome.operation as { readonly state: string }).state;

test("a nonce already used before APN sent anything settles from the chain and never exposes the header", async (t) => {
  const f = await authorized(t, []);
  f.rpc.authorizationStateValue = true;
  const resumed = await f.resume();
  assert.equal(state(resumed), "failed_settled_without_result", JSON.stringify(resumed));
  const settled = await f.stored();
  assert.equal(settled.attempts.length, 0);
  assert.equal(settled.settlementEvidence?.schemaVersion, "apn.x402.settlement-evidence.v2");
  assert.equal(f.http.calls.length, 1, "only the unpaid challenge");
  assert.deepEqual(f.rpc.x402Calls, ["chain", "state:safe"]);
});

test("an ambiguous send is resent once with the same header while the nonce reads unused, never a third time", async (t) => {
  const f = await authorized(t, [new Error("first ambiguous"), new Error("second ambiguous")]);
  assert.equal(state(await f.resume()), "effect_unknown");
  assert.equal(state(await f.resume()), "effect_unknown");
  assert.equal(state(await f.resume()), "effect_unknown");
  const sent = f.http.calls.slice(1);
  assert.equal(sent.length, 2, "one original and one identical resend");
  assert.equal(sent[0]?.paymentSignature, sent[1]?.paymentSignature);
  assert.equal((await f.stored()).attempts.length, 2);
  f.rpc.x402Calls.length = 0;
  await f.resume();
  assert.deepEqual(f.rpc.x402Calls, ["chain", "state:safe"], "a pending poll is one chain id and one nonce-state read");
});

test("a seller's success claim cannot make a never-used authorization paid: it expires unused and keeps the delivered body", async (t) => {
  const claimed = paidObservation({ paymentResponseHeader: canonicalPaymentResponseHeader({
    success: true, transaction: X402_TRANSACTION, network: "eip155:8453", payer: X402_TEST_ACCOUNT.address.toLowerCase(), amount: "1250000",
  }) });
  const f = await authorized(t, [claimed]);
  assert.equal(state(await f.resume()), "settlement_pending");
  const pending = await f.stored();
  assert.notEqual(pending.resultLink, undefined);
  f.clock.advance(61_000);
  f.rpc.safeHead = { ...f.rpc.safeHead, timestamp: pending.authorization.validBefore, observedAt: f.clock.now().toISOString() };
  f.rpc.finalizedHead = { ...f.rpc.finalizedHead, timestamp: pending.authorization.validBefore, observedAt: f.clock.now().toISOString() };
  const closed = await f.resume();
  assert.equal(state(closed), "failed_expired_unused", JSON.stringify(closed));
  const terminal = await f.stored();
  assert.equal(terminal.unusedExpiryEvidence?.schemaVersion, "apn.x402.unused-expiry-evidence.v2");
  const receipt = await f.core.context.state.loadX402Receipt(terminal.profileHash, terminal.operationId);
  assert.equal(receipt?.terminalState, "failed_expired_unused");
  assert.notEqual(receipt?.result, undefined, "the unpaid body stays with its receipt");
});

test("a 0.5.41 record parked on an unavailable log scan with use.archival_rpc resumes on any public RPC", async (t) => {
  const f = await authorized(t, [new Error("ambiguous after the old scan")]);
  const record = await f.stored();
  const scanBody = {
    schemaVersion: "apn.x402.authorization-used-scan.v1" as const,
    searchStartBlock: record.preparedBlock.number, nextFromBlock: record.preparedBlock.number,
    targetSafeHead: { number: record.preparedBlock.number, hash: record.preparedBlock.hash, observedAt: record.preparedBlock.observedAt },
    candidates: [], status: "unavailable" as const, unavailableReason: "range_unavailable" as const, updatedAt: record.updatedAt,
  };
  const at = f.clock.now().toISOString();
  const { integrityHash: _integrityHash, ...body } = record;
  const parked = sealX402Operation({
    ...body,
    authorizationUsedScan: { ...scanBody, evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(scanBody)) },
    nextActions: ["operation.resume", "operation.status", "use.archival_rpc"],
    updatedAt: at,
    transitions: appendX402Transition(record.transitions, { at, state: record.state, terminal: false, reason: record.reason, proofClass: record.proofClass }),
  });
  await f.core.context.state.writeX402Operation(parked);
  assert.equal(state(await f.resume()), "effect_unknown");
  assert.equal(f.http.calls.length, 2, "the first send went out without any log scan");
  assert.equal(f.rpc.x402Calls.some((call) => call.startsWith("logs:")), false);
  f.rpc.authorizationStateValue = true;
  assert.equal(state(await f.resume()), "failed_settled_without_result");
  assert.equal((await f.stored()).authorizationUsedScan?.status, "unavailable", "the old scan is kept as written");
});
