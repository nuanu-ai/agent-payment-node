import type { HttpPort } from "../ports.js";
import type { X402SolanaRecord, X402SolanaTerms } from "./model.js";
export interface X402SolanaChallenge {
    readonly url: string;
    readonly origin: string;
    readonly urlHash: string;
    readonly challengeHash: string;
    readonly resourceCanonicalJson: string;
    readonly accepts: readonly unknown[];
}
/** The unpaid GET: a canonical public HTTPS URL answering 402 with one strict x402 v2 PAYMENT-REQUIRED header. */
export declare function readSolanaChallenge(http: HttpPort, url: string): Promise<X402SolanaChallenge>;
/** The PAYMENT-SIGNATURE header: the seller's own resource and offer, and the partially signed transaction. */
export declare function solanaPaymentHeader(terms: X402SolanaTerms, rawPayload: string): string;
export type X402SolanaResponse = NonNullable<X402SolanaRecord["response"]>;
/**
 * The single paid request. The seller's PAYMENT-RESPONSE is kept only as a hint (its transaction signature), which
 * settles nothing until the chain shows the frozen bytes under it; a malformed one is simply no hint.
 */
export declare function sendSolanaPayment(http: HttpPort, terms: X402SolanaTerms, header: string, now: () => Date): Promise<X402SolanaResponse>;
export declare function requireSolanaRpcUrl(value: string | undefined): string;
