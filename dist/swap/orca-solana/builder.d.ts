import { type SolanaRpcPort } from "../../solana/rpc.js";
import type { GuardedSwapReadOnlyBuilder } from "../runtime.js";
import { type OrcaSwapLifetime } from "./instructions.js";
import { type OrcaKeylessMaterial, type SavedOrcaQuoteStore } from "./material.js";
import { type OrcaProgramPinVerifier } from "./pins.js";
import type { OrcaPoolConfig } from "./pools.js";
export interface OrcaKeylessQuoteRequest {
    readonly profile: string;
    readonly account: string;
    readonly amountAtomic: string;
    readonly slippageBps: number;
    readonly ownerSlippageCapBps: number;
    readonly computeUnitLimit: number;
    readonly computeUnitPriceMicroLamports: string;
}
/**
 * Keyless read-only builder for one pinned pool: price, expected output, slippage floor and impact come from the pinned
 * Whirlpool, its vaults and tick arrays at one slot; the instruction list is built locally, validated, fee-priced by the
 * chain and simulated with `sigVerify: false`. No API key, route API or off-chain quote is used. Nothing is signed.
 */
export declare class KeylessOrcaQuoteBuilder implements GuardedSwapReadOnlyBuilder<OrcaKeylessQuoteRequest> {
    private readonly rpc;
    private readonly quotes;
    private readonly verifyPins;
    readonly pool: OrcaPoolConfig;
    constructor(rpc: SolanaRpcPort, quotes: SavedOrcaQuoteStore, verifyPins: OrcaProgramPinVerifier, pool: OrcaPoolConfig);
    quote(input: OrcaKeylessQuoteRequest & {
        readonly now: Date;
    }): Promise<unknown>;
    /** A saved quote of another pool never enters this pool's runtime. */
    load(quoteHash: string): Promise<OrcaKeylessMaterial | null>;
    private quoteNative;
    private quoteToken;
    private priced;
    /** Binds the quote to the evidence, plan, bytes and simulation, saves the material, and returns the unsigned quote. */
    private saved;
}
export declare function latestLifetime(rpc: SolanaRpcPort): Promise<OrcaSwapLifetime>;
export declare function orcaMessageFee(rpc: SolanaRpcPort, messageBase64: string): Promise<bigint>;
/** An insufficient balance is an economic refusal: the SOL the swap may spend (input for sol-usdc, fee, account rent). */
export declare function requireOrcaFunds(ownerLamports: string, required: bigint): void;
