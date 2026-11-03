import assert from "node:assert/strict";
import { test } from "node:test";
import { ApnCore } from "../../src/core.js";
import { mmDispatchIntent } from "../../src/metamask-gasless/dispatch.js";
import { mmActualGross } from "../../src/metamask-gasless/economics.js";
import { MetaMaskGaslessOperationRepository } from "../../src/metamask-gasless/journal/repository.js";
import type { MetaMaskGaslessOperationRecord } from "../../src/metamask-gasless/operation-model.js";
import type { MetaMaskRevocationApprovalPort, MetaMaskRevocationSummary } from "../../src/metamask-gasless/revocation/consent.js";
import type { MetaMaskRevocationSubmission, MetaMaskRevocationWalletPort } from "../../src/metamask-gasless/revocation/wallet.js";
import { evmClaim } from "../../src/operation-index/adapters/family-claims.js";
import { admitOperation } from "../../src/operation-index/admission.js";
import { OperationService } from "../../src/operation-service.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { TestNative, TestRpc, temporaryState } from "./helpers.js";
import { mmFixture, mmTestWord } from "./metamask-gasless-helpers.js";
import { TestHttp } from "./x402-helpers.js";

type Fixture = Awaited<ReturnType<typeof mmFixture>>;
type Beside = { readonly unresolved_beside?: { readonly operations: unknown; readonly warning: string } };
const besideOf = (operation: unknown) => (operation as Beside).unresolved_beside;
const idOf = (operation: unknown) => (operation as { operation_id: string }).operation_id;
const listed = (op: MetaMaskGaslessOperationRecord) => ({ operation_id: op.operationId, state: op.state, recipient: op.intent.request.recipient,
  dispatched_gross_atomic: mmActualGross(mmDispatchIntent(op).quote) });

class Approval implements MetaMaskRevocationApprovalPort {
  readonly seen: MetaMaskRevocationSummary[] = [];
  async confirm(summary: MetaMaskRevocationSummary) { this.seen.push(summary); return true; }
}
class Wallet implements MetaMaskRevocationWalletPort {
  readonly sent: Parameters<MetaMaskRevocationWalletPort["send"]>[0][] = [];
  async send(input: Parameters<MetaMaskRevocationWalletPort["send"]>[0]): Promise<MetaMaskRevocationSubmission> {
    this.sent.push(input); return { disposition: "pending", requestIdHash: "e".repeat(64) };
  }
}

/** The fixture's provider signs with one fixed salt, so each transfer here differs in its amount to get its own delegation. */
const prepare = (f: Fixture, key: string, extra = 0) => f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile,
  request: { ...f.request, grossAtomic: String(10_000_000 + extra) }, idempotencyKey: key });
/** A dispatched transfer whose submit response was lost: only its outcome is unknown. */
async function unresolved(f: Fixture, key: string, extra = 0): Promise<string> {
  const prepared = await prepare(f, key, extra); assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = idOf(prepared.operation);
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  f.provider.failSubmit = false;
  assert.equal((await f.record(id)).state, "unknown_finality");
  return id;
}
const revokingCore = (f: Fixture, approval: Approval, wallet: Wallet) => new ApnCore({ state: f.state, clock: f.clock, wait: f.wait,
  metaMaskGasless: { ...f.dependencies, revocation: { approval, wallet } } });

test("a MetaMask gasless dispatch with an unknown outcome admits a new transfer of the same account, which lists it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), first = await unresolved(f, "mm-beside-first"), before = await f.record(first);
  const prepared = await prepare(f, "mm-beside-second", 1);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const shown = besideOf(prepared.operation);
  assert.deepEqual(shown?.operations, [listed(before)]);
  assert.match(shown!.warning, /no proved outcome yet and may still complete beside this one\.$/u);
  const second = idOf(prepared.operation), screens = f.approval.calls.length;
  const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: second });
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  // The owner saw the same list before consenting, and the result carries it.
  assert.deepEqual(f.approval.calls[screens]!.summary.unresolved_beside, shown);
  assert.deepEqual(besideOf(approved.operation), shown);
  assert.equal((await f.record(second)).submissionAttempts, 1); assert.equal(f.provider.submissions.length, 2);
  assert.deepEqual(await f.record(first), before);
  assert.equal(besideOf((await f.core.execute({ command: "operation.status", operationId: first })).operation), undefined);
});

