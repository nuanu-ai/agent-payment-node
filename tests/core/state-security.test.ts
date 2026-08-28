import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { chmod, link, lstat, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../../src/canonical.js";
import type { AdvisoryLockPort } from "../../src/macos-advisory-lock.js";
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

test("stable kernel lock files remain in place after release", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const store = new StateStore(temporary.root);
  await store.initialize();
  await store.withLocks(["stable-key"], async () => undefined);
  const info = await lstat(lockPath(temporary.root, "stable-key"));
  assert.equal(info.isFile(), true);
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal(info.nlink, 1);
  assert.equal((await readFile(lockPath(temporary.root, "stable-key"))).length, 0);
});

test("a held kernel lock refuses a contender until the file handle closes", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const holder = new StateStore(temporary.root);
  const contender = new StateStore(temporary.root, { lockWaitMs: 30 });
  await holder.initialize();
  await contender.initialize();

  await holder.withLocks(["busy-key"], async () => {
    await assert.rejects(contender.withLocks(["busy-key"], async () => undefined), (error: unknown) => {
      assert.equal((error as { readonly code?: unknown }).code, "APN_STATE_BUSY");
      assert.match(String(error), /30 milliseconds/);
      return true;
    });
  });
  await contender.withLocks(["busy-key"], async () => undefined);
});

test("process exit releases the kernel lock without deleting its stable file", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const contender = new StateStore(temporary.root, { lockWaitMs: 30 });
  await contender.initialize();
  const path = lockPath(temporary.root, "process-exit-key");
  const childSource = `
    import { constants } from "node:fs";
    import { open } from "node:fs/promises";
    import { spawn } from "node:child_process";
    const held = await open(${JSON.stringify(path)}, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    const locker = spawn("/usr/bin/lockf", ["-s", "-t", "0", "3"], { stdio: ["ignore", "ignore", "ignore", held.fd] });
    locker.once("error", () => process.exit(2));
    locker.once("close", (code, signal) => {
      if (code !== 0 || signal !== null) process.exit(3);
      process.stdout.write("locked\\n");
      setInterval(() => undefined, 60_000);
    });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  assert.equal(await childReady(child), "locked");

  await assert.rejects(contender.withLocks(["process-exit-key"], async () => undefined), (error: unknown) => {
    assert.equal((error as { readonly code?: unknown }).code, "APN_STATE_BUSY");
    return true;
  });
  child.kill("SIGKILL");
  await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  await contender.withLocks(["process-exit-key"], async () => undefined);
  assert.equal((await lstat(path)).isFile(), true);
});

test("lock files reject symlinks, hard links, wrong modes, and path replacement", async (t) => {
  for (const kind of ["symlink", "hardlink", "mode"] as const) {
    const temporary = await temporaryState();
    t.after(temporary.cleanup);
    const store = new StateStore(temporary.root);
    await store.initialize();
    const key = `${kind}-lock-key`;
    const path = lockPath(temporary.root, key);
    if (kind === "symlink") await symlink("/etc/passwd", path);
    if (kind === "hardlink") {
      await writeFile(path, "", { mode: 0o600 });
      await link(path, join(temporary.base, "lock-hardlink"));
    }
    if (kind === "mode") await writeFile(path, "", { mode: 0o644 });

    await assert.rejects(store.withLocks([key], async () => undefined), (error: unknown) => {
      assert.equal((error as { readonly code?: unknown }).code, "APN_STATE_SECURITY");
      return true;
    });
  }

  const replacementCase = await temporaryState();
  t.after(replacementCase.cleanup);
  const key = "replacement-lock-key";
  const path = lockPath(replacementCase.root, key);
  const replacingPort: AdvisoryLockPort = {
    tryAcquire: async () => {
      await unlink(path);
      await writeFile(path, "replacement", { mode: 0o600 });
      return true;
    },
  };
  const replacingStore = new StateStore(replacementCase.root, { lockPort: replacingPort });
  await replacingStore.initialize();
  await assert.rejects(replacingStore.withLocks([key], async () => undefined), /changed while it was open/);
  assert.equal(await readFile(path, "utf8"), "replacement");
});

test("concurrent contenders serialize the protected action", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const left = new StateStore(temporary.root, { lockWaitMs: 1_000 });
  const right = new StateStore(temporary.root, { lockWaitMs: 1_000 });
  await left.initialize();
  await right.initialize();
  let active = 0;
  let maximumActive = 0;
  const trace: string[] = [];
  const enter = async (name: string): Promise<void> => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    trace.push(`${name}:enter`);
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
    trace.push(`${name}:exit`);
    active -= 1;
  };
  await Promise.all([
    left.withLocks(["serialize-key"], async () => await enter("left")),
    right.withLocks(["serialize-key"], async () => await enter("right")),
  ]);
  assert.equal(maximumActive, 1);
  assert.match(trace.join(","), /^(left:enter,left:exit,right:enter,right:exit|right:enter,right:exit,left:enter,left:exit)$/);
});

function lockPath(root: string, key: string): string {
  return join(root, "locks", `${sha256(`lock\0${key}`)}.lock`);
}

async function childReady(child: ReturnType<typeof spawn>): Promise<string> {
  return await new Promise<string>((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error("kernel-lock child did not become ready")), 1_000);
    const finish = (value?: string, error?: Error): void => {
      clearTimeout(timeout);
      child.removeAllListeners("exit");
      if (error !== undefined) rejectReady(error);
      else resolveReady(value ?? "");
    };
    child.once("exit", (code, signal) => finish(undefined, new Error(`kernel-lock child exited early: ${String(code)} ${String(signal)}`)));
    child.stdout?.once("data", (chunk: Buffer) => finish(chunk.toString("utf8").trim()));
  });
}
