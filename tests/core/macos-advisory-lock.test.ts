import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  MacosAdvisoryLock,
  type LockfChild,
  type LockfSpawn,
  type LockfSpawnOptions,
} from "../../src/macos-advisory-lock.js";

test("macOS advisory lock invokes only the fixed lockf executable, argv, and inherited fd", async () => {
  let observed: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly options: LockfSpawnOptions;
  } | undefined;
  const spawnLockf: LockfSpawn = (executable, args, options) => {
    observed = { executable, args, options };
    return closingChild(0);
  };
  const acquired = await new MacosAdvisoryLock({ spawnLockf, timeoutMs: 100 }).tryAcquire(42);
  assert.equal(acquired, true);
  assert.deepEqual(observed, {
    executable: "/usr/bin/lockf",
    args: ["-s", "-t", "0", "3"],
    options: {
      stdio: ["ignore", "ignore", "ignore", 42],
      env: {},
      shell: false,
    },
  });
});

test("macOS advisory lock classifies only lockf exit 75 as busy", async () => {
  const busy = new MacosAdvisoryLock({ spawnLockf: () => closingChild(75), timeoutMs: 100 });
  assert.equal(await busy.tryAcquire(7), false);

  const abnormal = new MacosAdvisoryLock({ spawnLockf: () => closingChild(64), timeoutMs: 100 });
  await assert.rejects(abnormal.tryAcquire(7), /could not be acquired safely/);

  const signaled = new MacosAdvisoryLock({ spawnLockf: () => closingChild(null, "SIGTERM"), timeoutMs: 100 });
  await assert.rejects(signaled.tryAcquire(7), /could not be acquired safely/);
});

test("macOS advisory lock fails closed on spawn errors and bounded timeout", async () => {
  const errored = new MacosAdvisoryLock({ spawnLockf: () => errorChild(), timeoutMs: 100 });
  await assert.rejects(errored.tryAcquire(7), /could not be acquired safely/);

  let killed = false;
  const hanging = new MacosAdvisoryLock({
    spawnLockf: () => hangingChild(() => { killed = true; }),
    timeoutMs: 10,
  });
  await assert.rejects(hanging.tryAcquire(7), /could not be acquired safely/);
  assert.equal(killed, true);
});

test("macOS advisory lock classifies an explicit caller-budget timeout as busy", async () => {
  let killed = false;
  const hanging = new MacosAdvisoryLock({
    spawnLockf: () => hangingChild(() => { killed = true; }),
    timeoutMs: 100,
  });
  assert.equal(await hanging.tryAcquire(7, 10, true), false);
  assert.equal(killed, true);
});

function closingChild(code: number | null, signal: NodeJS.Signals | null = null): LockfChild {
  const child = childEmitter();
  queueMicrotask(() => child.emit("close", code, signal));
  return child as unknown as LockfChild;
}

function errorChild(): LockfChild {
  const child = childEmitter();
  queueMicrotask(() => child.emit("error", new Error("spawn failed")));
  return child as unknown as LockfChild;
}

function hangingChild(onKill: () => void): LockfChild {
  const child = childEmitter(onKill);
  return child as unknown as LockfChild;
}

function childEmitter(onKill: () => void = () => undefined): EventEmitter & { kill(signal: "SIGKILL"): boolean } {
  const child = new EventEmitter() as EventEmitter & { kill(signal: "SIGKILL"): boolean };
  child.kill = () => {
    onKill();
    return true;
  };
  return child;
}
