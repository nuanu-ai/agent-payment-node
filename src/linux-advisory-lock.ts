import { spawn } from "node:child_process";
import { ApnError } from "./errors.js";
import { LOCKF_TIMEOUT_MS, type AdvisoryLockPort, type LockfSpawn } from "./macos-advisory-lock.js";

const FLOCK = "/usr/bin/flock";
/** util-linux flock(1): non-blocking exclusive flock(2) on inherited fd 3; a held lock exits 75 like lockf(1). */
const FLOCK_ARGS = ["--nonblock", "--conflict-exit-code", "75", "3"] as const;
const FLOCK_BUSY_EXIT = 75;

/**
 * The Linux twin of MacosAdvisoryLock. flock(1) takes the lock on the open file description it inherits as fd 3 and exits;
 * the lock stays with APN's handle until that handle closes, exactly as lockf(1) behaves on macOS.
 */
export class LinuxFlockLock implements AdvisoryLockPort {
  constructor(private readonly spawnFlock: LockfSpawn = spawnFixedFlock, private readonly timeoutMs = LOCKF_TIMEOUT_MS) {}

  async tryAcquire(fd: number, timeoutMs = this.timeoutMs, boundedWait = false): Promise<boolean> {
    if (!Number.isSafeInteger(fd) || fd < 0) throw flockFailure();
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > this.timeoutMs) throw flockFailure();
    return await new Promise<boolean>((resolve, reject) => {
      let child: ReturnType<LockfSpawn>;
      try {
        child = this.spawnFlock(FLOCK, FLOCK_ARGS, { stdio: ["ignore", "ignore", "ignore", fd], env: {}, shell: false });
      } catch {
        reject(flockFailure());
        return;
      }
      let settled = false;
      const finish = (result?: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (result === undefined) reject(flockFailure());
        else resolve(result);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish(boundedWait ? false : undefined);
      }, timeoutMs);
      timeout.unref();
      child.once("error", () => finish());
      child.once("close", (code, signal) => {
        if (signal !== null || code === null) finish();
        else if (code === 0) finish(true);
        else if (code === FLOCK_BUSY_EXIT) finish(false);
        else finish();
      });
    });
  }
}

const spawnFixedFlock: LockfSpawn = (_executable, _args, options) => spawn(FLOCK, [...FLOCK_ARGS], {
  stdio: [...options.stdio],
  env: { ...options.env },
  shell: options.shell,
});

function flockFailure(): ApnError {
  return new ApnError("APN_STATE_SECURITY", "The Linux kernel advisory lock (util-linux flock) could not be acquired safely.");
}