test("approval, execution and dispatch in flight, other families and the profile still collide", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), profileHash = f.state.profileHash(f.profile), owner = f.binding.address;
  const account = { blockingNetwork: `evm:${f.request.chainId}`, blockingAccount: owner.toLowerCase() };
  const first = idOf((await prepare(f, "mm-collide-first")).operation);
  const blockedAs = async (key: string, state: string) =>
    assert.deepEqual((await prepare(f, key, 9)).error?.details, { blockingOperationId: first, blockingState: state, ...account }, state);
  await blockedAs("mm-collide-pending", "awaiting_approval");
  // Writes that crash after the record reached disk: approved but not dispatched, then a marker without a POST outcome.
  const records = new MetaMaskGaslessOperationRepository(temporary.root), original = records.persist.bind(records);
  records.persist = async op => {
    if (op.state === "execution_pending" || op.state === "dispatch_pending") { await records.writeOperation(op); throw new Error("synthetic fsync loss"); }
    await original(op);
  };
  const crashing = new ApnCore({ state: f.state, metaMaskGasless: { ...f.dependencies, records }, clock: f.clock });
  assert.equal((await crashing.execute({ command: "gasless.transfer.approve", operationId: first })).ok, false);
  assert.equal((await f.record(first)).state, "execution_pending");
  await blockedAs("mm-collide-execution", "execution_pending");
  assert.equal((await crashing.execute({ command: "operation.resume", operationId: first })).ok, false);
  assert.equal((await f.record(first)).state, "dispatch_pending");
  await blockedAs("mm-collide-dispatch", "dispatch_pending");
  f.rpc.phase = "pending"; f.rpc.candidate = null;
  assert.equal((await f.restart().execute({ command: "operation.resume", operationId: first })).ok, true);
  assert.equal((await f.record(first)).state, "unknown_finality");

  // Every other family and the profile-wide wallet lifecycle still wait for the unresolved transfer.
  const blockedBy = { code: "APN_OPERATION_BLOCKED", details: { blockingOperationId: first, blockingState: "unknown_finality", ...account } };
  await assert.rejects(new OperationService(f.state).assertEvmAccountSharedAvailable(profileHash, f.request.chainId, owner), blockedBy);
  let nativeWork = false;
  await assert.rejects(admitOperation(f.state, { family: "metamask_native", profileHash, operationId: "d".repeat(64), idempotencyHash: null,
    requestHash: "e".repeat(64) }, [evmClaim(f.request.chainId, owner)], async () => { nativeWork = true; }), blockedBy);
  assert.equal(nativeWork, false);
  const core = new ApnCore({ state: f.state, metaMaskGasless: f.dependencies, profileRepository: new StateProfileRepository(f.state),
    native: new TestNative(), rpc: new TestRpc(), http: new TestHttp(), rpcUrl: "https://rpc.example", clock: f.clock });
  for (const command of [
    { command: "transfer.prepare", profile: f.profile, recipient: f.request.recipient, amount: "1", idempotencyKey: "mm-collide-direct" },
    { command: "x402.fetch.prepare", profile: f.profile, url: "https://seller.example/resource", maxAmountAtomic: "1000000", idempotencyKey: "mm-collide-x402" },
  ] as const) assert.deepEqual((await core.execute(command)).error?.details, blockedBy.details, command.command);
  assert.deepEqual((await core.execute({ command: "wallet.ensure", profile: f.profile })).error?.details,
    { blockingOperationId: first, blockingState: "unknown_finality" });
  // A second MetaMask transfer proceeds beside it; a third waits for the second's approval.
  const second = idOf((await prepare(f, "mm-collide-second", 1)).operation);
  assert.equal((await prepare(f, "mm-collide-third", 2)).error?.details?.blockingOperationId, second);
});

