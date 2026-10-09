import { type MerchantOperation } from "./model.js";
declare const PHASES: readonly ["pre_custody_fee", "custody", "verify", "seal", "post_seal_fee", "challenge", "send_claim", "send_wire"];
export type MerchantFailurePhase = typeof PHASES[number];
export interface MerchantFailure {
    readonly at: string;
    readonly phase: MerchantFailurePhase;
    readonly code: string;
    readonly reason: string;
    readonly evidenceHash: string;
}
export declare function validateMerchantFailures(rows: readonly MerchantFailure[]): void;
/** Never retains an arbitrary exception message, body, key, signature or details object. */
export declare function appendMerchantFailure(o: MerchantOperation, error: unknown, phase: MerchantFailurePhase, at: string): MerchantOperation;
export {};
