import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnCore } from "../../src/core.js";
import { EXPIRED_APPROVE_CLOSES, EXPIRED_APPROVE_OR_NEXT_TRANSFER_CLOSES, EXPIRED_EVIDENCE_MISSING, EXPIRED_EVIDENCE_UNVERIFIED,
  EXPIRED_RELEASED_AFTER_MARGIN } from "../../src/operation-approval-expiry.js";
import { OperationService } from "../../src/operation-service.js";
import { StateStore } from "../../src/state.js";
import { validateSwapOperation } from "../../src/swap/model.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { CanonicalDirectTestNative } from "./canonical-direct-native-fixture.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { ensureWallet, makeCore, prepareTransfer, temporaryState, TestClock, TestRpc } from "./helpers.js";
import { NoSecret, WP2_FAMILY_RECORDS } from "./operation-commands-families.js";
import { ExactX402Native, QueuedHttp, RecoveryRpc, X402_TEST_ACCOUNT, challengeObservation } from "./x402-helpers.js";
import { X402_PAYMENT_REQUIRED, X402_URL, canonicalPaymentRequiredHeader } from "./x402-vectors.js";

/**
 * QA on 0.5.101: a prepared operation whose approval window had passed still read `awaiting_approval` in `apn operation
 * status` and named its approve step as if it could still be approved. Status now presents it as expired and says what
 * ends it. Approve stays named only where running it now closes the record before any prompt. Status stays a pure read:
 * the stored record (and every receipt derived from it) is unchanged, and a verifiable operation slot (a swap's sealed
 * record, an x402 purchase's self-hashed view) reaches the caller untouched, with the presentation in the data slot.
 */
const PRESENTED = (note: string) => ({ state: "expired", stored_state: "awaiting_approval", reason: "approval_window_expired", expiry_note: note });
const APPROVE = /^apn (?:pay|gasless) transfer approve /u;

