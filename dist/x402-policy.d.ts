import { type X402Asset } from "./x402-network.js";
import type { Address } from "./model.js";
import type { HttpPort, X402PrepareEvidence } from "./ports.js";
import { decodePaymentRequiredHeader } from "./x402-codec.js";
import type { X402HttpRequestV1 } from "./x402-http-request.js";
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
    /** The selected network and token; the evidence must be read at its proof tag and, off the released pairs, carry token facts. */
    readonly asset: X402Asset;
    readonly rpcOriginHash: string;
    readonly invocationStartedAtMs: number;
    readonly invocationCompletedAtMs: number;
}
export declare function canonicalPrepareUrl(value: string): URL;
export declare function positiveCap(value: unknown): string;
export declare function freshChallenge(http: HttpPort, canonicalUrl: string, httpRequest?: X402HttpRequestV1, asset?: X402Asset): Promise<FreshChallenge>;
export declare function candidatesWithinCap(challenge: FreshChallenge, capAtomic: string): readonly InspectCandidate[];
export declare function selectPrepareOffer(challenge: FreshChallenge, underCap: readonly InspectCandidate[], evidence: X402PrepareEvidence, wallet: Address, context: PrepareEvidenceContext, transferMethod?: "eip3009" | "erc7710"): SelectedPrepareOffer;
/** EIP-712 domain separator of an EIP-3009 token; a bare chain id means that chain's released USDC. */
export declare function tokenDomainSeparator(name: string, version: string, asset?: {
    readonly chainId: number;
    readonly token: string;
} | number): `0x${string}`;
export declare function paymentIdentifierState(paymentRequired: PaymentRequired, operationId: string): X402OperationRecord["paymentIdentifier"] | undefined;
export declare function materializePaymentIdentifier(paymentIdentifier: X402OperationRecord["paymentIdentifier"] | undefined): unknown | undefined;
/** The observation fields every method's prepare evidence shares; only EIP-3009 carries a token domain separator. */
export type PrepareObservation = Omit<X402PrepareEvidence, "domainSeparator"> & {
    readonly domainSeparator?: `0x${string}`;
};
export declare function validatePrepareEvidence(evidence: PrepareObservation, wallet: Address, context: PrepareEvidenceContext, transferMethod: "eip3009" | "erc7710" | "permit2"): void;
export {};
