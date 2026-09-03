import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { InspectCandidate } from "./x402-model.js";
export type X402PaymentPayload = PaymentPayload;
export type X402PaymentRequirements = PaymentRequirements;
export declare function encodeCanonicalBase64Json(value: unknown): string;
export declare function decodeCanonicalBase64Json(value: string): unknown;
export declare function encodePaymentRequiredHeader(value: PaymentRequired): string;
export declare function decodePaymentRequiredHeader(value: string): PaymentRequired;
export declare function encodePaymentSignatureHeader(value: unknown): string;
export declare function decodePaymentSignatureHeader(value: string): PaymentPayload;
export interface DecodedPaymentResponse {
    readonly classification: "success" | "settlement_pending" | "failure_with_transaction";
    readonly normalizedCanonicalJson: string;
    readonly transactionHash: `0x${string}`;
    readonly paymentResponseHeaderHash: string;
    readonly settlementResponseHash: string;
}
export declare function decodeAndNormalizePaymentResponseHeader(value: string, expected: {
    readonly payer: string;
    readonly amountAtomic: string;
}): DecodedPaymentResponse;
export declare function inspectCandidates(paymentRequired: PaymentRequired, requestedUrl: string): readonly InspectCandidate[];
