import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { storedOperationDomains } from "../../src/operation-conflict-domain.js";
import type { StoredMoneyOperation } from "../../src/operation-service.js";
import { StateStore } from "../../src/state.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
import { TestClock, TestProfilePolicy, UUID, temporaryState } from "./helpers.js";
import { ExactX402Native, QueuedHttp, RecoveryRpc, X402_TEST_ACCOUNT, challengeObservation } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

class Approval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  async approve(intent: OperationAbandonIntent): Promise<void> { this.calls.push(intent); }
}

interface Fixture {
  readonly core: ApnCore;
  readonly native: ExactX402Native;
  readonly rpc: RecoveryRpc;
  readonly http: QueuedHttp;
  readonly clock: TestClock;
  readonly approval: Approval;
}

async function fixture(t: TestContext, paid: readonly (Error)[] = []): Promise<Fixture> {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const http = new QueuedHttp([challengeObservation(), challengeObservation(), ...paid]);
  const native = new ExactX402Native();
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const clock = new TestClock();
  const approval = new Approval();
  const core = new ApnCore({
    state: new StateStore(temporary.root, { lockWaitMs: 1_000 }), native, rpc, http, clock,
    policy: new TestProfilePolicy(), operationAbandonApproval: approval, ids: { next: () => UUID },
  });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  return { core, native, rpc, http, clock, approval };
}

async function prepare(f: Fixture, key = "x402-expiry"): Promise<string> {
  const prepared = await f.core.execute({ command: "x402.fetch.prepare", profile: "default", url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey: key });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  return (prepared.operation as { readonly operationId: string }).operationId;
}

async function stored(f: Fixture, operationId: string): Promise<X402OperationRecord> {
  return await f.core.context.state.findX402Operation(operationId) as X402OperationRecord;
}

function finalizeAt(f: Fixture, timestamp: string): void {
  f.rpc.finalizedHead = { ...f.rpc.finalizedHead, number: "12350", hash: `0x${"f".repeat(64)}`, timestamp, observedAt: f.clock.now().toISOString() };
}

const state = (outcome: { readonly operation: unknown }) => (outcome.operation as { readonly state: string }).state;

test("approval after validBefore closes the unsigned purchase with no effect and never asks the signer", async (t) => {
  const f = await fixture(t);
  const operationId = await prepare(f);
  f.clock.advance(61_000);
  const approved = await f.core.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal(state(approved), "failed_before_effect");
  assert.deepEqual(f.native.calls.map((call) => call.operation), ["wallet.ensure"]);
  const receipt = await f.core.execute({ command: "receipt.get", operationId });
  assert.equal((receipt.receipt as { readonly terminalState: string }).terminalState, "failed_before_effect");
});

test("an expired never-sent authorization ends on the token nonce state at a finalized block, without a log scan", async (t) => {
  const f = await fixture(t);
  const operationId = await prepare(f);
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  const authorized = await stored(f, operationId);
  assert.equal(authorized.state, "authorized_not_sent");
  f.clock.advance(61_000);
  f.rpc.x402Calls.length = 0;

  finalizeAt(f, (BigInt(authorized.authorization.validBefore) - 1n).toString());
  const early = await f.core.execute({ command: "operation.resume", operationId });
  assert.equal(early.ok, true, JSON.stringify(early));
  assert.equal((await stored(f, operationId)).terminal, false, "a finalized block before validBefore proves nothing");

  f.rpc.x402Calls.length = 0;
  finalizeAt(f, authorized.authorization.validBefore);
  const closed = await f.core.execute({ command: "operation.resume", operationId });
  assert.equal(state(closed), "failed_expired_unused", JSON.stringify(closed));
  assert.deepEqual(f.rpc.x402Calls, ["chain", "state:finalized"]);
  const terminal = await stored(f, operationId);
  assert.equal(terminal.unusedExpiryEvidence?.schemaVersion, "apn.x402.unused-expiry-evidence.v2");
  assert.equal(terminal.unusedExpiryEvidence?.finalizedHead.number, "12350");
  assert.equal(f.http.calls.length, 1, "the expired header is never exposed");
});

test("a used nonce never yields an expired-unused terminal", async (t) => {
  const f = await fixture(t);
  const operationId = await prepare(f);
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  const authorized = await stored(f, operationId);
  f.clock.advance(61_000);
  finalizeAt(f, authorized.authorization.validBefore);
  f.rpc.authorizationStateValue = true;
  await f.core.execute({ command: "operation.resume", operationId });
  const after = await stored(f, operationId);
  assert.notEqual(after.state, "failed_expired_unused");
  assert.equal(after.unusedExpiryEvidence, undefined);
});

