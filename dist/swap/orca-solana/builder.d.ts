import { type SolanaRpcPort } from "../../solana/rpc.js";
import type { GuardedSwapReadOnlyBuilder } from "../runtime.js";
import { type OrcaSwapLifetime } from "./instructions.js";
import { type OrcaKeylessMaterial, type SavedOrcaQuoteStore } from "./material.js";
import { type OrcaProgramPinVerifier } from "./pins.js";
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
 * Keyless read-only builder: price, expected output, slippage floor and impact come from the pinned Whirlpool, its
 * vaults and tick arrays at one slot; the instruction list is built locally, validated, fee-priced by the chain and
 * simulated with `sigVerify: false`. No API key, route API or off-chain quote is used. Nothing is signed.
 */
export declare class KeylessOrcaQuoteBuilder implements GuardedSwapReadOnlyBuilder<OrcaKeylessQuoteRequest> {
    private readonly rpc;
    private readonly quotes;
    private readonly verifyPins;
    constructor(rpc: SolanaRpcPort, quotes: SavedOrcaQuoteStore, verifyPins: OrcaProgramPinVerifier);
    quote(input: OrcaKeylessQuoteRequest & {
        readonly now: Date;
    }): Promise<unknown>;
    load(quoteHash: string): Promise<OrcaKeylessMaterial | null>;
}
export declare function latestLifetime(rpc: SolanaRpcPort): Promise<OrcaSwapLifetime>;
export declare function orcaMessageFee(rpc: SolanaRpcPort, messageBase64: string): Promise<bigint>;
/** An insufficient balance is an economic refusal: input, fee, USDC account rent and the transient wSOL rent. */
export declare function requireOrcaFunds(ownerLamports: string, required: bigint): void;
