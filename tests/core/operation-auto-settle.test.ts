import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import type { BoundCommand } from "../../src/command-binder.js";
import type { CommandRequest, OutputEnvelope } from "../../src/commands.js";
import { ApnError } from "../../src/errors.js";
import { evmConflictDomain } from "../../src/operation-conflict-domain.js";
import { settleBlockerAndRetry, type BlockerRuntime } from "../../src/operation-auto-settle.js";
import { withBlockerGuidance } from "../../src/operation-blocker-guidance.js";
import { domainClaims, readableClaims, salvageRecord, standardIdentity, type OperationFamilyAdapter } from "../../src/operation-index/adapter.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import type { OperationRegistry } from "../../src/operation-index/registry.js";
import type { OperationFamily } from "../../src/operation-index/types.js";
import { closedBlockerNotes, failureEnvelope, successEnvelope } from "../../src/output.js";
import type { RuntimeContext } from "../../src/runtime.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import { temporaryState, UUID } from "./helpers.js";

// The boundary wrapper on a real state root, with a synthetic family whose settle port is scripted per test. The direct
// transfer port itself is exercised end to end in direct-transfer-settle.test.
interface TestRecord { readonly schemaVersion: "test.v1"; readonly operationId: string; readonly profileHash: string; readonly idempotencyHash: string;
  readonly requestHash: string; readonly state: string; readonly terminal: boolean; readonly account: string }
class Reader extends SecureStateStore { async read(path: string) { return await this.readJson(path); } }
type Port = (record: TestRecord) => Promise<string | null>;
function adapter(family: OperationFamily, directory: string, port?: Port, observeCommand?: string): OperationFamilyAdapter<TestRecord> {
  return {
    family, stores: [{ directory, perProfile: true }],
    load: async (root, recordPath) => await new Reader(root).read(recordPath) as TestRecord | null,
    identity: standardIdentity,
    claims: record => readableClaims(() => domainClaims([evmConflictDomain(8453, record.account)])),
    terminal: record => record.terminal,
    state: record => record.state,
    salvage: raw => salvageRecord(raw, () => []),
    view: async record => record,
    ...(port === undefined ? {} : { settleIfNeverLands: async (_context: RuntimeContext, record: TestRecord) => await port(record) }),
    ...(observeCommand === undefined ? {} : { observeCommand }),
  };
}
const P1 = "1".repeat(64), A = "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14";
const id = (n: number) => n.toString(16).padStart(64, "0");
const record = (n: number, fields: Partial<TestRecord> = {}): TestRecord => ({ schemaVersion: "test.v1", operationId: id(n), profileHash: P1,
  idempotencyHash: id(1000 + n), requestHash: id(2000 + n), state: "submitted_pending", terminal: false, account: A, ...fields });
async function save(root: string, value: TestRecord, directory = "test-a"): Promise<void> {
  await mkdir(join(root, directory, value.profileHash), { recursive: true, mode: 0o700 });
  await writeFile(join(root, directory, value.profileHash, `${value.operationId}.json`), `${canonicalJson(value)}\n`, { mode: 0o600 });
}
const PREPARE = { command: "transfer.prepare", profile: "default", idempotencyKey: "next-0001", recipient: A, amount: "1" } as const satisfies CommandRequest;
const blocked = (blocker: string, state: string, command = "transfer.prepare") => failureEnvelope(command, UUID, new ApnError("APN_OPERATION_BLOCKED",
  "Another money operation for this network and account is not terminal.", { blockingOperationId: blocker, blockingState: state,
    blockingNetwork: "evm:8453", blockingAccount: A }));
const prepared = successEnvelope(PREPARE, UUID, { proofClass: "durable_pre_effect", data: null, operation: { operation_id: id(7) }, receipt: null, nextActions: [] });