test("signing material that never reached APN expires on the same chain proof", async (t) => {
  const f = await fixture(t);
  const operationId = await prepare(f);
  const original = f.native.request.bind(f.native);
  f.native.request = async (request) => {
    if (request.operation === "x402Exact.approveAndAuthorize") {
      f.native.calls.push(request);
      throw new ApnError("APN_NATIVE_REJECTED", "Keychain locked.", { nativeCode: "APN_KEYCHAIN_LOCKED" });
    }
    return await original(request);
  };
  const approved = await f.core.execute({ command: "x402.fetch.approve", operationId });
  assert.equal(state(approved), "authorization_material_pending", JSON.stringify(approved));
  const pending = await stored(f, operationId);
  f.clock.advance(61_000);
  finalizeAt(f, pending.authorization.validBefore);
  const closed = await f.core.execute({ command: "operation.resume", operationId });
  assert.equal(state(closed), "failed_expired_unused", JSON.stringify(closed));
  const terminal = await stored(f, operationId);
  assert.equal(terminal.signatureHash, undefined);
  assert.equal(terminal.unusedExpiryEvidence?.schemaVersion, "apn.x402.unused-expiry-evidence.v2");
});

test("open EIP-3009 purchases share the account: a second purchase prepares on the same wallet", async (t) => {
  const f = await fixture(t);
  const first = await prepare(f, "x402-first");
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId: first })).ok, true);
  assert.equal((await stored(f, first)).terminal, false);
  const second = await prepare(f, "x402-second");
  assert.notEqual(second, first);
  const record = await stored(f, first);
  // A shared claim: other purchases proceed, nonce and EIP-7702 spenders on this account still wait for it.
  assert.deepEqual(storedOperationDomains({ kind: "x402_fetch", strategy: "local", record } as StoredMoneyOperation),
    [{ family: "evm", network: "8453", account: record.wallet, shared: true }]);
  const delegated = { ...record, selectedOffer: { ...record.selectedOffer, resolved: { assetTransferMethod: "erc7710" } } };
  assert.deepEqual(storedOperationDomains({ kind: "x402_fetch", strategy: "local", record: delegated } as unknown as StoredMoneyOperation),
    [{ family: "evm", network: "8453", account: record.wallet }]);
});

test("owner abandon is refused while the authorization can still settle and ends an expired unknown purchase", async (t) => {
  const f = await fixture(t, [new Error("ambiguous paid request")]);
  const operationId = await prepare(f);
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  const sent = await f.core.execute({ command: "operation.resume", operationId });
  assert.equal(state(sent), "effect_unknown", JSON.stringify(sent));
  const early = await f.core.execute({ command: "operation.abandon", operationId });
  assert.equal(early.ok, false);
  assert.equal(early.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(f.approval.calls.length, 0);

  f.clock.advance(61_000);
  const abandoned = await f.core.execute({ command: "operation.abandon", operationId });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned));
  assert.equal(state(abandoned), "abandoned_unknown");
  assert.equal(f.approval.calls.length, 1);
  assert.equal(f.approval.calls[0]?.amountDecimal, "1.25");
  assert.equal(f.approval.calls[0]?.recipient, (await stored(f, operationId)).payee);
  const receipt = await f.core.execute({ command: "receipt.get", operationId });
  assert.equal((receipt.receipt as { readonly terminalState: string }).terminalState, "abandoned_unknown");
  const again = await f.core.execute({ command: "operation.abandon", operationId });
  assert.equal(state(again), "abandoned_unknown");
  assert.equal(f.approval.calls.length, 1, "a repeated abandon is idempotent and asks nothing");
});

test("owner abandon never replaces an outcome the chain already proves", async (t) => {
  const f = await fixture(t);
  const operationId = await prepare(f);
  assert.equal((await f.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  const authorized = await stored(f, operationId);
  f.clock.advance(61_000);
  finalizeAt(f, authorized.authorization.validBefore);
  const terminal = await f.core.execute({ command: "operation.resume", operationId });
  assert.equal(state(terminal), "failed_expired_unused");
  const refused = await f.core.execute({ command: "operation.abandon", operationId });
  assert.equal(refused.ok, false);
  assert.equal(refused.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(f.approval.calls.length, 0);
});
