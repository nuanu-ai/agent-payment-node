import type { JupiterBuildResponse, JupiterQuoteResponse } from "./codec.js";
import { type JupiterProgramSnapshot } from "./catalog.js";
import type { JupiterV0Envelope } from "./transaction.js";
export interface JupiterGuardPolicy {
    readonly taker: string;
    readonly recipient: string;
    readonly recipientTokenAccount: string;
    readonly requestId: string;
    readonly blockhash: string;
    readonly now: string;
    readonly lastValidBlockHeight: string;
    readonly maximumComputeUnits: number;
    readonly maximumComputeUnitPriceMicroLamports: string;
    readonly maximumPriorityFeeLamports: string;
    readonly maximumTipLamports: string;
    readonly allowedTipAccounts: readonly string[];
    readonly maximumPlatformFeeAtomic: string;
    readonly maximumReferralFeeAtomic: string;
    readonly maximumRentLamports: string;
    readonly exactInputLamports: string;
    readonly minimumOutputAtomic: string;
    readonly maximumSlippageBps: number;
    readonly maximumWrappedSolSpendLamports: string;
}
export interface JupiterGuardRefusal {
    readonly signable: false;
    readonly code: "JUPITER_V6_INSTRUCTION_UNVERIFIED";
    readonly bindingHash: string;
    readonly reason: string;
}
/**
 * Validates every safely decodable outer envelope field, then refuses before signing because this
 * module does not guess the JUP6 route instruction/account ABI.
 */
export declare function guardJupiterTransaction(envelope: JupiterV0Envelope, quote: JupiterQuoteResponse, build: JupiterBuildResponse, policy: JupiterGuardPolicy, snapshot: JupiterProgramSnapshot): Promise<JupiterGuardRefusal>;
export declare function assertJupiterSignable(value: JupiterGuardRefusal): never;
