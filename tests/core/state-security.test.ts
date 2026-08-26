import assert from "node:assert/strict";
import test from "node:test";
import { chmod, link, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256 } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { RECIPIENT, TestNative, TestRpc, ensureWallet, makeCore, prepareTransfer, temporaryState } from "./helpers.js";

test("state root rejects wrong mode and symlinked ancestors", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await mkdir(temporary.root, { mode: 0o755 });
  await assert.rejects(new StateStore(temporary.root).initialize(), /mode 0700/);

  const second = await temporaryState();
  t.after(second.cleanup);
  const realParent = join(second.base, "real");
  const aliasParent = join(second.base, "alias");
  await mkdir(realParent, { mode: 0o700 });
  await symlink(realParent, aliasParent);
  await assert.rejects(new StateStore(join(aliasParent, "state")).initialize(), /symbolic link/);
});

test("state reads reject mode changes, symlink targets, and hard links", async (t) => {
  const modeCase = await temporaryState();
  t.after(modeCase.cleanup);
  await ensureWallet(makeCore({ root: modeCase.root, native: new TestNative() }));
  const profileHash = new StateStore(modeCase.root).profileHash("default");
  const walletPath = join(modeCase.root, "wallets", profileHash, "wallet.json");
  await chmod(walletPath, 0o644);
  const wrongMode = await makeCore({ root: modeCase.root, native: new TestNative() }).execute({
    command: "wallet.status",
    profile: "default",
  });
  assert.equal(wrongMode.ok, false);
  assert.equal(wrongMode.error?.code, "APN_STATE_SECURITY");

  const symlinkCase = await temporaryState();
  t.after(symlinkCase.cleanup);
  await ensureWallet(makeCore({ root: symlinkCase.root, native: new TestNative() }));
  const symlinkProfile = new StateStore(symlinkCase.root).profileHash("default");
  const symlinkWallet = join(symlinkCase.root, "wallets", symlinkProfile, "wallet.json");
  await unlink(symlinkWallet);
  await symlink("/etc/passwd", symlinkWallet);
  const linked = await makeCore({ root: symlinkCase.root, native: new TestNative() }).execute({
    command: "wallet.status",
    profile: "default",
  });
  assert.equal(linked.ok, false);
  assert.equal(linked.error?.code, "APN_STATE_SECURITY");

  const hardlinkCase = await temporaryState();
  t.after(hardlinkCase.cleanup);
  await ensureWallet(makeCore({ root: hardlinkCase.root, native: new TestNative() }));
  const hardlinkProfile = new StateStore(hardlinkCase.root).profileHash("default");
  const hardlinkWallet = join(hardlinkCase.root, "wallets", hardlinkProfile, "wallet.json");
  await link(hardlinkWallet, join(hardlinkCase.base, "second-link.json"));
  const hardlinked = await makeCore({ root: hardlinkCase.root, native: new TestNative() }).execute({
    command: "wallet.status",
    profile: "default",
  });
  assert.equal(hardlinked.ok, false);
  assert.equal(hardlinked.error?.code, "APN_STATE_SECURITY");
});

test("operation and receipt tampering fail closed after restart", async (t) => {
  const operationCase = await temporaryState();
  t.after(operationCase.cleanup);
  const store = new StateStore(operationCase.root);
  await ensureWallet(makeCore({ root: operationCase.root, native: new TestNative() }));
  const operationId = await prepareTransfer(makeCore({ root: operationCase.root, rpc: new TestRpc() }), "tamper-op-001");
  const profileHash = store.profileHash("default");
  const operationPath = join(operationCase.root, "operations", profileHash, `${operationId}.json`);
  const operation = JSON.parse(await readFile(operationPath, "utf8")) as Record<string, unknown>;
  operation.reason = "forged_success";
  await writeFile(operationPath, JSON.stringify(operation), { mode: 0o600 });
  const status = await makeCore({ root: operationCase.root }).execute({
    command: "operation.status",
    operationId,
  });
  assert.equal(status.ok, false);
  assert.equal(status.error?.code, "APN_STATE_CORRUPT");

  const receiptCase = await temporaryState();
  t.after(receiptCase.cleanup);
  const receiptStore = new StateStore(receiptCase.root);
  await ensureWallet(makeCore({ root: receiptCase.root, native: new TestNative() }));
  const receiptOperation = await prepareTransfer(makeCore({ root: receiptCase.root, rpc: new TestRpc() }), "tamper-receipt-001");
  const receiptProfile = receiptStore.profileHash("default");
  const receiptPath = join(receiptCase.root, "receipts", receiptProfile, `${receiptOperation}.json`);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
  receipt.secretProviderDump = "CANARY_SECRET";
  await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  const queried = await makeCore({ root: receiptCase.root }).execute({
    command: "receipt.get",
    operationId: receiptOperation,
  });
  assert.equal(queried.ok, false);
  assert.equal(JSON.stringify(queried).includes("CANARY_SECRET"), false);
});

test("operation filenames hash idempotency keys instead of exposing them", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
  await makeCore({ root: temporary.root, rpc: new TestRpc() }).execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: "human-visible-secretish-key",
    recipient: RECIPIENT,
    amount: "1",
  });
  assert.equal(temporary.root.includes("human-visible-secretish-key"), false);
  const store = new StateStore(temporary.root);
  const path = join(
    temporary.root,
    "operations",
    store.profileHash("default"),
    `${store.operationId("default", "human-visible-secretish-key")}.json`,
  );
  assert.match(path, /[a-f0-9]{64}\.json$/);
});

test("stale-lock takeover never deletes a replacement inode created during the race", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);

  class RacingStore extends StateStore {
    protected override async beforeStaleLockTakeover(path: string): Promise<void> {
      await unlink(path);
      await writeFile(path, canonicalJson({
        pid: process.pid.toString(),
        createdAtMs: Date.now().toString(),
        token: "replacement-inode",
      }), { mode: 0o600 });
    }
  }

  const store = new RacingStore(temporary.root, { lockWaitMs: 50, lockLeaseMs: 1, hostSerialized: true });
  await store.initialize();
  const lockPath = join(temporary.root, "locks", `${sha256("lock\0race-key")}.lock`);
  await writeFile(lockPath, canonicalJson({
    pid: "99999999",
    createdAtMs: "0",
    token: "stale-inode",
  }), { mode: 0o600 });

  await assert.rejects(store.withLocks(["race-key"], async () => undefined), /replacement was preserved/);
  const replacement = JSON.parse(await readFile(lockPath, "utf8")) as { readonly token?: unknown };
  assert.equal(replacement.token, "replacement-inode");
});

test("stale-lock recovery is refused without native-host advisory serialization", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const store = new StateStore(temporary.root, { lockWaitMs: 20, lockLeaseMs: 1 });
  await store.initialize();
  const lockPath = join(temporary.root, "locks", `${sha256("lock\0unserialized-key")}.lock`);
  await writeFile(lockPath, canonicalJson({
    pid: "99999999",
    createdAtMs: "0",
    token: "stale-unserialized",
  }), { mode: 0o600 });

  await assert.rejects(store.withLocks(["unserialized-key"], async () => undefined), /native host advisory lock/);
  const retained = JSON.parse(await readFile(lockPath, "utf8")) as { readonly token?: unknown };
  assert.equal(retained.token, "stale-unserialized");
});
