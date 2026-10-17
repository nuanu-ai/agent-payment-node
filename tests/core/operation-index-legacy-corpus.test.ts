import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { sealGaszipFunding, type GaszipFundingRecord } from "../../src/lifi/gaszip-direct-journal.js";
import { GASZIP_DIRECT_ROUTES } from "../../src/lifi/gaszip-direct-route.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { operationRegistry } from "../../src/operation-index/registry.js";
import { OperationIndexStore, type StoredRecordName } from "../../src/operation-index/store.js";
import { OperationService } from "../../src/operation-service.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { installLegacyCase, legacyCaseDigest } from "./legacy-corpus-readers.js";

/**
 * Migration (phase 4b WP1): the first use of the operation index walks every store a released version wrote and
 * indexes each record through its family's own widen-only reader. No record is rewritten, no released record reads
 * as unreadable, and the index is derived state: a second walk and a rebuild from nothing give the same files.
 */
const CORPUS = join("tests", "fixtures", "legacy-corpus");
interface LegacyCase { readonly name: string }

async function indexFiles(root: string): Promise<ReadonlyMap<string, string>> {
  const base = join(root, "operation-index"), out = new Map<string, string>();
  let entries;
  try { entries = await readdir(base, { recursive: true, withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return out; throw error; }
  for (const entry of entries) {
    if (entry.isFile()) out.set(join(entry.parentPath, entry.name).slice(base.length), await readFile(join(entry.parentPath, entry.name), "utf8"));
  }
  return new Map([...out].sort(([a], [b]) => a < b ? -1 : 1));
}
async function recordNames(root: string): Promise<readonly StoredRecordName[]> {
  const store = new OperationIndexStore(root), names: StoredRecordName[] = [];
  for (const adapter of operationRegistry().values()) for (const directory of adapter.stores) names.push(...await store.recordNames(directory));
  return names;
}

test("every released record of the legacy corpus reconciles through its own reader, twice identically, and rebuilds", async (t) => {
  const cases = JSON.parse(await readFile(join(CORPUS, "manifest.json"), "utf8")) as readonly LegacyCase[];
  let indexed = 0;
  for (const entry of cases) {
    await t.test(entry.name, async (sub) => {
      const temporary = await temporaryState(); sub.after(temporary.cleanup);
      await installLegacyCase(join(CORPUS, entry.name), temporary.root);
      const records = await legacyCaseDigest(temporary.root);
      const index = new OperationIndex(new StateStore(temporary.root));
      await index.reconcile();
      for (const name of await recordNames(temporary.root)) {
        const found = await index.find(name.operationId);
        assert.ok(found !== null, name.recordPath);
        assert.equal(found.recordPath, name.recordPath);
        assert.equal(found.state === "unreadable", false, `${name.recordPath} reads as ${found.unreadableReason}`);
        const open = (await indexFiles(temporary.root)).has(`/open/${name.operationId}.json`);
        assert.equal(open, found.state === "active", name.recordPath);
        indexed += 1;
      }
      const first = await indexFiles(temporary.root);
      await index.reconcile();
      assert.deepEqual(await indexFiles(temporary.root), first);
      await rm(join(temporary.root, "operation-index"), { recursive: true, force: true });
      await new OperationIndex(new StateStore(temporary.root)).reconcile();
      assert.deepEqual(await indexFiles(temporary.root), first);
      assert.deepEqual(await legacyCaseDigest(temporary.root), records, "no record byte changed");
    });
  }
  assert.ok(indexed >= 40, `indexed ${indexed} corpus records`);
});

test("a prepare beside 2,000 terminal historical records reads at most k+2 record files", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  await installLegacyCase(join(CORPUS, "02-v0538-sei-gaszip"), temporary.root);
  const [completedName] = (await readdir(join(temporary.root, "sei-gaszip"))).filter(name => name.endsWith(".json"));
  const completed = JSON.parse(await readFile(join(temporary.root, "sei-gaszip", completedName!), "utf8")) as GaszipFundingRecord;
  assert.equal(completed.terminal, true);
  const { integrityHash: _seal, ...body } = completed;
  for (let index = 0; index < 2_000; index += 1) {
    const operationId = (0x10000 + index).toString(16).padStart(64, "0");
    const record = sealGaszipFunding(GASZIP_DIRECT_ROUTES.sei, { ...body, operationId, idempotencyHash: (0x20000 + index).toString(16).padStart(64, "0") });
    await writeFile(join(temporary.root, "sei-gaszip", `${operationId}.json`), `${canonicalJson(record)}\n`, { mode: 0o600 });
  }
  // One unresolved record (k = 1): a released Mega funding, still `prepared`.
  await installLegacyCase(join(CORPUS, "33-v0543-mega-gaszip"), temporary.root);
  const [openName] = (await readdir(join(temporary.root, "mega-gaszip"))).filter(name => name.endsWith(".json"));
  const open = JSON.parse(await readFile(join(temporary.root, "mega-gaszip", openName!), "utf8")) as GaszipFundingRecord;
  assert.equal(open.state, "prepared");
  const state = new StateStore(temporary.root);
  const started = performance.now();
  await new OperationIndex(state).reconcile(); // the one-time backfill of the upgrade
  // One durable write per index file took about 23 ms per record (46 s here); terminal records now share at most 16
  // durable pointer shards and their entries follow without a flush each (about 1 s here).
  const backfillMs = performance.now() - started;
  assert.ok(backfillMs <= 3_000, `the first walk over 2,001 records took ${Math.round(backfillMs)} ms`);

  const reads: string[] = [];
  const prototype = SecureStateStore.prototype as unknown as { readJson(path: string): Promise<unknown> };
  const original = prototype.readJson;
  prototype.readJson = async function (this: SecureStateStore, path: string) {
    if (!path.startsWith("operation-index/")) reads.push(path);
    return await original.call(this, path);
  };
  try {
    const service = new OperationService(state), other = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
    assert.equal(await service.resolvePrepare({ kind: "mega_gaszip", profileHash: open.profileHash, operationId: "e".repeat(64),
      idempotencyHash: "f".repeat(64), requestHash: "d".repeat(64) }), null);
    await service.assertEvmAccountAvailable(open.profileHash, 8453, other);
    assert.ok(reads.length <= 1 + 2, `a prepare on another account read ${reads.length} records: ${reads.join(", ")}`);
    reads.length = 0;
    await assert.rejects(service.assertEvmAccountAvailable(open.profileHash, 8453, open.owner.address), {
      code: "APN_OPERATION_BLOCKED", details: { blockingOperationId: open.operationId, blockingState: "prepared",
        blockingNetwork: "evm:8453", blockingAccount: open.owner.address.toLowerCase() } });
    assert.ok(reads.length <= 1 + 2, `a blocked prepare read ${reads.length} records: ${reads.join(", ")}`);
    reads.length = 0;
    assert.equal((await service.required(completed.operationId)).kind, "sei_gaszip");
    assert.equal(reads.length, 1, "a lookup reads its one record");
  } finally {
    prototype.readJson = original;
  }
});
