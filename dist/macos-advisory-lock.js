import { spawn } from "node:child_process";
import { ApnError } from "./errors.js";
const LOCKF = "/usr/bin/lockf";
const LOCKF_ARGS = ["-s", "-t", "0", "3"];
const LOCKF_BUSY_EXIT = 75;
const LOCKF_TIMEOUT_MS = 1_000;
export class MacosAdvisoryLock {
    spawnLockf;
    timeoutMs;
    constructor(options = {}) {
        this.spawnLockf = options.spawnLockf ?? spawnFixedLockf;
        this.timeoutMs = options.timeoutMs ?? LOCKF_TIMEOUT_MS;
        if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > LOCKF_TIMEOUT_MS) {
            throw lockfFailure();
        }
    }
    async tryAcquire(fd, timeoutMs = this.timeoutMs, boundedWait = false) {
        if (!Number.isSafeInteger(fd) || fd < 0)
            throw lockfFailure();
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > this.timeoutMs)
            throw lockfFailure();
        return await new Promise((resolve, reject) => {
            let child;
            try {
                child = this.spawnLockf(LOCKF, LOCKF_ARGS, {
                    stdio: ["ignore", "ignore", "ignore", fd],
                    env: {},
                    shell: false,
                });
            }
            catch {
                reject(lockfFailure());
                return;
            }
            let settled = false;
            const finish = (result) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                if (result === undefined)
                    reject(lockfFailure());
                else
                    resolve(result);
            };
            const timeout = setTimeout(() => {
                child.kill("SIGKILL");
                finish(boundedWait ? false : undefined);
            }, timeoutMs);
            timeout.unref();
            child.once("error", () => finish());
            child.once("close", (code, signal) => {
                if (signal !== null || code === null)
                    finish();
                else if (code === 0)
                    finish(true);
                else if (code === LOCKF_BUSY_EXIT)
                    finish(false);
                else
                    finish();
            });
        });
    }
}
const spawnFixedLockf = (_executable, _args, options) => spawn("/usr/bin/lockf", ["-s", "-t", "0", "3"], {
    stdio: [...options.stdio],
    env: { ...options.env },
    shell: options.shell,
});
function lockfFailure() {
    return new ApnError("APN_STATE_SECURITY", "The macOS kernel advisory lock could not be acquired safely.");
}
//# sourceMappingURL=macos-advisory-lock.js.map