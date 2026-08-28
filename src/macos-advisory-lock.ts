import { spawn } from "node:child_process";
import { ApnError } from "./errors.js";

const LOCKF = "/usr/bin/lockf";
const LOCKF_ARGS = ["-s", "-t", "0", "3"] as const;
const LOCKF_BUSY_EXIT = 75;
const LOCKF_TIMEOUT_MS = 1_000;

export interface AdvisoryLockPort {
  tryAcquire(fd: number): Promise<boolean>;
}

export interface LockfChild {
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal: "SIGKILL"): boolean;
}

export interface LockfSpawnOptions {
  readonly stdio: readonly ["ignore", "ignore", "ignore", number];
  readonly env: Readonly<Record<string, never>>;
  readonly shell: false;
}

export type LockfSpawn = (
  executable: string,
  args: readonly string[],
  options: LockfSpawnOptions,
) => LockfChild;

export interface MacosAdvisoryLockOptions {
  readonly spawnLockf?: LockfSpawn;
  readonly timeoutMs?: number;
}

export class MacosAdvisoryLock implements AdvisoryLockPort {
  private readonly spawnLockf: LockfSpawn;
  private readonly timeoutMs: number;

  constructor(options: MacosAdvisoryLockOptions = {}) {
    this.spawnLockf = options.spawnLockf ?? spawnFixedLockf;
    this.timeoutMs = options.timeoutMs ?? LOCKF_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > LOCKF_TIMEOUT_MS) {
      throw lockfFailure();
    }
  }

  async tryAcquire(fd: number): Promise<boolean> {
    if (!Number.isSafeInteger(fd) || fd < 0) throw lockfFailure();
    return await new Promise<boolean>((resolve, reject) => {
      let child: LockfChild;
      try {
        child = this.spawnLockf(LOCKF, LOCKF_ARGS, {
          stdio: ["ignore", "ignore", "ignore", fd],
          env: {},
          shell: false,
        });
      } catch {
        reject(lockfFailure());
        return;
      }

      let settled = false;
      const finish = (result?: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (result === undefined) reject(lockfFailure());
        else resolve(result);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish();
      }, this.timeoutMs);
      timeout.unref();
      child.once("error", () => finish());
      child.once("close", (code, signal) => {
        if (signal !== null || code === null) finish();
        else if (code === 0) finish(true);
        else if (code === LOCKF_BUSY_EXIT) finish(false);
        else finish();
      });
    });
  }
}

const spawnFixedLockf: LockfSpawn = (_executable, _args, options) => spawn("/usr/bin/lockf", ["-s", "-t", "0", "3"], {
  stdio: [...options.stdio],
  env: { ...options.env },
  shell: options.shell,
});

function lockfFailure(): ApnError {
  return new ApnError("APN_STATE_SECURITY", "The macOS kernel advisory lock could not be acquired safely.");
}
