export type SolanaMethod = "getGenesisHash" | "getMultipleAccounts" | "getAccountInfo" | "getLatestBlockhash" | "getBlockHeight" | "getFeeForMessage" | "getMinimumBalanceForRentExemption" | "sendTransaction" | "getSignatureStatuses" | "getTransaction" | "getBlock";
export interface SolanaRpcPort {
    readonly originHash: string;
    call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
}
export declare class SolanaRpc implements SolanaRpcPort {
    private readonly endpoint?;
    private readonly fetcher;
    readonly originHash: string;
    constructor(endpoint?: string | undefined, fetcher?: typeof fetch);
    call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
}
export declare function assertSolanaNetwork(rpc: SolanaRpcPort): Promise<string>;
export declare function solanaAddress(input: string): string;
export declare function solanaSignature(input: unknown): string;
export declare function rpcRecord(value: unknown): Record<string, unknown>;
export declare function rpcArray(value: unknown, maximum?: number): readonly unknown[];
export declare function rpcAtomic(value: unknown): bigint;
export declare function protocolFailure(): never;
