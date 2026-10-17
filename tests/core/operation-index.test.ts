import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { evmConflictDomain } from "../../src/operation-conflict-domain.js";
import { domainClaims, field, readableClaims, salvageEvm, salvageRecord, standardIdentity, type OperationFamilyAdapter } from "../../src/operation-index/adapter.js";
import { ADMISSION_LEASE_MS, OperationIndex } from "../../src/operation-index/index.js";
import type { OperationRegistry } from "../../src/operation-index/registry.js";
import { OperationIndexStore } from "../../src/operation-index/store.js";
import { profileClaim, type OperationFamily, type PrepareIdentity, type WantedClaims } from "../../src/operation-index/types.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

// The index mechanism on a real state root, with two synthetic families whose records are plain sealed-free JSON. The
// real family adapters are exercised by operation-conflict-domain.test and operation-index-legacy-corpus.test.
interface TestRecord { readonly schemaVersion: "test.v1"; readonly operationId: string; readonly profileHash: string; readonly idempotencyHash: string;
  readonly requestHash: string; readonly state: string; readonly terminal: boolean; readonly chainId: number; readonly account: string; readonly shared?: true }
class Reader extends SecureStateStore { async read(path: string) { return await this.readJson(path); } }
const valid = (value: unknown): value is TestRecord => (value as TestRecord | null)?.schemaVersion === "test.v1" && typeof (value as TestRecord).terminal === "boolean";
function testAdapter(family: OperationFamily, directory: string): OperationFamilyAdapter<TestRecord> {
  return {
    family, stores: [{ directory, perProfile: true }],
    async load(root, recordPath) {
      const value = await new Reader(root).read(recordPath);
      if (value === null) return null;
      if (!valid(value)) throw new ApnError("APN_STATE_CORRUPT", "Synthetic record is invalid.");
      return value;
    },
    identity: standardIdentity,
    claims: record => readableClaims(() => domainClaims([{ ...evmConflictDomain(record.chainId, record.account), ...record.shared ? { shared: true as const } : {} }])),
    terminal: record => record.terminal,
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(field(value, "chainId"), field(value, "account"), field(value, "shared") === true)]),
    view: async record => record,
  };
}
const REGISTRY: OperationRegistry = new Map<OperationFamily, OperationFamilyAdapter>([
  ["direct_transfer", testAdapter("direct_transfer", "test-a") as OperationFamilyAdapter],
  ["rail_transfer", testAdapter("rail_transfer", "test-b") as OperationFamilyAdapter],
]);
const P1 = "1".repeat(64), P2 = "2".repeat(64);
const A = "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14", B = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const id = (n: number) => n.toString(16).padStart(64, "0");
function record(n: number, fields: Partial<TestRecord> = {}): TestRecord {
  return { schemaVersion: "test.v1", operationId: id(n), profileHash: P1, idempotencyHash: id(1000 + n), requestHash: id(2000 + n),
    state: "awaiting_approval", terminal: false, chainId: 8453, account: A, ...fields };
}
async function save(root: string, value: TestRecord | string, directory = "test-a", operationId = typeof value === "string" ? id(99) : value.operationId,
  profileHash = typeof value === "string" ? P1 : value.profileHash): Promise<string> {
  await mkdir(join(root, directory, profileHash), { recursive: true, mode: 0o700 });
  const path = join(root, directory, profileHash, `${operationId}.json`);
  await writeFile(path, typeof value === "string" ? value : `${canonicalJson(value)}\n`, { mode: 0o600 });
  return path;
}
async function setup(t: test.TestContext, now?: () => number) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  return { root: temporary.root, state, index: (at = now) => new OperationIndex(state, REGISTRY, at) };
}
const wants = (profileHash: string | null, account: string, extra: Partial<WantedClaims> = {}, shared = false): WantedClaims =>
  ({ family: "direct_transfer", profileHash, claims: [{ key: `evm:8453:${account}`, ...shared ? { shared: true as const } : {} }], ...extra });
const identity = (r: TestRecord, family: OperationFamily = "direct_transfer"): PrepareIdentity =>
  ({ family, profileHash: r.profileHash, operationId: r.operationId, idempotencyHash: r.idempotencyHash, requestHash: r.requestHash });
const onAccount = (operationId: string, blocking: Record<string, string>, account = A) => ({ code: "APN_OPERATION_BLOCKED",
  message: "Another money operation for this network and account is not terminal.",
  details: { blockingOperationId: operationId, ...blocking, blockingNetwork: "evm:8453", blockingAccount: account } });
