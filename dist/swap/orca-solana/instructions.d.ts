import { compileTransaction, type Instruction } from "@solana/kit";
/** Everything the transaction depends on besides its lifetime. The quote hash binds it through the payload hash. */
export interface OrcaSwapPlan {
    readonly owner: string;
    readonly wsolAccount: string;
    readonly usdcAccount: string;
    readonly amountInLamports: string;
    readonly minimumOutputAtomic: string;
    readonly computeUnitLimit: number;
    readonly computeUnitPriceMicroLamports: string;
    readonly tickArrays: readonly string[];
    readonly oracle: string;
}
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
export declare const ORCA_ALLOWED_PROGRAMS: readonly string[];
export declare const ORCA_MAX_COMPUTE_UNITS = 1400000;
/**
 * The only instruction list APN signs for this swap: compute budget (owner-capped limit and price), idempotent wSOL
 * and USDC associated accounts, wrap exactly the input, sync, Whirlpool `swap` (exact input, A to B, no price limit,
 * minimum output as `other_amount_threshold`), and close the wSOL account back to the owner.
 */
export declare function orcaSwapInstructions(planValue: OrcaSwapPlan): readonly Instruction[];
export declare function compileOrcaSwap(plan: OrcaSwapPlan, lifetime: OrcaSwapLifetime): CompiledOrcaSwap;
/**
 * Strict decoder-side validation of the compiled bytes: v0 without lookup tables, the owner as the only signer and
 * fee payer, only the five allowed programs, exactly the eight expected instructions with exact accounts, roles and
 * data, and no writable account beyond the owner, its two token accounts, and the pool's swap accounts.
 */
export declare function validateOrcaSwapMessage(messageBytes: Uint8Array, planValue: OrcaSwapPlan, expectedBlockhash: string): void;
export declare function validatePlan(plan: OrcaSwapPlan): OrcaSwapPlan;
