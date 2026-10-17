import { compileTransaction, type Instruction } from "@solana/kit";
import { type OrcaPoolConfig } from "./pools.js";
/**
 * Everything a native SOL to USDC transaction depends on besides its lifetime (the sol-usdc pool), in the shape every
 * APN release wrote it. The quote hash binds it through the payload hash.
 */
export interface OrcaNativeSwapPlan {
    readonly owner: string;
    readonly wsolAccount: string;
    readonly usdcAccount: string;
    readonly amountInLamports: string;
    readonly minimumOutputAtomic: string;
    readonly computeUnitLimit: number;
    readonly computeUnitPriceMicroLamports: string;
    readonly tickArrays: readonly string[];
    readonly oracle: string;
    /** The owner's wSOL account existed at quote: it is reused and kept (never closed), so its own balance never unwraps. */
    readonly wsolAccountKept?: true;
}
/** A token-input pool: the owner's classic token account of mint A is debited, its account of mint B is credited. */
export interface OrcaTokenSwapPlan {
    readonly pool: OrcaTokenPoolId;
    readonly owner: string;
    readonly sourceAccount: string;
    readonly destinationAccount: string;
    readonly amountInAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly computeUnitLimit: number;
    readonly computeUnitPriceMicroLamports: string;
    readonly tickArrays: readonly string[];
    readonly oracle: string;
}
export type OrcaTokenPoolId = "usdc-usdt";
export type OrcaSwapPlan = OrcaNativeSwapPlan | OrcaTokenSwapPlan;
export interface OrcaSwapLifetime {
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
}
export interface CompiledOrcaSwap {
    readonly transaction: ReturnType<typeof compileTransaction>;
    readonly unsignedPayload: string;
    readonly messageBase64: string;
    readonly messageHash: string;
}
/** The pool and the owner accounts on its A (debited) and B (credited) sides, whatever the plan shape. */
export interface OrcaPlanSides {
    readonly pool: OrcaPoolConfig;
    readonly source: string;
    readonly destination: string;
    readonly amountIn: string;
}
export declare const ORCA_ALLOWED_PROGRAMS: readonly string[];
export declare const ORCA_MAX_COMPUTE_UNITS = 1400000;
export declare function isOrcaTokenPlan(plan: OrcaSwapPlan): plan is OrcaTokenSwapPlan;
export declare function orcaPlanSides(plan: OrcaSwapPlan): OrcaPlanSides;
/**
 * The only instruction list APN signs for one swap: compute budget (owner-capped limit and price), then for sol-usdc the
 * idempotent wSOL and USDC accounts, the wrap of exactly the input and its sync, and for a token pool the idempotent
 * destination account; then Whirlpool `swap` (exact input, A to B, no price limit, minimum output as
 * `other_amount_threshold`), and for sol-usdc the close of the wSOL account back to the owner.
 */
export declare function orcaSwapInstructions(planValue: OrcaSwapPlan): readonly Instruction[];
export declare function compileOrcaSwap(plan: OrcaSwapPlan, lifetime: OrcaSwapLifetime): CompiledOrcaSwap;
/**
 * Strict decoder-side validation of the compiled bytes: v0 without lookup tables, the owner as the only signer and
 * fee payer, only the five allowed programs, exactly the expected instructions with exact accounts, roles and data, and
 * no writable account beyond the owner, its two token accounts, and the pool's swap accounts.
 */
export declare function validateOrcaSwapMessage(messageBytes: Uint8Array, planValue: OrcaSwapPlan, expectedBlockhash: string): void;
export declare function validatePlan(plan: OrcaSwapPlan): OrcaSwapPlan;
