import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { evmConflictDomain } from "../../src/operation-conflict-domain.js";
import { domainClaims, field, readableClaims, salvageEvm, salvageRecord, standardIdentity, type OperationFamilyAdapter } from "../../src/operation-index/adapter.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import type { OperationRegistry } from "../../src/operation-index/registry.js";
import { OperationIndexStore } from "../../src/operation-index/store.js";
import type { OperationFamily, PrepareIdentity, WantedClaims } from "../../src/operation-index/types.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { SERVER_MODE_ENV } from "../../src/server-mode.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

// Server mode: the operation index locks the claims an admission takes (its profile, its account), not the state root.
interface TestRecord { readonly schemaVersion: "test.v1"; readonly operationId: string; readonly profileHash: string; readonly idempotencyHash: string;
  readonly requestHash: string; readonly state: string; readonly terminal: boolean; readonly chainId: number; readonly account: string }
class Reader extends SecureStateStore { async read(path: string) { return await this.readJson(path); } }
const adapter: OperationFamilyAdapter<TestRecord> = {
  family: "direct_transfer", stores: [{ directory: "test-a", perProfile: true }],
  async load(root, recordPath) {
    const value = await new Reader(root).read(recordPath) as TestRecord | null;
    if (value !== null && value.schemaVersion !== "test.v1") throw new ApnError("APN_STATE_CORRUPT", "Synthetic record is invalid.");
    return value;
  },
  identity: standardIdentity,
  claims: record => readableClaims(() => domainClaims([evmConflictDomain(record.chainId, record.account)])),
  terminal: record => record.terminal,
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageEvm(field(value, "chainId"), field(value, "account"), false)]),
  view: async record => record,
};
const REGISTRY: OperationRegistry = new Map<OperationFamily, OperationFamilyAdapter>([["direct_transfer", adapter as OperationFamilyAdapter]]);
const P1 = "1".repeat(64), P2 = "2".repeat(64);
const A = "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14", B = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const id = (n: number) => n.toString(16).padStart(64, "0");
const record = (n: number, profileHash: string, account: string, terminal = false): TestRecord => ({ schemaVersion: "test.v1", operationId: id(n),
  profileHash, idempotencyHash: id(1000 + n), requestHash: id(2000 + n), state: terminal ? "completed" : "awaiting_approval", terminal, chainId: 8453, account });
const identity = (r: TestRecord): PrepareIdentity => ({ family: "direct_transfer", profileHash: r.profileHash, operationId: r.operationId,
  idempotencyHash: r.idempotencyHash, requestHash: r.requestHash });
const wants = (profileHash: string, account: string): WantedClaims => ({ family: "direct_transfer", profileHash, claims: [{ key: `evm:8453:${account}` }] });
async function save(root: string, value: TestRecord): Promise<void> {
  await mkdir(join(root, "test-a", value.profileHash), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "test-a", value.profileHash, `${value.operationId}.json`), `${canonicalJson(value)}\n`, { mode: 0o600 });
}
async function serverRoot(t: test.TestContext) {
  const previous = process.env[SERVER_MODE_ENV];
  process.env[SERVER_MODE_ENV] = "1";
  t.after(() => { if (previous === undefined) delete process.env[SERVER_MODE_ENV]; else process.env[SERVER_MODE_ENV] = previous; });
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root, { lockWaitMs: 300 }); await state.initialize();
  return { root: temporary.root, state, index: new OperationIndex(state, REGISTRY) };
}

test("server mode: another profile admits while one profile's claim lock is held; the same profile waits", async (t) => {
  const s = await serverRoot(t);
  const profileLock = `operation-index-claim:${sha256(`profile:${P1}`)}`;
  await s.state.withLocks([profileLock], async () => {
    const other = record(1, P2, B);
    assert.equal(await s.index.admit(identity(other), wants(P2, B), async () => { await save(s.root, other); return "admitted"; }), "admitted");
    const same = record(2, P1, A);
    await assert.rejects(s.index.admit(identity(same), wants(P1, A), async () => "never"), { code: "APN_STATE_BUSY" });
  });
});

test("server mode: an open claim is found through its marker, blocks its account in any profile and leaves when terminal", async (t) => {
  const s = await serverRoot(t);
  const first = record(1, P1, A);
  await s.index.admit(identity(first), wants(P1, A), async () => { await save(s.root, first); });
  const store = new OperationIndexStore(s.root);
  assert.deepEqual(await store.claimHolders(`evm:8453:${A}`), [first.operationId]);
  const second = record(2, P2, A);
  await assert.rejects(s.index.admit(identity(second), wants(P2, A), async () => "never"), { code: "APN_OPERATION_BLOCKED" });
  await save(s.root, record(1, P1, A, true));
  await s.index.settle(first.operationId);
  assert.deepEqual(await store.claimHolders(`evm:8453:${A}`), []);
  await s.index.admit(identity(second), wants(P2, A), async () => { await save(s.root, second); });
  assert.deepEqual(await store.claimHolders(`evm:8453:${A}`), [second.operationId]);
});

test("a server state root is refused by the foreground build", async (t) => {
  const s = await serverRoot(t);
  await s.index.reconcile();
  delete process.env[SERVER_MODE_ENV];
  await assert.rejects(new OperationIndex(s.state, REGISTRY).reconcile(), { code: "APN_STATE_SECURITY" });
});
