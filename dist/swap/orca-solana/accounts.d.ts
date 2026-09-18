import { type SolanaRpcPort } from "../../solana/rpc.js";
/** One account exactly as getMultipleAccounts returned it; `space` is the full size even when a data slice was read. */
export interface RawSolanaAccount {
    readonly owner: string;
    readonly lamports: bigint;
    readonly executable: boolean;
    readonly space: number;
    readonly data: Buffer;
}
export interface RawAccountRead {
    readonly slot: bigint;
    readonly accounts: readonly (RawSolanaAccount | null)[];
}
export interface WhirlpoolState {
    readonly address: string;
    readonly config: string;
    readonly tickSpacing: number;
    readonly feeTierIndexSeed: number;
    readonly feeRate: number;
    readonly protocolFeeRate: number;
    readonly liquidity: bigint;
    readonly sqrtPrice: bigint;
    readonly tickCurrentIndex: number;
    readonly mintA: string;
    readonly vaultA: string;
    readonly mintB: string;
    readonly vaultB: string;
}
export interface TickState {
    readonly initialized: boolean;
    readonly liquidityNet: bigint;
}
export interface TickArrayState {
    readonly address: string;
    readonly startTickIndex: number;
    readonly whirlpool: string;
    readonly ticks: readonly TickState[];
}
export declare const WHIRLPOOL_ACCOUNT_BYTES = 653;
export declare const TICK_ARRAY_ACCOUNT_BYTES = 9988;
export declare const TICK_ARRAY_SIZE = 88;
/**
 * Bounded base64 `getMultipleAccounts` read. The shared rail decoder caps account data at 2 KiB; pool state, tick
 * arrays and program bytes are larger, so this reader takes an explicit per-account byte cap and still rejects
 * unknown fields, non-canonical base64 and any size disagreement.
 */
export declare function readRawAccounts(rpc: SolanaRpcPort, addresses: readonly string[], maximumBytes: number, slice?: {
    readonly offset: number;
    readonly length: number;
}): Promise<RawAccountRead>;
export declare function rawAccount(value: unknown, maximumBytes: number, slice?: {
    readonly offset: number;
    readonly length: number;
}): RawSolanaAccount;
export declare function decodeWhirlpool(poolAddress: string, account: RawSolanaAccount | null, program: string, discriminator: string): WhirlpoolState;
export declare function decodeTickArray(arrayAddress: string, account: RawSolanaAccount | null, program: string, discriminator: string): TickArrayState;
/** Tick array PDA: ["tick_array", whirlpool, decimal start tick index]. */
export declare function whirlpoolTickArrayAddress(program: string, pool: string, startTickIndex: number): Promise<string>;
/** Oracle PDA: ["oracle", whirlpool]. Its absence means the pool has no adaptive fee. */
export declare function whirlpoolOracleAddress(program: string, pool: string): Promise<string>;
export declare function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): Promise<string>;
