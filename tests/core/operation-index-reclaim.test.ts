import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { conflictDomainKey, evmConflictDomain } from "../../src/operation-conflict-domain.js";
import { domainClaims, readableClaims, salvageRecord, standardIdentity, type OperationFamilyAdapter } from "../../src/operation-index/adapter.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import type { OperationRegistry } from "../../src/operation-index/registry.js";
import type { OperationFamily } from "../../src/operation-index/types.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import { pastUnstartedDeadline } from "../../src/unstarted-deadline.js";
import { temporaryState } from "./helpers.js";

/**
 * QA F03, the shared approve-time guard (OperationIndex.reclaim through assertAvailable's `except`): a never-started
 * record that the index let go by the wall clock, read again after the clock went back inside its deadline, holds its
 * account again before its own approve signs. A synthetic family stands in for every family whose index rule releases a
 * never-started record past its deadline plus the unstarted margin.
 */
interface TestRecord { readonly schemaVersion: "test.v1"; readonly operationId: string; readonly profileHash: string; readonly idempotencyHash: string;
  readonly requestHash: string; readonly state: "prepared" | "finalized"; readonly deadline: number; readonly account: string }
class Reader extends SecureStateStore { async read(path: string) { return await this.readJson(path); } }
const P1 = "1".repeat(64), A = "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14", T0 = Date.parse("2026-11-15T10:00:00.000Z");
const id = (n: number) => n.toString(16).padStart(64, "0");
const ACCOUNT = [{ key: conflictDomainKey(evmConflictDomain(8453, A)) }];

async function setup(t: test.TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const clock = { now: T0 };
  const adapter: OperationFamilyAdapter<TestRecord> = {
    family: "swap", stores: [{ directory: "test-reclaim", perProfile: true }],
    load: async (root, recordPath) => await new Reader(root).read(recordPath) as TestRecord | null,
    identity: standardIdentity,
    claims: record => readableClaims(() => domainClaims([evmConflictDomain(8453, record.account)])),
    // The families' own rule: an unstarted record stops holding its account once its deadline plus the margin has passed.
    terminal: record => record.state === "finalized" || record.state === "prepared" && pastUnstartedDeadline(record.deadline, clock.now),
    state: record => record.state,
    salvage: raw => salvageRecord(raw, () => []),
    view: async record => record,
  };
  const registry: OperationRegistry = new Map<OperationFamily, OperationFamilyAdapter>([["swap", adapter as OperationFamilyAdapter]]);
  const index = new OperationIndex(state, registry, () => clock.now);
  const save = async (n: number, fields: Partial<TestRecord> = {}) => {
    const value: TestRecord = { schemaVersion: "test.v1", operationId: id(n), profileHash: P1, idempotencyHash: id(1000 + n), requestHash: id(2000 + n),
      state: "prepared", deadline: T0 + 300_000, account: A, ...fields };
    await mkdir(join(temporary.root, "test-reclaim", P1), { recursive: true, mode: 0o700 });
    await writeFile(join(temporary.root, "test-reclaim", P1, `${value.operationId}.json`), `${canonicalJson(value)}\n`, { mode: 0o600 });
    return value;
  };
  const approveCheck = async (operationId: string) => await index.assertAvailable({ family: null, profileHash: P1, claims: ACCOUNT, except: operationId });
  const entry = async (operationId: string) => (await index.find(operationId))?.state;
  return { clock, index, save, approveCheck, entry };
}
const blockedBy = (operationId: string) => (error: unknown) => {
  const refused = error as { code?: string; details?: Record<string, unknown> };
  return refused.code === "APN_OPERATION_BLOCKED" && refused.details?.blockingOperationId === operationId;
};
const SKEW = 16 * 60_000;

test("a never-started record let go by a clock that ran ahead re-takes its account at its approve check once the clock went back", async t => {
  const s = await setup(t), first = await s.save(1);
  await s.index.reconcile();
  assert.equal(await s.entry(first.operationId), "active");
  s.clock.now = T0 + SKEW;
  await s.index.refresh(first.operationId);
  assert.equal(await s.entry(first.operationId), "terminal", "past its deadline plus the margin it frees its account with no command");
  // Another operation is admitted on the same account meanwhile, then the clock goes back inside the first deadline.
  const second = await s.save(2, { deadline: T0 + SKEW + 300_000 });
  await s.index.reconcile();
  s.clock.now = T0;
  await assert.rejects(s.approveCheck(first.operationId), blockedBy(second.operationId));
  assert.equal(await s.entry(first.operationId), "active", "the approve check re-took the first record's claim");
  await assert.rejects(s.approveCheck(second.operationId), blockedBy(first.operationId));
});

test("the other operation's approve check first: it passes, and the released record is then refused by it", async t => {
  const s = await setup(t), first = await s.save(1);
  await s.index.reconcile();
  s.clock.now = T0 + SKEW; await s.index.refresh(first.operationId);
  const second = await s.save(2, { deadline: T0 + SKEW + 300_000 });
  await s.index.reconcile();
  s.clock.now = T0;
  await s.approveCheck(second.operationId);
  await assert.rejects(s.approveCheck(first.operationId), blockedBy(second.operationId));
});

test("reclaim leaves alone a record its family reads as terminal now, and an entry that already holds its claims", async t => {
  const s = await setup(t), first = await s.save(1);
  await s.index.reconcile();
  s.clock.now = T0 + SKEW; await s.index.refresh(first.operationId);
  // Still past the deadline: its own approve refuses by its deadline, and the index keeps it released.
  await s.approveCheck(first.operationId);
  assert.equal(await s.entry(first.operationId), "terminal");
  // An outcome is never reopened, whatever the clock reads.
  const done = await s.save(3, { state: "finalized" });
  await s.index.reconcile();
  s.clock.now = T0;
  await s.approveCheck(done.operationId);
  assert.equal(await s.entry(done.operationId), "terminal");
  // An open entry is unchanged by its own check, and a released record nobody approves stays released: the guard is
  // re-taken by the released record's own approve, which the second test shows is then refused.
  const open = await s.save(4);
  await s.index.reconcile();
  await s.approveCheck(open.operationId);
  assert.deepEqual([await s.entry(open.operationId), await s.entry(first.operationId)], ["active", "terminal"]);
  await assert.rejects(s.approveCheck(first.operationId), blockedBy(open.operationId));
});