function operationView(result: OutputEnvelope, label: string): Record<string, unknown> {
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.error)}`);
  return result.operation as Record<string, unknown>;
}
function assertOpen(result: OutputEnvelope, label: string): void {
  assert.equal(operationView(result, label).state, "awaiting_approval", label);
  assert.ok(result.next_actions.some(action => APPROVE.test(action)), `${label}: approve is named while the window is open`);
}
function assertExpired(result: OutputEnvelope, label: string, note: string, approveNamed: boolean): void {
  const view = operationView(result, label);
  assert.deepEqual([view.state, view.stored_state, view.reason, view.expiry_note, view.terminal],
    ["expired", "awaiting_approval", "approval_window_expired", note, false], label);
  for (const actions of [view.next_actions as readonly string[], result.next_actions]) {
    assert.equal(actions.some(action => APPROVE.test(action)), approveNamed, `${label}: approve named only where it now closes the record`);
  }
}

test("a local EVM transfer past its approval deadline names approve, which closes it, as the profile's next transfer does", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await ensureDirectWallet(setup);
  const prepare = async (key: string) => await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: key }) as
    { readonly operation_id: string; readonly expires_at: string };
  const prepared = await prepare("expired-status-0001");
  const id = prepared.operation_id, deadline = Date.parse(prepared.expires_at), stored = await setup.state.findOperation(id);
  assert.equal(stored?.state, "awaiting_approval");
  setup.clock.value = new Date(deadline - 1);
  const before = await setup.core.execute({ command: "operation.status", operationId: id });
  assertOpen(before, "local EVM before the deadline");
  setup.clock.value = new Date(deadline);
  const expired = await setup.core.execute({ command: "operation.status", operationId: id });
  // Before 0.5.103 status dropped approve here, though approve closes a local EVM transfer just as it closes Base USDC.
  assertExpired(expired, "local EVM at the deadline", EXPIRED_APPROVE_OR_NEXT_TRANSFER_CLOSES, true);
  assert.deepEqual(operationView(expired, "local EVM").next_actions, operationView(before, "local EVM open").next_actions);
  assert.deepEqual(await setup.state.findOperation(id), stored, "status never writes the record");
  // What the note says: approve closes it with no prompt and nothing signed...
  const approved = await setup.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(approved.error?.code, "APN_REPREPARE_REQUIRED", JSON.stringify(approved.error));
  const closedByApprove = await setup.state.findOperation(id);
  assert.deepEqual([closedByApprove?.state, closedByApprove?.reason, setup.approval.intents.length], ["failed_before_effect", "approval_window_expired", 0]);
  // ...and so does the profile's next transfer on this chain.
  const next = await prepare("expired-status-0002");
  setup.clock.value = new Date(Date.parse(next.expires_at));
  await prepare("expired-status-0003");
  const closed = await setup.state.findOperation(next.operation_id);
  assert.deepEqual([closed?.state, closed?.reason], ["failed_before_effect", "approval_window_expired"]);
});

test("a Base USDC transfer past its approval deadline names approve, which now closes it without asking", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const root = temporary.root, clock = new TestClock();
  await ensureWallet(makeCore({ root, native: new CanonicalDirectTestNative(root), clock }));
  const id = await prepareTransfer(makeCore({ root, rpc: new TestRpc(), clock }), "expired-status-base-usdc");
  const stored = (await new StateStore(root).findOperation(id))!, deadline = Date.parse(stored.expiresAt), core = makeCore({ root, clock });
  clock.value = new Date(deadline - 1);
  assertOpen(await core.execute({ command: "operation.status", operationId: id }), "Base USDC before the deadline");
  clock.value = new Date(deadline);
  const expired = await core.execute({ command: "operation.status", operationId: id });
  assertExpired(expired, "Base USDC at the deadline", EXPIRED_APPROVE_CLOSES, true);
  assert.deepEqual(operationView(expired, "Base USDC").next_actions,
    [`apn pay transfer approve --operation ${id} --rpc-url <https-url>`, `apn operation status --operation ${id}`]);
  assert.deepEqual(await new StateStore(root).findOperation(id), stored, "status never writes the record");
  // What the note says: this core has no signer, RPC or approval prompt, and approve closes the transfer before needing any.
  const approved = await core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(approved.error?.code, "APN_REPREPARE_REQUIRED", JSON.stringify(approved.error));
  const closed = await new StateStore(root).findOperation(id);
  assert.deepEqual([closed?.state, closed?.reason], ["failed_before_effect", "approval_window_expired"]);
});

test("a local transfer without its public effect evidence reads as expired and says approve cannot close it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const root = temporary.root, clock = new TestClock();
  await ensureWallet(makeCore({ root, native: new CanonicalDirectTestNative(root), clock }));
  const id = await prepareTransfer(makeCore({ root, rpc: new TestRpc(), clock }), "expired-status-no-evidence");
  const stored = (await new StateStore(root).findOperation(id))!, core = makeCore({ root, clock });
  // A record prepared before APN wrote its public prepared binding has none.
  await unlink(join(root, "direct-public-effects", stored.profileHash, `${id}.prepared.json`));
  clock.value = new Date(Date.parse(stored.expiresAt));
  const expired = await core.execute({ command: "operation.status", operationId: id });
  assertExpired(expired, "no evidence at the deadline", EXPIRED_EVIDENCE_MISSING, false);
  assert.deepEqual(operationView(expired, "no evidence").next_actions, [`apn operation status --operation ${id}`]);
  // What the note says: approve refuses without closing it.
  const approved = await core.execute({ command: "transfer.approve", operationId: id });
  assert.deepEqual([approved.error?.code, approved.error?.details?.reason], ["APN_OPERATION_BLOCKED", "direct_public_evidence_missing"]);
  assert.deepEqual(await new StateStore(root).findOperation(id), stored);
});

test("a local transfer whose public evidence does not verify reads as expired and does not name approve, which refuses", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const root = temporary.root, clock = new TestClock();
  await ensureWallet(makeCore({ root, native: new CanonicalDirectTestNative(root), clock }));
  const id = await prepareTransfer(makeCore({ root, rpc: new TestRpc(), clock }), "expired-status-bad-evidence");
  const stored = (await new StateStore(root).findOperation(id))!, core = makeCore({ root, clock });
  // Before 0.5.103 the file's presence alone made status say approve closes it, while approve failed APN_STATE_CORRUPT.
  const path = join(root, "direct-public-effects", stored.profileHash, `${id}.prepared.json`);
  const prepared = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, `${canonicalJson({ ...prepared, integrityHash: "0".repeat(64) })}\n`);
  clock.value = new Date(Date.parse(stored.expiresAt));
  const expired = await core.execute({ command: "operation.status", operationId: id });
  assertExpired(expired, "unverified evidence at the deadline", EXPIRED_EVIDENCE_UNVERIFIED, false);
  assert.deepEqual(operationView(expired, "unverified evidence").next_actions, [`apn operation status --operation ${id}`]);
  const approved = await core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(approved.error?.code, "APN_STATE_CORRUPT", JSON.stringify(approved.error));
  assert.deepEqual(await new StateStore(root).findOperation(id), stored);
});

interface Golden {
  readonly operation: { readonly profileHash: string; readonly operationId: string;
    readonly prepared?: { readonly expiresAt: string }; readonly intent?: { readonly expiresAt: string } };
  readonly receipt: { readonly state: string };
}
/** The awaiting-approval record a released version wrote, as the derived-receipt goldens pin it, and where its deadline is. */
const GOLDEN = [
  ["rail", "rail-operations", "prepared", EXPIRED_APPROVE_CLOSES, true],
  ["gasless", "gasless-operations", "intent", EXPIRED_RELEASED_AFTER_MARGIN, false],
  ["metamask-gasless", "metamask-gasless-operations", "intent", EXPIRED_RELEASED_AFTER_MARGIN, false],
  ["smart-account-gasless", "smart-account-gasless-operations", "intent", EXPIRED_RELEASED_AFTER_MARGIN, false],
  ["facilitator-gasless", "facilitator-gasless-operations", "intent", EXPIRED_RELEASED_AFTER_MARGIN, false],
] as const;

test("a Solana or gasless transfer past its approval deadline reads as expired and says what ends it", async (t) => {
  for (const [file, directory, holder, note, approveNamed] of GOLDEN) {
    await t.test(file, async (sub) => {
      const temporary = await temporaryState(); sub.after(temporary.cleanup); await new StateStore(temporary.root).initialize();
      const cases = JSON.parse(await readFile(join("tests", "fixtures", "derived-receipts", `${file}.json`), "utf8")) as readonly Golden[];
      const { operation } = cases.find(entry => entry.receipt.state === "awaiting_approval")!;
      const path = join(temporary.root, directory, operation.profileHash, `${operation.operationId}.json`);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, `${canonicalJson(operation)}\n`, { mode: 0o600 });
      const deadline = Date.parse(operation[holder]!.expiresAt), clock = new TestClock();
      const core = new ApnCore({ state: new StateStore(temporary.root, { lockWaitMs: 1_000 }), clock });
      clock.value = new Date(deadline - 1);
      assertOpen(await core.execute({ command: "operation.status", operationId: operation.operationId }), `${file} before the deadline`);
      clock.value = new Date(deadline);
      assertExpired(await core.execute({ command: "operation.status", operationId: operation.operationId }), `${file} at the deadline`,
        note, approveNamed);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), operation, `${file}: status never writes the record`);
    });
  }
});

test("a local x402 purchase past validBefore reads as expired and keeps its approve, which now closes it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const root = temporary.root, challenge = challengeObservation({ finalUrl: X402_URL,
    header: canonicalPaymentRequiredHeader({ ...X402_PAYMENT_REQUIRED, resource: { ...X402_PAYMENT_REQUIRED.resource, url: X402_URL } }) });
  const rpc = new RecoveryRpc(); rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const core = makeCore({ root, native: new ExactX402Native(), rpc, http: new QueuedHttp([challenge]), clock: new TestClock() });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const prepared = await core.execute({ command: "x402.fetch.prepare", profile: "default", url: X402_URL, maxAmountAtomic: "2000000",
    idempotencyKey: "expired-status-x402" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = (prepared.operation as { operationId: string }).operationId;
  const found = await new OperationService(new StateStore(root)).required(id);
  if (found.kind !== "x402_fetch" || found.strategy !== "local") throw new Error("expected a local x402 purchase");
  const deadline = Number(found.record.authorization.validBefore) * 1000, clock = new TestClock();
  const status = new ApnCore({ state: new StateStore(root, { lockWaitMs: 1_000 }), clock });
  clock.value = new Date(deadline - 1);
  const open = await status.execute({ command: "operation.status", operationId: id });
  assert.equal(operationView(open, "x402 before validBefore").state, "awaiting_approval");
  assert.equal(open.data, null);
  clock.value = new Date(deadline);
  const expired = await status.execute({ command: "operation.status", operationId: id });
  // The self-hashed public view is exactly the one status returned before the deadline; the presentation is beside it.
  assert.deepEqual(operationView(expired, "x402 at validBefore"), open.operation);
  assert.deepEqual(expired.data, PRESENTED(EXPIRED_APPROVE_CLOSES));
  assert.equal(expired.proof_class, open.proof_class, "proof_class stays what the stored record proves");
  assert.deepEqual(expired.next_actions, open.next_actions); assert.ok(expired.next_actions.includes("x402.fetch.approve"));
  assert.deepEqual((await new OperationService(new StateStore(root)).required(id)).record, found.record, "status never writes the record");
});

test("a guarded swap past its quote expiry reads as expired and says it stops holding the account", async (t) => {
  const fixture = await WP2_FAMILY_RECORDS.swap(t), records = new SwapOperationRepository(fixture.root);
  const stored = (await records.loadAny(fixture.id))!, deadline = Date.parse(stored.quote.expiresAt);
  assert.equal(stored.state, "awaiting_approval");
  const status = async (at: number) => await runCli(["operation", "status", "--operation", fixture.id], {},
    { stateRoot: fixture.root, wrappingSecret: new NoSecret(), clock: { now: () => new Date(at) } });
  const open = await status(deadline - 1);
  assert.equal(operationView(open, "swap before the deadline").state, "awaiting_approval");
  assert.equal(open.data, null);
  const expired = await status(deadline), view = operationView(expired, "swap at the deadline");
  // The operation slot is the sealed record itself: same bytes, and its integrity hash still verifies.
  assert.equal(JSON.stringify(view), JSON.stringify(stored)); assert.equal(validateSwapOperation(view).integrityHash, stored.integrityHash);
  assert.deepEqual(expired.data, PRESENTED(EXPIRED_RELEASED_AFTER_MARGIN));
  assert.equal(expired.proof_class, "awaiting_approval", "proof_class stays the stored state a swap lane reports");
  assert.deepEqual(expired.next_actions, []);
  assert.deepEqual(await records.loadAny(fixture.id), stored, "status never writes the record");
});
