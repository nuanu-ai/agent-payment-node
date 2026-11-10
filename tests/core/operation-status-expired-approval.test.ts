import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnCore } from "../../src/core.js";
import { StateStore } from "../../src/state.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState, TestClock } from "./helpers.js";

/**
 * QA on 0.5.101: a prepared transfer whose approval window had passed still read `awaiting_approval` in `apn operation
 * status` and named its approve step, which its family refuses from that deadline on. Status now presents it as expired
 * and names no approve. It stays a pure read: the stored record (and every receipt derived from it) is unchanged.
 */
const APPROVE = /^apn (?:pay|gasless) transfer approve /u;

function operationView(result: OutputEnvelope, label: string): Record<string, unknown> {
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.error)}`);
  return result.operation as Record<string, unknown>;
}
function assertOpen(result: OutputEnvelope, label: string): void {
  assert.equal(operationView(result, label).state, "awaiting_approval", label);
  assert.ok(result.next_actions.some(action => APPROVE.test(action)), `${label}: approve is named while the window is open`);
}
function assertExpired(result: OutputEnvelope, label: string): void {
  const view = operationView(result, label);
  assert.deepEqual([view.state, view.stored_state, view.reason], ["expired", "awaiting_approval", "approval_window_expired"], label);
  assert.equal(view.terminal, false, `${label}: the stored record is still open`);
  for (const action of [...view.next_actions as readonly string[], ...result.next_actions]) assert.doesNotMatch(action, APPROVE, label);
}

test("a direct EVM transfer past its approval deadline reads as expired, names no approve and keeps its record", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, idempotencyKey: "expired-status-0001" }) as
    { readonly operation_id: string; readonly expires_at: string };
  const id = prepared.operation_id, deadline = Date.parse(prepared.expires_at), stored = await setup.state.findOperation(id);
  assert.equal(stored?.state, "awaiting_approval");
  setup.clock.value = new Date(deadline - 1);
  assertOpen(await setup.core.execute({ command: "operation.status", operationId: id }), "direct before the deadline");
  setup.clock.value = new Date(deadline);
  const expired = await setup.core.execute({ command: "operation.status", operationId: id });
  assertExpired(expired, "direct at the deadline");
  assert.deepEqual(operationView(expired, "direct").next_actions, [`apn operation status --operation ${id}`]);
  assert.deepEqual(await setup.state.findOperation(id), stored, "status never writes the record");
});

interface Golden {
  readonly operation: { readonly profileHash: string; readonly operationId: string;
    readonly prepared?: { readonly expiresAt: string }; readonly intent?: { readonly expiresAt: string } };
  readonly receipt: { readonly state: string };
}
/** The awaiting-approval record a released version wrote, as the derived-receipt goldens pin it, and where its deadline is. */
const GOLDEN = [
  ["rail", "rail-operations", "prepared"],
  ["gasless", "gasless-operations", "intent"],
  ["metamask-gasless", "metamask-gasless-operations", "intent"],
  ["smart-account-gasless", "smart-account-gasless-operations", "intent"],
  ["facilitator-gasless", "facilitator-gasless-operations", "intent"],
] as const;

test("a Solana or gasless transfer past its approval deadline reads as expired, names no approve and keeps its record", async (t) => {
  for (const [file, directory, holder] of GOLDEN) {
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
      assertExpired(await core.execute({ command: "operation.status", operationId: operation.operationId }), `${file} at the deadline`);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), operation, `${file}: status never writes the record`);
    });
  }
});
