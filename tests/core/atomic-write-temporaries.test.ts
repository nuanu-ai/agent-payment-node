import assert from "node:assert/strict";
import test from "node:test";
import { link, lstat, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicTemporaryPrefix, ORPHAN_TEMPORARY_AGE_MS } from "../../src/atomic-write-temporaries.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

class Probe extends SecureStateStore {
  async put(path: string, value: unknown, createOnly = false): Promise<void> { await this.ensureDirectory("records"); await this.writeJson(path, value, createOnly); }
  async names(path: string): Promise<readonly string[]> { return (await this.readDirectory(path)).map(entry => entry.name).sort(); }
  async raw(path: string): Promise<readonly string[]> { return (await this.readDirectoryWithStagedWrites(path)).map(entry => entry.name).sort(); }
  async get(path: string): Promise<unknown> { return await this.readJson(path); }
  async directory(path: string): Promise<void> { await this.ensureDirectory(path); }
}

function stageName(target: string, nonce: string): string { return `${atomicTemporaryPrefix(target)}${nonce}.tmp`; }

test("an interrupted rename stage no longer wedges a record listing and is swept once abandoned", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const store = new Probe(temporary.root); await store.initialize();
  await store.put("records/a.json", { value: 1 });
  const directory = join(temporary.root, "records");
  const abandoned = stageName(join(directory, "a.json"), "a".repeat(24));
  const live = stageName(join(directory, "b.json"), "b".repeat(24));
  await writeFile(join(directory, abandoned), "{\"value\":2}\n", { mode: 0o600 });
  await writeFile(join(directory, live), "{\"value\":3}\n", { mode: 0o600 });
  const old = new Date(Date.now() - ORPHAN_TEMPORARY_AGE_MS - 60_000);
  await utimes(join(directory, abandoned), old, old);

  assert.deepEqual(await store.names("records"), ["a.json"]);
  // The abandoned stage is removed; a fresh stage may belong to a live writer and stays untouched.
  assert.deepEqual((await readdir(directory)).sort(), [live, "a.json"].sort());
  assert.deepEqual(await store.raw("records"), [live, "a.json"].sort());
  assert.deepEqual(await store.get("records/a.json"), { value: 1 });
});

test("a create-only publication interrupted before its stage unlink is read once and repaired", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const store = new Probe(temporary.root); await store.initialize();
  await store.put("records/c.json", { value: 7 }, true);
  const directory = join(temporary.root, "records"), target = join(directory, "c.json");
  const stage = join(directory, stageName(target, "c".repeat(24)));
  await link(target, stage);
  assert.equal((await lstat(target)).nlink, 2);

  assert.deepEqual(await store.get("records/c.json"), { value: 7 });
  assert.equal((await lstat(target)).nlink, 1);
  assert.deepEqual(await readdir(directory), ["c.json"]);
  await store.put("records/c.json", { value: 8 });
  assert.deepEqual(await store.get("records/c.json"), { value: 8 });
});

test("a second link that is not this target's own stage still fails closed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const store = new Probe(temporary.root); await store.initialize();
  await store.put("records/d.json", { value: 1 }, true);
  const directory = join(temporary.root, "records"), target = join(directory, "d.json");
  // A stage name derived from another target never releases this inode.
  await link(target, join(directory, stageName(join(directory, "other.json"), "d".repeat(24))));
  await assert.rejects(store.get("records/d.json"), (error: Error & { code?: string }) => error.code === "APN_STATE_SECURITY");
});

test("an orphan stage inside a profile operations directory does not block operation listing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const profileHash = state.profileHash("default"), directory = join(temporary.root, "operations", profileHash);
  await new Probe(temporary.root).directory(`operations/${profileHash}`);
  await writeFile(join(directory, stageName(join(directory, `${"e".repeat(64)}.json`), "e".repeat(24))), "{}\n", { mode: 0o600 });
  assert.deepEqual(await state.listOperations(profileHash), []);
  assert.equal(await state.findOperation("e".repeat(64)), null);
});
