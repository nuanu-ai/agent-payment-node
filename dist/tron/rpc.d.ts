export type TronMethod = "wallet/getblockbynum" | "wallet/getnowblock" | "wallet/getnodeinfo" | "wallet/getchainparameters" | "wallet/getnextmaintenancetime" | "wallet/getaccount" | "wallet/getaccountresource" | "wallet/triggerconstantcontract" | "wallet/estimateenergy" | "wallet/broadcasttransaction" | "wallet/getcontractinfo" | "wallet/gettransactionbyid" | "wallet/gettransactioninfobyid" | "walletsolidity/gettransactionbyid" | "walletsolidity/gettransactioninfobyid" | "walletsolidity/getblockbynum" | "walletsolidity/getnowblock" | "walletsolidity/getaccount" | "walletsolidity/triggerconstantcontract";
export declare const TRON_RPC_METHODS: readonly TronMethod[];
export interface TronRpcPort {
    readonly originHash: string;
    call(method: TronMethod, body: Readonly<Record<string, unknown>>): Promise<unknown>;
}
/** Ten prepare reads each have a ten-second transport bound; nine one-second gaps plus the ten-second expiry reserve fit the 120-second TRON window. */
export declare const TRON_RPC_MAX_MINIMUM_POST_INTERVAL_MS = 1000;
export interface TronRpcPacingOptions {
    /** Optional decimal milliseconds. Unset or zero preserves the existing unpaced behavior. */
    readonly minimumPostStartIntervalMs?: string | undefined;
    /** Monotonic clock and cancellable delay are injectable for deterministic tests. */
    readonly now?: () => number;
    readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export declare class TronRpc implements TronRpcPort {
    private readonly endpoint?;
    private readonly fetcher;
    private readonly pacing;
    readonly originHash: string;
    private lastPostStartAt;
    private startQueue;
    constructor(endpoint?: string | undefined, fetcher?: typeof fetch, pacing?: TronRpcPacingOptions);
    call(method: TronMethod, body: Readonly<Record<string, unknown>>): Promise<unknown>;
    private awaitPostStart;
}
export interface TronBlock {
    readonly id: string;
    readonly number: bigint;
    readonly timestamp: bigint;
    readonly body: Record<string, unknown>;
}
export declare function tronBlock(value: unknown): TronBlock;
export declare function assertTronNetwork(rpc: TronRpcPort): Promise<string>;