async function setup(t: test.TestContext, port?: Port) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const settles: TestRecord[] = [], runtimes: [string, CommandRequest["command"]][] = [];
  const registry: OperationRegistry = new Map<OperationFamily, OperationFamilyAdapter>([
    ["direct_transfer", adapter("direct_transfer", "test-a", port === undefined ? undefined : async r => { settles.push(r); return await port(r); }) as OperationFamilyAdapter],
    ["rail_transfer", adapter("rail_transfer", "test-b") as OperationFamilyAdapter],
  ]);
  const runtime: BlockerRuntime = (operationId, command) => { runtimes.push([operationId, command]); return {} as RuntimeContext; };
  // Scripted answers of the command itself, one per run; the test fails when the wrapper runs it more often.
  const answers: OutputEnvelope[] = [];
  let runs = 0;
  const run = async () => { runs += 1; const next = answers.shift(); assert.ok(next !== undefined, "the command ran more often than scripted"); return next; };
  const settle = async (request: CommandRequest = PREPARE) => await settleBlockerAndRetry({ request } satisfies BoundCommand, temporary.root, run, runtime, registry);
  return { root: temporary.root, registry, settles, runtimes, answers, runs: () => runs, settle, index: () => new OperationIndex(state, registry) };
}

test("a proven blocker is settled once in its own runtime, the prepare runs again once, and the success names it", async (t) => {
  const s = await setup(t, async r => { await save(s.root, { ...r, state: "failed_proven_superseded", terminal: true }); return "finalized_nonce_without_receipt"; });
  await save(s.root, record(1));
  s.answers.push(blocked(id(1), "submitted_pending"), prepared);
  const out = await s.settle();
  assert.equal(out.ok, true);
  assert.deepEqual(out.closed_blockers, [{ operation_id: id(1), family: "direct_transfer", state: "failed_proven_superseded", proof: "finalized_nonce_without_receipt" }]);
  assert.deepEqual({ ...out, closed_blockers: undefined }, { ...prepared, closed_blockers: undefined }, "the retry's own envelope, plus the field");
  assert.deepEqual([s.runs(), s.settles.length, s.runtimes], [2, 1, [[id(1), "operation.settle"]]]);
  assert.deepEqual([(await s.index().find(id(1)))?.state, (await s.index().find(id(1)))?.claims], ["terminal", []], "the entry followed at once");
  assert.deepEqual(closedBlockerNotes(out), [`Closed earlier operation ${id(1)} (direct_transfer): its outcome is final (failed_proven_superseded), so it no longer blocks.`]);
});

test("nothing proven, or a settle that fails, answers the first refusal with only the observation added; nothing runs again", async (t) => {
  for (const [port, observation] of [[async () => null, "not_proven"], [async () => { throw new ApnError("APN_RPC_CONFIG", "no rpc"); }, "unavailable"],
    [async () => { throw new Error("socket closed"); }, "unavailable"]] as const) {
    const s = await setup(t, port);
    await save(s.root, record(1));
    const first = blocked(id(1), "submitted_pending");
    s.answers.push(first);
    const out = await s.settle();
    assert.deepEqual(out, { ...first, error: { ...first.error!, details: { ...first.error!.details, blocker_observation: observation } } }, observation);
    assert.deepEqual([s.runs(), s.settles.length, Object.hasOwn(out, "closed_blockers")], [1, 1, false]);
    assert.equal((await s.index().find(id(1)))?.state, "active");
  }
});

test("a port that claims a proof its record does not show is not believed: no retry", async (t) => {
  const s = await setup(t, async () => "finalized_nonce_without_receipt");
  await save(s.root, record(1, { state: "unknown_finality" }));
  const first = blocked(id(1), "unknown_finality");
  s.answers.push(first);
  const out = await s.settle();
  assert.equal(out.error?.details?.blocker_observation, "not_proven");
  assert.deepEqual([s.runs(), s.settles.length], [1, 1]);
});

test("a second refusal after a settle answers the first refusal unchanged; the blocker is settled at most once", async (t) => {
  const s = await setup(t, async r => { await save(s.root, { ...r, state: "failed_proven_superseded", terminal: true }); return "finalized_nonce_without_receipt"; });
  await save(s.root, record(1)); await save(s.root, record(2));
  const first = blocked(id(1), "submitted_pending");
  s.answers.push(first, blocked(id(2), "submitted_pending"));
  const out = await s.settle();
  assert.deepEqual(out, first);
  assert.deepEqual([s.runs(), s.settles.map(r => r.operationId)], [2, [id(1)]], "the second blocker is not settled by this invocation");
  assert.equal((await s.index().find(id(2)))?.state, "active");
});

