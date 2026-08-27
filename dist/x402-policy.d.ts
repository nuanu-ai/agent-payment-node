import type { Address } from "./model.js";
import type { HttpPort, X402PrepareEvidence } from "./ports.js";
import { decodePaymentRequiredHeader } from "./x402-codec.js";
import type { InspectCandidate } from "./x402-model.js";
import type { X402OperationRecord, X402SelectedOffer } from "./x402-state-integrity.js";
type PaymentRequired = ReturnType<typeof decodePaymentRequiredHeader>;
type PaymentRequirements = PaymentRequired["accepts"][number];
export interface FreshChallenge {
    readonly paymentRequired: PaymentRequired;
    readonly staticCandidates: readonly InspectCandidate[];
}
export interface SelectedPrepareOffer {
    readonly requirements: PaymentRequirements;
    readonly selectedOffer: X402SelectedOffer;
    readonly amountAtomic: string;
    readonly payee: Address;
    readonly maxTimeoutSeconds: number;
}
export interface PrepareEvidenceContext {
    readonly rpcOriginHash: string;
    readonly invocationStartedAtMs: number;
    readonly invocationCompletedAtMs: number;
}
export declare function canonicalPrepareUrl(value: string): URL;
export declare function positiveCap(value: unknown): string;
export declare function freshChallenge(http: HttpPort, canonicalUrl: string): Promise<FreshChallenge>;
export declare function candidatesWithinCap(challenge: FreshChallenge, capAtomic: string): readonly InspectCandidate[];
export declare function selectPrepareOffer(challenge: FreshChallenge, underCap: readonly InspectCandidate[], evidence: X402PrepareEvidence, wallet: Address, context: PrepareEvidenceContext): SelectedPrepareOffer;
export declare function tokenDomainSeparator(name: string, version: string): `0x${string}`;
export declare function paymentIdentifierState(paymentRequired: PaymentRequired, operationId: string): X402OperationRecord["paymentIdentifier"] | undefined;
export declare function materializePaymentIdentifier(paymentIdentifier: X402OperationRecord["paymentIdentifier"] | undefined): unknown | undefined;
export {};
