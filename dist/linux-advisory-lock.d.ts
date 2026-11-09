import { type AdvisoryLockPort, type LockfSpawn } from "./macos-advisory-lock.js";
/**
 * The Linux twin of MacosAdvisoryLock. flock(1) takes the lock on the open file description it inherits as fd 3 and exits;
 * the lock stays with APN's handle until that handle closes, exactly as lockf(1) behaves on macOS.
 */
export declare class LinuxFlockLock implements AdvisoryLockPort {
    private readonly spawnFlock;
    private readonly timeoutMs;
    constructor(spawnFlock?: LockfSpawn, timeoutMs?: number);
    tryAcquire(fd: number, timeoutMs?: number, boundedWait?: boolean): Promise<boolean>;
}