test("a MetaMask prepare under the tag still waits for a MetaMask native or an x402 operation holding the account", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), profileHash = f.state.profileHash(f.profile), owner = f.binding.address;
  const account = { blockingNetwork: `evm:${f.request.chainId}`, blockingAccount: owner.toLowerCase() };
  for (const [family, operationId, claim] of [
    ["metamask_native", "d".repeat(64), evmClaim(f.request.chainId, owner)],
    ["x402_fetch", "c".repeat(64), { ...evmClaim(f.request.chainId, owner), shared: true as const }],
  ] as const) {
    // Held from admission, as each family's own prepare holds it, while this MetaMask prepare runs.
    await admitOperation(f.state, { family, profileHash, operationId, idempotencyHash: null, requestHash: "e".repeat(64) }, [claim], async () => {
      const refused = await prepare(f, `mm-held-${family}`);
      assert.deepEqual(refused.error?.details, { blockingOperationId: operationId, blockingState: "admitted", ...account }, family);
    });
  }
  assert.deepEqual(f.provider.calls, []);
  assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 0);
});

test("revoke proceeds beside the account's other MetaMask transfers and waits for any other family", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: { approve: async () => undefined } });
  const first = await unresolved(f, "mm-revoke-first"), second = await unresolved(f, "mm-revoke-second", 1);
  const pending = idOf((await prepare(f, "mm-revoke-pending", 2)).operation);
  assert.equal((await f.record(pending)).state, "awaiting_approval");
  const approval = new Approval(), wallet = new Wallet();
  for (const id of [first, second]) {
    const revoked = await revokingCore(f, approval, wallet).execute({ command: "gasless.transfer.revoke", operationId: id });
    assert.equal(revoked.ok, true, JSON.stringify(revoked.error));
  }
  assert.deepEqual(wallet.sent.map(sent => sent.intent.slice(0, 68)), [first, second].map(id => `APN ${id}`));
  // Once both are abandoned and the pending one has expired unsent, a MetaMask native transfer may hold the account; then
  // revoking an abandoned delegation waits for it.
  f.advance(600_000); f.rpc.phase = "pending";
  for (const id of [first, second]) assert.equal((await f.restart().execute({ command: "operation.abandon", operationId: id })).ok, true);
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: pending })).ok, true);
  assert.equal((await f.record(pending)).state, "failed_before_effect");
  const native = "d".repeat(64), profileHash = f.state.profileHash(f.profile);
  await admitOperation(f.state, { family: "metamask_native", profileHash, operationId: native, idempotencyHash: null, requestHash: "e".repeat(64) },
    [evmClaim(f.request.chainId, f.binding.address)], async () => {
      const refused = await revokingCore(f, approval, wallet).execute({ command: "gasless.transfer.revoke", operationId: first });
      assert.equal(refused.error?.code, "APN_OPERATION_BLOCKED");
      assert.deepEqual([refused.error?.details?.blockingOperationId, refused.error?.details?.blockingState], [native, "admitted"]);
    });
  assert.equal(wallet.sent.length, 2); assert.equal(approval.seen.length, 2);
});

test("a new delegation that repeats an unresolved sibling's hash is refused before anything is written", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), first = await unresolved(f, "mm-reuse-first");
  // Same transfer and the fixture's fixed salt: the same delegation hash as the unresolved one.
  const refused = await prepare(f, "mm-reuse-second");
  assert.equal(refused.error?.code, "APN_PROVIDER_PROTOCOL"); assert.equal(refused.error?.details?.reason, "mm_gasless_delegation_reused");
  assert.deepEqual((await f.core.metaMaskGasless.records.listAllOperations()).map(op => op.operationId), [first]);
  assert.equal(f.provider.submissions.length, 1);
});

