export type SolanaMethod = "getGenesisHash" | "getMultipleAccounts" | "getAccountInfo" | "getLatestBlockhash" | "getBlockHeight" | "getFeeForMessage" | "getMinimumBalanceForRentExemption" | "simulateTransaction" | "sendTransaction" | "getSignatureStatuses" | "getTransaction" | "getBlock";
export type SolanaReadMethod = Exclude<SolanaMethod, "simulateTransaction" | "sendTransaction">;
export interface SolanaBatchRead {
    readonly method: SolanaReadMethod;
    readonly params: readonly unknown[];
}
export interface SolanaRpcBudgetOptions {
    /** One budget may be shared by all RPC instances used for one operation. */
    readonly maxPhysicalRequests: number;
    /** At least 500 ms between physical POST starts (two per second). */
    readonly minimumIntervalMs?: number;
    readonly now?: () => number;
    /** Supply only from a caller that does not hold a state lock; otherwise cooldown fails fast. */
    readonly wait?: (milliseconds: number) => Promise<void>;
}
export declare class SolanaRpcBudget {
    readonly maxPhysicalRequests: number;
    readonly minimumIntervalMs: number;
    private readonly now;
    private readonly wait;
    private nextStart;
    private turn;
    private logical;
    private physical;
    constructor(options: SolanaRpcBudgetOptions);
    get logicalCalls(): number;
    get physicalRequests(): number;
    get remainingPhysicalRequests(): number;
    /** Reserve and pace before transport. The queue owns no operation or storage lock. */
    acquire(logicalCalls: number): Promise<void>;
}
export interface SolanaRpcPort {
    readonly originHash: string;
    call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
    batch?(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]>;
}
export declare class SolanaRpc implements SolanaRpcPort {
    private readonly endpoint?;
    private readonly fetcher;
    readonly originHash: string;
    readonly budget: SolanaRpcBudget | undefined;
    constructor(endpoint?: string | undefined, fetcher?: typeof fetch, budget?: SolanaRpcBudget);
    call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
    /** Independent read methods share one POST; results retain input order despite unordered replies. */
    batch(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]>;
    private request;
}
export declare function assertSolanaNetwork(rpc: SolanaRpcPort): Promise<string>;
export declare function solanaAddress(input: string): string;
export declare function solanaSignature(input: unknown): string;
export declare function rpcRecord(value: unknown): Record<string, unknown>;
export declare function rpcArray(value: unknown, maximum?: number): readonly unknown[];
export declare function rpcAtomic(value: unknown): bigint;
export declare function protocolFailure(): never;
