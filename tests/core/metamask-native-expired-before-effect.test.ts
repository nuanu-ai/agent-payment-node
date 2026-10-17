import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { seal, withoutDigest } from "../../src/asset-usage-ledger-record.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import { METAMASK_NATIVE_RESOLVED_STATES, METAMASK_NATIVE_STATES, MetaMaskNativeJournal, metaMaskNativeExpiredBeforeEffect, metaMaskNativeResolved,
  type MetaMaskNativeOperation } from "../../src/metamask-native-journal.js";
import { closeExpiredNativeTransfersOf } from "../../src/metamask-native-transfer-owner.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { entryOf } from "../../src/operation-index/reconcile.js";
import { OperationIndexStore } from "../../src/operation-index/store.js";
import { StateStore } from "../../src/state.js";
import { UNSTARTED_DEADLINE_MARGIN_MS } from "../../src/unstarted-deadline.js";
import { metaMaskNative, NoSecret } from "./operation-commands-families.js";

/**
 * MetaMask native R4: a transfer whose foreground command died before its effect marker (still `prepared`, nothing handed
 * off or signed) and whose consent has passed can never start. It no longer holds back other native transfers of its
 * account, and its next status (or the next transfer's admission) closes it as failed before effect and releases its
 * usage holds. A transfer whose effect was attempted (`unknown`) keeps its owner-consented exit and is never auto-closed.
 */
const DIRECTORY = "metamask-native-operations";
const OTHER = "0".repeat(64);
class Approval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  async approve(intent: OperationAbandonIntent): Promise<void> { this.calls.push(intent); }
}

/** Every ledger row of the state, by reservation ID, with its path. */
async function ledgerRows(root: string): Promise<ReadonlyMap<string, { readonly path: string; readonly row: Record<string, unknown> }>> {
  const rows = new Map<string, { path: string; row: Record<string, unknown> }>();
  for (const name of await readdir(join(root, "asset-usage"), { recursive: true })) {
    if (!/[a-f0-9]{64}\.json$/u.test(name)) continue;
    const path = join(root, "asset-usage", name), row = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    rows.set(row.reservationId as string, { path, row });
  }
  return rows;
}

/**
 * A released corpus transfer rewritten as its foreground command left it when it died after reserving its usage and
 * before its effect marker: `prepared`, no attempt, both holds still `reserved` in the ledger.
 */
async function crashedPrepared(t: TestContext): Promise<{ readonly root: string; readonly id: string; readonly op: MetaMaskNativeOperation }> {
  const native = await metaMaskNative(t, "45-v0543-metamask-native-driver-resolver-late", "failed_before_effect");
  const path = join(native.root, DIRECTORY, `${native.id}.json`);
  const { recordHash: _hash, diagnostic: _diagnostic, ...saved } = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const body = { ...saved, state: "prepared", effectAttempts: 0, transactionHash: null, providerRequestId: null, receiptEvidence: null };
  await writeFile(path, `${canonicalJson({ ...body, recordHash: hashObject(body) })}\n`, { mode: 0o600 });
  const op = (await new MetaMaskNativeJournal(native.root).read(native.id))!;
  const rows = await ledgerRows(native.root);
  for (const reservation of op.reservations) {
    const { path: rowPath, row } = rows.get(reservation.reservationId)!;
    const { consumedAtomic: _consumed, ...current } = withoutDigest(row as never) as unknown as Record<string, unknown>;
    const reserved = seal({ ...current, state: "reserved", updatedAt: current.reservedAt, effectAt: null, outcomeDigest: null } as never);
    await writeFile(rowPath, `${canonicalJson(reserved)}\n`, { mode: 0o600 });
  }
  return { root: native.root, id: native.id, op };
}

/** The entry an earlier index walk wrote while the transfer was still inside its consent window. */
async function staleOpenEntry(root: string, op: MetaMaskNativeOperation): Promise<void> {
  const store = new OperationIndexStore(root), entry = entryOf({ operationId: op.operationId, family: "metamask_native",
    profileHash: op.context.profileHash, idempotencyHash: null, requestHash: op.requestHash, recordPath: `${DIRECTORY}/${op.operationId}.json`,
    claims: [{ key: `evm:${op.context.quote.chainId}:${op.context.quote.sender.toLowerCase()}` }, { key: `profile:${op.context.profileHash}` }],
    state: "active", admittedAt: null });
  await store.putOpen(entry); await store.putEntry(entry);
}
const openExists = async (root: string, id: string) => await stat(join(root, "operation-index", "open", `${id}.json`)).then(() => true, () => false);