async function snapshot(root: string): Promise<ReadonlyMap<string, string>> {
  const base = join(root, "operation-index"), out = new Map<string, string>();
  for (const entry of await readdir(base, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out.set(join(entry.parentPath, entry.name).slice(base.length), await readFile(join(entry.parentPath, entry.name), "utf8"));
  }
  return new Map([...out].sort(([a], [b]) => a < b ? -1 : 1));
}
const exists = async (path: string) => await readFile(path).then(() => true, () => false);

test("admit writes the claim before the record, follows the record, replays and refuses changed inputs", async (t) => {
  const s = await setup(t), r = record(1), index = s.index();
  const done = await index.admit(identity(r), wants(P1, A), async () => {
    assert.equal(JSON.parse(await readFile(join(s.root, "operation-index", "open", `${r.operationId}.json`), "utf8")).state, "admitted");
    await assert.rejects(s.index().assertAvailable(wants(P2, A)), onAccount(r.operationId, { blockingState: "admitted" }));
    await save(s.root, r);
    return "done";
  });
  assert.equal(done, "done");
  const entry = await index.find(r.operationId);
  assert.deepEqual([entry?.state, entry?.admittedAt, entry?.claims], ["active", null, [{ key: `evm:8453:${A}` }, profileClaim(P1)]]);
  assert.deepEqual(await index.resolvePrepare(identity(r)), entry);
  await assert.rejects(index.resolvePrepare({ ...identity(r), requestHash: id(7) }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(index.admit(identity(r), wants(P1, A), async () => "again"), { code: "APN_IDEMPOTENCY_CONFLICT" });
  // The same operation ID admitted by another family under another key is refused before any claim.
  await assert.rejects(index.admit({ ...identity(r, "rail_transfer"), idempotencyHash: id(8) }, wants(P1, B), async () => "other"), { code: "APN_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(s.index().assertAvailable(wants(P2, A)), onAccount(r.operationId, { blockingState: "awaiting_approval" }));
  await s.index().assertAvailable(wants(P2, B));
});

test("one operation ID saved by two families is corrupt and holds what both copies hold", async (t) => {
  const s = await setup(t);
  await save(s.root, record(2)); await save(s.root, record(2, { account: B }), "test-b");
  const entry = await s.index().find(id(2));
  assert.equal(entry?.unreadableReason, "duplicate_operation_id");
  assert.deepEqual(entry?.claims.map(claim => claim.key).sort(), [`evm:8453:${A}`, `evm:8453:${B}`, `profile:${P1}`]);
  await assert.rejects(s.index().assertAvailable(wants(P2, B)), onAccount(id(2), { blockingReason: "blocking_record_unreadable" }, B));
});

test("exclusive and shared claims collide in both orders; shared claims coexist; except skips the caller's own", async (t) => {
  const s = await setup(t);
  await save(s.root, record(3, { shared: true }));
  await s.index().assertAvailable(wants(P1, A, {}, true));
  await assert.rejects(s.index().assertAvailable(wants(P1, A)), onAccount(id(3), { blockingState: "awaiting_approval" }));
  await s.index().assertAvailable(wants(P1, A, { except: id(3) }));
  await save(s.root, record(4, { account: B }));
  await assert.rejects(s.index().assertAvailable(wants(P1, B, {}, true)), onAccount(id(4), { blockingState: "awaiting_approval" }, B));
});

test("terminal records are collected lazily: by a colliding check or by the amortized collection", async (t) => {
  const s = await setup(t), open = (n: number) => join(s.root, "operation-index", "open", `${id(n)}.json`);
  await save(s.root, record(5)); await save(s.root, record(6, { account: B }));
  await s.index().reconcile();
  assert.equal(await exists(open(5)), true); assert.equal(await exists(open(6)), true);
  await save(s.root, record(5, { state: "completed", terminal: true })); await save(s.root, record(6, { state: "completed", terminal: true, account: B }));
  await s.index().assertAvailable(wants(P1, A));
  assert.equal(await exists(open(5)), false, "the colliding terminal record is collected");
  assert.equal(await exists(open(6)), false, "one other open record is verified per check");
  assert.equal((await s.index().find(id(6)))?.state, "terminal");
  assert.deepEqual((await s.index().find(id(5)))?.claims, []);
});

test("an unreadable record blocks only the accounts its bytes still name", async (t) => {
  const s = await setup(t);
  await save(s.root, { ...record(7), schemaVersion: "broken" } as unknown as TestRecord);
  await save(s.root, record(8, { account: B, profileHash: P2 }));
  await assert.rejects(s.index().assertAvailable(wants(P1, A)), onAccount(id(7), { blockingReason: "blocking_record_unreadable" }));
  await assert.rejects(s.index().assertAvailable(wants(P2, A)), onAccount(id(7), { blockingReason: "blocking_record_unreadable" }));
  await s.index().assertAvailable(wants(P1, "0x823a3a5bab1186141b32fc65f8e25ca24c679ce7"));
  await s.index().assertAvailable({ family: "rail_transfer", profileHash: P1, claims: [{ key: "evm:1:" + A }] });
  // Other operations keep answering: no read of any other record goes through the broken one.
  assert.equal((await s.index().find(id(8)))?.state, "active");
  assert.equal(await s.index().resolvePrepare(identity(record(9))), null);
  // A record that breaks after it was indexed is quarantined the same way when a check meets it.
  await save(s.root, { ...record(8, { account: B, profileHash: P2 }), terminal: "no" } as unknown as TestRecord);
  await assert.rejects(s.index().assertAvailable(wants(P1, B)), onAccount(id(8), { blockingReason: "blocking_record_unreadable" }, B));
  assert.equal((await s.index().find(id(8)))?.state, "unreadable");
});

test("bytes that name no account quarantine their profile only, until the owner releases them", async (t) => {
  const s = await setup(t), path = await save(s.root, "{not json", "test-a", id(10));
  const profileWide = { code: "APN_OPERATION_BLOCKED", message: "Another money operation for this profile is not terminal.",
    details: { blockingOperationId: id(10), blockingReason: "blocking_record_unreadable" } };
  await assert.rejects(s.index().assertAvailable(wants(P1, B)), profileWide);
  await s.index().assertAvailable(wants(P2, A));
  assert.equal((await s.index().find(id(10)))?.unreadableReason, "record_not_json");
  await assert.rejects(s.index().releaseByOwner(id(10), { approve: async () => { throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "declined"); } }),
    { code: "APN_FOREGROUND_APPROVAL_REQUIRED" });
  await assert.rejects(s.index().assertAvailable(wants(P1, B)), profileWide);
  const intents: unknown[] = [];
  const released = await s.index().releaseByOwner(id(10), { approve: async intent => { intents.push(intent); } });
  assert.deepEqual([released.state, released.claims], ["released", []]);
  assert.match(JSON.stringify(intents), /test-a\/1{64}\/0{62}0a\.json \(record_not_json\)/u);
  await s.index().assertAvailable(wants(P1, B));
  assert.equal(await readFile(path, "utf8"), "{not json", "the record file is left as it was");
  // A readable record never takes this exit; and once a reader accepts the released record again, it holds its claims.
  await save(s.root, record(11));
  await assert.rejects(s.index().releaseByOwner(id(11), { approve: async () => {} }), { code: "APN_OPERATION_BLOCKED" });
  await save(s.root, record(10, { account: B }));
  await s.index().assertAvailable(wants(P2, "0x823a3a5bab1186141b32fc65f8e25ca24c679ce7"));
  await assert.rejects(s.index().assertAvailable(wants(P1, B)), onAccount(id(10), { blockingState: "awaiting_approval" }, B));
});

test("an orphaned admission blocks for its lease only, and the same identity replaces it at once", async (t) => {
  const s = await setup(t), r = record(12);
  let started!: () => void; const crashed = new Promise<void>(resolve => { started = resolve; });
  void s.index().admit(identity(r), wants(P1, A), async () => { started(); return await new Promise<never>(() => {}); });
  await crashed;
  await assert.rejects(s.index().assertAvailable(wants(P2, A)), onAccount(r.operationId, { blockingState: "admitted" }));
  await s.index(() => Date.now() + ADMISSION_LEASE_MS + 1_000).assertAvailable(wants(P2, A));
  assert.equal(await s.index().find(r.operationId), null);
  assert.equal(await exists(join(s.root, "operation-index", "idempotency", `${r.idempotencyHash}.json`)), false);
  let again!: () => void; const crashedAgain = new Promise<void>(resolve => { again = resolve; });
  void s.index().admit(identity(r), wants(P1, A), async () => { again(); return await new Promise<never>(() => {}); });
  await crashedAgain;
  assert.equal(await s.index().admit(identity(r), wants(P1, A), async () => { await save(s.root, r); return "retried"; }), "retried");
  assert.equal((await s.index().find(r.operationId))?.state, "active");
});

test("a failed prepare body removes its admission", async (t) => {
  const s = await setup(t), r = record(13);
  await assert.rejects(s.index().admit(identity(r), wants(P1, A), async () => { throw new Error("rpc refused"); }), /rpc refused/u);
  assert.equal(await s.index().find(r.operationId), null);
  assert.equal(await s.index().resolvePrepare(identity(r)), null);
  assert.deepEqual([...await snapshot(s.root)], []);
  await s.index().assertAvailable(wants(P2, A));
});

test("a crash after any index write converges to the files of an uninterrupted run", async (t) => {
  const records = [record(14), record(15, { state: "completed", terminal: true, account: B }), record(16, { profileHash: P2 })];
  const clean = await setup(t);
  for (const r of records) await save(clean.root, r);
  await clean.index().reconcile();
  const expected = await snapshot(clean.root);
  for (const step of ["putOpen", "putEntry"] as const) {
    const s = await setup(t);
    for (const r of records) await save(s.root, r);
    const original = OperationIndexStore.prototype[step];
    OperationIndexStore.prototype[step] = async function () { throw new Error(`crash before ${step}`); };
    try { await assert.rejects(s.index().reconcile(), new RegExp(`crash before ${step}`, "u")); }
    finally { OperationIndexStore.prototype[step] = original; }
    await s.index().reconcile();
    assert.deepEqual(await snapshot(s.root), expected, step);
  }
  // An admission interrupted between its pointer and its entry is replaced by the same identity's retry.
  for (const step of ["putOpen", "putEntry"] as const) {
    const s = await setup(t), r = record(14);
    const original = OperationIndexStore.prototype[step];
    OperationIndexStore.prototype[step] = async function () { throw new Error(`crash before ${step}`); };
    try { await assert.rejects(s.index().admit(identity(r), wants(P1, A), async () => "never"), /crash before/u); }
    finally { OperationIndexStore.prototype[step] = original; }
    assert.equal(await s.index().admit(identity(r), wants(P1, A), async () => { await save(s.root, r); return "ok"; }), "ok");
    assert.deepEqual((await snapshot(s.root)).get(`/entries/${r.operationId}.json`), expected.get(`/entries/${r.operationId}.json`), `admit ${step}`);
  }
});

test("reconciling twice and rebuilding after removing operation-index give identical files; foreign names are not records", async (t) => {
  const s = await setup(t);
  await save(s.root, record(17)); await save(s.root, record(18, { state: "completed", terminal: true, profileHash: P2 }));
  await save(s.root, record(19, { shared: true }), "test-b"); await save(s.root, "[1]", "test-b", id(20));
  for (const path of [join(s.root, "test-a", ".DS_Store"), join(s.root, "test-a", P1, ".DS_Store"),
    join(s.root, "test-a", P1, `.${"a".repeat(12)}.${"b".repeat(24)}.tmp`), join(s.root, "test-b", P1, "native.123.456.tmp")]) {
    await writeFile(path, "foreign", { mode: 0o600 });
  }
  await s.index().reconcile();
  const first = await snapshot(s.root);
  assert.deepEqual([...first.keys()].filter(key => key.startsWith("/entries/")).length, 4);
  await s.index().reconcile();
  assert.deepEqual(await snapshot(s.root), first);
  await rm(join(s.root, "operation-index"), { recursive: true });
  await s.index().reconcile();
  assert.deepEqual(await snapshot(s.root), first);
});

test("a damaged index file is removed and re-derived from the records", async (t) => {
  const s = await setup(t);
  await save(s.root, record(21));
  await s.index().reconcile();
  const expected = await snapshot(s.root);
  const reads: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    [`open/${id(21)}.json`, async () => await assert.rejects(s.index().assertAvailable(wants(P2, A)), onAccount(id(21), { blockingState: "awaiting_approval" }))],
    [`entries/${id(21)}.json`, async () => assert.equal((await s.index().find(id(21)))?.state, "active")],
    [`idempotency/${id(1021)}.json`, async () => assert.equal((await s.index().findByIdempotency(id(1021)))?.operationId, id(21))],
  ];
  for (const [path, read] of reads) {
    await writeFile(join(s.root, "operation-index", path), "{\"damaged\":true}\n", { mode: 0o600 });
    await read();
    assert.deepEqual(await snapshot(s.root), expected, path);
  }
});
