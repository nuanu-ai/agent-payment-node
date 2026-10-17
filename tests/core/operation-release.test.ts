import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { OperationService } from "../../src/operation-service.js";
import { failureEnvelope } from "../../src/output.js";
import { StateStore } from "../../src/state.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState, TestClock, UUID } from "./helpers.js";

/**
 * Phase 4b WP3: the owner exit of a record APN can no longer read, and of an admission whose prepare crashed, is the
 * index's release behind TTY consent. It drops only the account claims: the record file and any usage-ledger
 * reservation stay as they are, so the amount stays charged.
 */
class Approval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  constructor(private readonly refuse = false) {}
  async approve(intent: OperationAbandonIntent): Promise<void> {
    this.calls.push(intent);
    if (this.refuse) throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "The owner declined.");
  }
}
const core = (state: StateStore, approval?: OperationAbandonApprovalPort) => new ApnCore({ state, clock: new TestClock(),
  ids: { next: () => UUID }, ...(approval === undefined ? {} : { operationAbandonApproval: approval }) });

test("an unreadable record is released only with TTY consent; its file and its ledger reservation stay charged", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id, operation } = await s.prepare();
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await s.record(id)).state, "submitted_pending");
  const owner = operation.intent.owner.address, profileHash = operation.profileHash, service = new OperationService(s.state);
  const ledger = new AssetUsageLedger(temporary.root), identity = { account: owner, chain: "eip155:8453",
    asset: { kind: "token" as const, identifier: operation.intent.token } };
  const charged = (await ledger.usage(identity, s.now)).amountAtomic;
  assert.equal(charged, operation.intent.request.grossAtomic);

  // The record is damaged after it was indexed: it now blocks only its own account, and the refusal names the exit.
  const path = join(temporary.root, "gasless-operations", profileHash, `${id}.json`), damaged = JSON.parse(await readFile(path, "utf8"));
  damaged.intent.request.grossAtomic = "1"; await writeFile(path, `${JSON.stringify(damaged)}\n`, { mode: 0o600 });
  const bytes = await readFile(path, "utf8");
  const blocked = await service.assertEvmAccountAvailable(profileHash, 8453, owner).then(() => null, (error: unknown) => error);
  assert.ok(blocked instanceof ApnError && blocked.code === "APN_OPERATION_BLOCKED", String(blocked));
  assert.equal(blocked.details?.blockingReason, "blocking_record_unreadable");
  assert.deepEqual(failureEnvelope("gasless.transfer.prepare", UUID, blocked).next_actions,
    [`apn operation status --operation ${id}`, `apn operation abandon --operation ${id}`]);
  await service.assertEvmAccountAvailable(profileHash, 8453, "0xf41170df51aab52aaa04fbc3ff325cf051644aca");
  const status = await core(s.state).execute({ command: "operation.status", operationId: id });
  assert.equal(status.error?.code, "APN_STATE_CORRUPT"); assert.deepEqual(status.next_actions, [`apn operation abandon --operation ${id}`]);

  // No terminal, or a refused consent: nothing is released.
  assert.equal((await core(s.state).execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  const refused = new Approval(true);
  assert.equal((await core(s.state, refused).execute({ command: "operation.abandon", operationId: id })).ok, false);
  assert.equal(refused.calls.length, 1);
  await assert.rejects(service.assertEvmAccountAvailable(profileHash, 8453, owner), { code: "APN_OPERATION_BLOCKED" });

  const approval = new Approval(), released = await core(s.state, approval).execute({ command: "operation.abandon", operationId: id });
  assert.equal(released.ok, true, JSON.stringify(released.error));
  assert.deepEqual(released.operation, { operation_id: id, family: "gasless_transfer", state: "released",
    record_path: `gasless-operations/${profileHash}/${id}.json`, reason: "record_invalid", proof_class: "owner_acknowledgement_only",
    claims_released: true, record_unchanged: true, ledger_unchanged: true, next_actions: [] });
  assert.equal(approval.calls.length, 1);
  assert.match(approval.calls[0]!.outcomeNote, new RegExp(`gasless-operations/${profileHash}/${id}\\.json \\(record_invalid\\).*stays charged`, "u"));
  assert.equal(await readFile(path, "utf8"), bytes, "the record file is left as it was");
  assert.equal((await ledger.usage(identity, s.now)).amountAtomic, charged, "the reservation stays charged");
  await service.assertEvmAccountAvailable(profileHash, 8453, owner);
  // A second abandon answers the release without asking again.
  const again = await core(s.state, approval).execute({ command: "operation.abandon", operationId: id });
  assert.equal((again.operation as { state: string }).state, "released"); assert.equal(approval.calls.length, 1);
});

test("an admission whose prepare crashed is released at once with TTY consent, before its lease ends", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const profileHash = "1".repeat(64), operationId = "2".repeat(64), account = "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14";
  let started!: () => void; const crashed = new Promise<void>(resolve => { started = resolve; });
  void new OperationIndex(state).admit({ family: "direct_transfer", profileHash, operationId, idempotencyHash: "3".repeat(64), requestHash: "4".repeat(64) },
    { family: "direct_transfer", profileHash, claims: [{ key: `evm:8453:${account}` }] }, async () => { started(); return await new Promise<never>(() => {}); });
  await crashed;
  const service = new OperationService(state);
  await assert.rejects(service.assertEvmAccountAvailable("5".repeat(64), 8453, account), { code: "APN_OPERATION_BLOCKED",
    details: { blockingOperationId: operationId, blockingState: "admitted", blockingNetwork: "evm:8453", blockingAccount: account } });
  const status = await core(state).execute({ command: "operation.status", operationId });
  assert.equal(status.error?.code, "APN_OPERATION_NOT_FOUND"); assert.deepEqual(status.next_actions, [`apn operation abandon --operation ${operationId}`]);
  assert.equal((await core(state).execute({ command: "operation.abandon", operationId })).error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.equal((await new OperationIndex(state).find(operationId))?.state, "admitted");

  const approval = new Approval(), released = await core(state, approval).execute({ command: "operation.abandon", operationId });
  assert.equal(released.ok, true, JSON.stringify(released.error));
  assert.equal((released.operation as { reason: string }).reason, "admission_without_record");
  assert.match(approval.calls[0]!.outcomeNote, /operations\/1{64}\/2{64}\.json \(admission without a record\)/u);
  assert.equal(await new OperationIndex(state).find(operationId), null);
  await service.assertEvmAccountAvailable("5".repeat(64), 8453, account);
});