async function assertClosed(root: string, op: MetaMaskNativeOperation): Promise<void> {
  const closed = (await new MetaMaskNativeJournal(root).read(op.operationId))!;
  assert.deepEqual([closed.state, closed.effectAttempts, closed.transactionHash], ["failed_before_effect", 0, null]);
  const rows = await ledgerRows(root);
  for (const reservation of op.reservations) {
    const { row } = rows.get(reservation.reservationId)!;
    assert.deepEqual([row.state, row.outcomeDigest], ["failed_before_effect", hashObject({ id: op.operationId, kind: "failed_before_effect" })]);
  }
  const entry = await new OperationIndex(new StateStore(root)).find(op.operationId);
  assert.deepEqual([entry?.state, entry?.claims], ["terminal", []]);
  assert.equal(await openExists(root, op.operationId), false);
}

test("the family's rule: only a transfer that never reached its effect marker expires, and only after consent plus the margin", async (t) => {
  const { op } = await crashedPrepared(t), consent = Date.parse(op.context.consentExpiresAt), late = consent + UNSTARTED_DEADLINE_MARGIN_MS;
  assert.equal(metaMaskNativeExpiredBeforeEffect(op, late - 1), false, "inside the margin a stalled command may still write its marker");
  assert.equal(metaMaskNativeExpiredBeforeEffect(op, late), true);
  for (const state of METAMASK_NATIVE_STATES) {
    const attempted = { ...op, state, effectAttempts: state === "prepared" ? 0 as const : 1 as const };
    assert.equal(metaMaskNativeResolved(attempted, late - 1), METAMASK_NATIVE_RESOLVED_STATES.includes(state), state);
    // An attempted effect (effect_started, acknowledged, unknown) is never closed by time: its exit is the owner abandon.
    if (state !== "prepared") assert.equal(metaMaskNativeExpiredBeforeEffect(attempted, Number.MAX_SAFE_INTEGER), false, state);
  }
});

test("a crashed prepared transfer past its consent no longer holds back another transfer of its account", async (t) => {
  const { root, op } = await crashedPrepared(t), journal = new MetaMaskNativeJournal(root);
  await journal.assertAccountAvailable(op.context.quote.chainId, op.context.quote.sender, OTHER);
  const unknown = await metaMaskNative(t, "44-v0543-metamask-native-driver-no-rid", "unknown"), held = (await new MetaMaskNativeJournal(unknown.root).read(unknown.id))!;
  await assert.rejects(new MetaMaskNativeJournal(unknown.root).assertAccountAvailable(held.context.quote.chainId, held.context.quote.sender, OTHER),
    { code: "APN_OPERATION_BLOCKED" });
});

test("operation status closes it as failed before effect, releases its holds and drops its index claims at once", async (t) => {
  const { root, id, op } = await crashedPrepared(t), approval = new Approval();
  await staleOpenEntry(root, op);
  // Terminal by the family's rule already: abandon names no exit and asks no consent.
  const abandon = await runCli(["operation", "abandon", "--operation", id], {}, { stateRoot: root, operationAbandonApproval: approval, wrappingSecret: new NoSecret() });
  assert.equal(abandon.error?.details?.reason, "operation_already_terminal", JSON.stringify(abandon.error));
  assert.deepEqual(abandon.next_actions, [`apn operation status --operation ${id}`]);
  assert.equal(approval.calls.length, 0);
  const status = await runCli(["operation", "status", "--operation", id], {}, { stateRoot: root, wrappingSecret: new NoSecret() });
  assert.equal(status.ok, true, JSON.stringify(status.error));
  assert.match(JSON.stringify(status.data), /failed_before_effect/u);
  await assertClosed(root, op);
});

test("the next transfer's admission closes it the same way", async (t) => {
  const { root, op } = await crashedPrepared(t);
  await staleOpenEntry(root, op);
  await closeExpiredNativeTransfersOf(root, op.context.quote.chainId, op.context.quote.sender.toLowerCase());
  await assertClosed(root, op);
});

test("an unknown outcome is never closed by status; it keeps its claims and its owner exit", async (t) => {
  const native = await metaMaskNative(t, "44-v0543-metamask-native-driver-no-rid", "unknown");
  const status = await runCli(["operation", "status", "--operation", native.id], {}, { stateRoot: native.root, wrappingSecret: new NoSecret() });
  assert.equal(status.ok, true, JSON.stringify(status.error));
  assert.equal((await new MetaMaskNativeJournal(native.root).read(native.id))?.state, "unknown");
  const entry = await new OperationIndex(new StateStore(native.root)).find(native.id);
  assert.equal(entry?.state, "active");
  assert.ok((entry?.claims.length ?? 0) > 0);
});
