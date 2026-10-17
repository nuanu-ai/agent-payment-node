import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type TickArrayState, type WhirlpoolState } from "./accounts.js";
import { type WhirlpoolSwapQuote } from "./math.js";
import { type OrcaPoolConfig } from "./pools.js";
import { type OrcaOwnerBalances, type OrcaTokenOwnerBalances } from "./simulation.js";
export type OrcaPoolView = {
    readonly address: string;
    readonly tickSpacing: number;
    readonly feeRate: number;
    readonly protocolFeeRate: number;
    readonly liquidity: string;
    readonly sqrtPrice: string;
    readonly tickCurrentIndex: number;
};
interface OrcaMarketCommon {
    readonly slot: bigint;
    readonly pool: WhirlpoolState;
    readonly poolView: OrcaPoolView;
    readonly tickArrays: readonly TickArrayState[];
    readonly oracle: string;
    readonly tokenAccountRentLamports: bigint;
    readonly accountDataSha256: Readonly<Record<string, string>>;
    readonly swap: WhirlpoolSwapQuote;
}
/** The sol-usdc pool, in the field names its stored evidence has always used. */
export interface OrcaMarketRead extends OrcaMarketCommon {
    readonly wsolAccount: string;
    readonly usdcAccount: string;
    readonly vaultSolLamports: string;
    readonly vaultUsdcAtomic: string;
    readonly owner: OrcaOwnerBalances;
    /** The owner's existing wSOL account, reused and kept; null when the swap creates and closes it. */
    readonly wsol: OrcaKeptWsol | null;
}
/** A token-input pool: the owner's source (mint A) and destination (mint B) accounts. */
export interface OrcaTokenMarketRead extends OrcaMarketCommon {
    readonly sourceAccount: string;
    readonly destinationAccount: string;
    readonly vaultAAtomic: string;
    readonly vaultBAtomic: string;
    readonly owner: OrcaTokenOwnerBalances;
}
/**
 * Native SOL to USDC on the sol-usdc pool. Reads the pinned pool, the three downward tick arrays derived from the current
 * tick, the oracle PDA, its two vaults and the owner's accounts: the first eight keys (pool and tick arrays first) in one
 * getMultipleAccounts at one slot, the owner's two token accounts in a second page no more than ORCA_MAX_SLOT_DRIFT slots
 * away, then prices the exact input with the local port of the program's swap math. The tick arrays are derived from a
 * first pool read and re-derived from the pool in the first page.
 */
export declare function readOrcaMarket(rpc: SolanaRpcPort, owner: string, amountIn: bigint): Promise<OrcaMarketRead>;
/** A token-input pool: the same reads; the owner's source account must exist and hold at least the exact input. */
export declare function readOrcaTokenMarket(rpc: SolanaRpcPort, config: OrcaPoolConfig, owner: string, amountIn: bigint): Promise<OrcaTokenMarketRead>;
export interface OrcaKeptWsol {
    readonly amountAtomic: string;
    readonly lamports: string;
}
export {};
