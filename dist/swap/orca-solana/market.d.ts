import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type TickArrayState, type WhirlpoolState } from "./accounts.js";
import { type WhirlpoolSwapQuote } from "./math.js";
import { type OrcaOwnerBalances } from "./simulation.js";
export interface OrcaMarketRead {
    readonly slot: bigint;
    readonly pool: WhirlpoolState;
    readonly poolView: {
        readonly address: string;
        readonly tickSpacing: number;
        readonly feeRate: number;
        readonly protocolFeeRate: number;
        readonly liquidity: string;
        readonly sqrtPrice: string;
        readonly tickCurrentIndex: number;
    };
    readonly tickArrays: readonly TickArrayState[];
    readonly oracle: string;
    readonly wsolAccount: string;
    readonly usdcAccount: string;
    readonly vaultSolLamports: string;
    readonly vaultUsdcAtomic: string;
    readonly owner: OrcaOwnerBalances;
    readonly tokenAccountRentLamports: bigint;
    readonly accountDataSha256: Readonly<Record<string, string>>;
    readonly swap: WhirlpoolSwapQuote;
}
/**
 * Reads the pinned pool, its two vaults, the three downward tick arrays derived from the current tick, the oracle PDA
 * and the owner's accounts in one `getMultipleAccounts` at one slot, then prices the exact input with the local port of
 * the program's swap math. The tick arrays are derived from a first pool read and re-derived from the same-slot read.
 */
export declare function readOrcaMarket(rpc: SolanaRpcPort, owner: string, amountIn: bigint): Promise<OrcaMarketRead>;