test("the refusal is returned unchanged without a port, for another command, without a named blocker, or when the index does not confirm it", async (t) => {
  const port = async (): Promise<string> => { throw new Error("must not settle"); };
  const cases: { readonly name: string; readonly answer: (s: Awaited<ReturnType<typeof setup>>) => Promise<OutputEnvelope>; readonly request?: CommandRequest }[] = [
    { name: "family without a port", answer: async s => { await save(s.root, record(3, { account: A }), "test-b"); return blocked(id(3), "submitted_pending"); } },
    { name: "not an allowlisted prepare", request: { command: "transfer.approve", operationId: id(1) },
      answer: async s => { await save(s.root, record(1)); return blocked(id(1), "submitted_pending", "transfer.approve"); } },
    { name: "no blocking operation ID", answer: async () => failureEnvelope("transfer.prepare", UUID, new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.")) },
    { name: "an unreadable blocker", answer: async s => { await save(s.root, record(1)); return failureEnvelope("transfer.prepare", UUID, new ApnError("APN_OPERATION_BLOCKED",
      "Another money operation for this profile is not terminal.", { blockingOperationId: id(1), blockingReason: "blocking_record_unreadable" })); } },
    { name: "another error code", answer: async () => failureEnvelope("transfer.prepare", UUID, new ApnError("APN_STATE_BUSY", "busy", { blockingOperationId: id(1), blockingState: "x" })) },
    { name: "no index entry", answer: async () => blocked(id(9), "submitted_pending") },
    { name: "the record moved on since the refusal", answer: async s => { await save(s.root, record(1, { state: "unknown_finality" })); return blocked(id(1), "submitted_pending"); } },
    { name: "a terminal entry", answer: async s => { await save(s.root, record(1, { state: "completed", terminal: true })); return blocked(id(1), "completed"); } },
  ];
  for (const { name, answer, request } of cases) {
    const s = await setup(t, port), first = await answer(s);
    s.answers.push(first);
    assert.deepEqual(await s.settle(request), first, name);
    assert.deepEqual([s.runs(), s.settles.length, s.runtimes.length], [1, 0, 0], name);
  }
});

test("an envelope with nothing closed carries no closed_blockers field", async (t) => {
  const s = await setup(t, async () => { throw new Error("must not settle"); });
  s.answers.push(prepared);
  const out = await s.settle();
  assert.deepEqual(out, prepared);
  assert.equal(Object.hasOwn(out, "closed_blockers"), false);
  assert.deepEqual(closedBlockerNotes(out), []);
});

test("a blocked refusal names the family's observing command where its status only reads; explicit next actions stay", async (t) => {
  const s = await setup(t);
  const registry: OperationRegistry = new Map<OperationFamily, OperationFamilyAdapter>([
    ["direct_transfer", adapter("direct_transfer", "test-a", undefined, "apn operation resume --operation <operation-id>") as OperationFamilyAdapter],
    ["rail_transfer", adapter("rail_transfer", "test-b") as OperationFamilyAdapter],
  ]);
  await save(s.root, record(1)); await save(s.root, record(2), "test-b");
  assert.deepEqual((await withBlockerGuidance(blocked(id(1), "submitted_pending"), s.root, registry)).next_actions, [`apn operation resume --operation ${id(1)}`]);
  assert.deepEqual((await withBlockerGuidance(blocked(id(2), "submitted_pending"), s.root, registry)).next_actions, [`apn operation status --operation ${id(2)}`],
    "a family whose status observes keeps it");
  const explicit = failureEnvelope("transfer.prepare", UUID, new ApnError("APN_OPERATION_BLOCKED", "held", { blockingOperationId: id(1), blockingState: "submitted_pending",
    nextActions: ["apn wallet connect"] }));
  assert.deepEqual(await withBlockerGuidance(explicit, s.root, registry), explicit);
  const unknown = blocked(id(9), "submitted_pending");
  assert.deepEqual(await withBlockerGuidance(unknown, s.root, registry), unknown);
});
