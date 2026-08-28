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
export type LockfSpawn = (executable: string, args: readonly string[], options: LockfSpawnOptions) => LockfChild;
export interface MacosAdvisoryLockOptions {
    readonly spawnLockf?: LockfSpawn;
    readonly timeoutMs?: number;
}
export declare class MacosAdvisoryLock implements AdvisoryLockPort {
    private readonly spawnLockf;
    private readonly timeoutMs;
    constructor(options?: MacosAdvisoryLockOptions);
    tryAcquire(fd: number): Promise<boolean>;
}