test("two MetaMask transfers beside each other observe, resume and abandon independently", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: { approve: async () => undefined } });
  const first = await unresolved(f, "mm-pair-first"), second = await unresolved(f, "mm-pair-second", 1);
  const secondBefore = await f.record(second);
  f.advance(60_000); f.rpc.phase = "success"; f.rpc.candidate = mmTestWord("transaction-a");
  const resumed = await f.restart().execute({ command: "operation.resume", operationId: first });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  assert.equal((await f.record(first)).state, "completed");
  assert.deepEqual(await f.record(second), secondBefore);
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.advance(600_000);
  const abandoned = await f.restart().execute({ command: "operation.abandon", operationId: second });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error));
  assert.equal((await f.record(second)).state, "abandoned_unknown"); assert.equal((await f.record(first)).state, "completed");
  // The completed one is proved; the released dispatch may still be redeemed, so a new transfer still lists it.
  const third = await prepare(f, "mm-pair-third", 2);
  assert.equal(third.ok, true, JSON.stringify(third.error));
  assert.deepEqual(besideOf(third.operation)?.operations, [listed(await f.record(second))]);
  assert.equal(f.provider.submissions.length, 2);
});

test("a dispatch the owner released keeps its delegation hash unique and is listed on the approval screen", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: { approve: async () => undefined } });
  const released = await unresolved(f, "mm-released-first"); f.advance(600_000);
  const abandoned = await f.restart().execute({ command: "operation.abandon", operationId: released });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error));
  const record = await f.record(released);
  assert.deepEqual([record.state, record.submissionAttempts], ["abandoned_unknown", 1]);
  // Same transfer and the fixture's fixed salt: the released delegation's hash, which MetaMask may still redeem.
  const reused = await prepare(f, "mm-released-reuse");
  assert.equal(reused.error?.code, "APN_PROVIDER_PROTOCOL"); assert.equal(reused.error?.details?.reason, "mm_gasless_delegation_reused");
  assert.deepEqual((await f.core.metaMaskGasless.records.listAllOperations()).map(op => op.operationId), [released]);
  const next = await prepare(f, "mm-released-next", 1);
  assert.equal(next.ok, true, JSON.stringify(next.error));
  assert.deepEqual(besideOf(next.operation)?.operations, [listed(record)]);
  const screens = f.approval.calls.length;
  const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: idOf(next.operation) });
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  assert.deepEqual(f.approval.calls[screens]!.summary.unresolved_beside, besideOf(next.operation));
  assert.deepEqual(await f.record(released), record);
});

test("an expired MetaMask approval that never dispatched stops holding the account; its own approval still closes it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // Prepared half an hour ago: its five-minute window and the ten-minute unstarted margin have both passed on the wall clock.
  const f = await mmFixture(temporary.root, 8453, "empty", { now: new Date(Math.floor(Date.now() / 1000) * 1000 - 1_800_000) });
  const { id: stale } = await f.prepare("mm-expired-stale");
  f.advance(1_800_000);
  const fresh = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: f.request, idempotencyKey: "mm-expired-fresh" });
  assert.equal(fresh.ok, true, JSON.stringify(fresh.error)); assert.equal(besideOf(fresh.operation), undefined);
  assert.equal((await f.record(stale)).state, "awaiting_approval");
  const closed = await f.core.execute({ command: "gasless.transfer.approve", operationId: stale });
  assert.equal(closed.ok, true, JSON.stringify(closed.error));
  const record = await f.record(stale);
  assert.deepEqual([record.state, record.failure?.reason, record.submissionAttempts], ["failed_before_effect", "mm_gasless_expired", 0]);
  assert.equal(f.approval.calls.length, 0); assert.equal(f.provider.submissions.length, 0);
});
