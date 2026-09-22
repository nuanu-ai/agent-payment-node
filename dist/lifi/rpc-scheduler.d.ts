export declare const RPC_RETRY_DELAY_MS = 2000;
export declare class RpcHttpFailure extends Error {
    readonly method: string;
    readonly status: number;
    readonly retryAfterMs?: number | undefined;
    constructor(method: string, status: number, retryAfterMs?: number | undefined);
}
export interface RpcProviderPacingCoordinator {
    coordinate<T>(family: string, work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null, saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>): Promise<T>;
}
/** Provider-family coordination. A coordinator can serialize starts and retain pacing across CLI processes. */
export declare class RpcProviderScheduler {
    private readonly coordinator?;
    private readonly pacingNow?;
    private readonly cooldownMode;
    private readonly cooldownFailures;
    private readonly families;
    private readonly queue;
    private active;
    constructor(coordinator?: RpcProviderPacingCoordinator | undefined, pacingNow?: (() => number) | undefined, cooldownMode?: "wait" | "reject", cooldownFailures?: "rate_limit" | "transient");
    schedule(origin: string, now: () => number, wait: (milliseconds: number) => Promise<void>, beforeWait: (milliseconds: number) => void, task: () => Promise<unknown>): Promise<unknown>;
    private pump;
    private run;
}
export declare function rpcOriginIdentity(origin: string): string;
export declare function rpcProviderFamily(origin: string): string;
