/** The helper only spawns and tries the lock once (`-t 0`); the bound covers a slow spawn on a loaded machine. A helper that
 * does not answer within it still fails closed; a strict caller deadline bounds each attempt by its remaining time. */
export declare const LOCKF_TIMEOUT_MS = 5000;
export interface AdvisoryLockPort {
    tryAcquire(fd: number, timeoutMs?: number, boundedWait?: boolean): Promise<boolean>;
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
export type LockfSpawn = (executable: string, args: readonly string[], options: LockfSpawnOptions) => LockfChild;
export interface MacosAdvisoryLockOptions {
    readonly spawnLockf?: LockfSpawn;
    readonly timeoutMs?: number;
}
export declare class MacosAdvisoryLock implements AdvisoryLockPort {
    private readonly spawnLockf;
    private readonly timeoutMs;
    constructor(options?: MacosAdvisoryLockOptions);
    tryAcquire(fd: number, timeoutMs?: number, boundedWait?: boolean): Promise<boolean>;
}
