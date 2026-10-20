import type { X402PaymentRequired as PaymentRequired, X402PaymentRequirements as PaymentRequirements } from "./x402-codec.js";
import { ApnError } from "./errors.js";
import type { InspectCandidate } from "./x402-model.js";
import { type X402Asset } from "./x402-network.js";
import { type X402OfferRefusal, type X402RefusedOffer } from "./x402-offer-terms.js";
export interface X402OfferInspection {
    readonly candidates: readonly InspectCandidate[];
    /** Offers of exactly the selected network and token that APN refused, each with its deciding field. */
    readonly refused: readonly X402RefusedOffer[];
    /** The challenge's own resource URL when its origin or path is not the requested one (then no offer is a candidate); else null. */
    readonly resourceMismatch: string | null;
}
/** Offers of exactly the selected network and token (a bare chain id: its released USDC); others are skipped, never repaired. */
export declare function inspectCandidates(paymentRequired: PaymentRequired, requestedUrl: string, asset: X402Asset): readonly InspectCandidate[];
/** Every offer of the selected network and token, judged: a candidate, or refused with the reason that decided it. */
export declare function inspectOffers(paymentRequired: PaymentRequired, requestedUrl: string, asset: X402Asset): X402OfferInspection;
/**
 * One seller offer against the selected network and token: null when it is for another network or token, a candidate
 * when APN can sign it, otherwise the refusal naming the field that decided it (amount, payee, method, timeout, an
 * `extra` key APN understands, the token's decimals).
 */
export declare function inspectOffer(requirements: PaymentRequirements, index: number, selected: X402Asset): InspectCandidate | X402OfferRefusal | null;
/**
 * The refusal when no offer of the selected network and token can be signed: the resource the seller names is another
 * origin or path, every such offer was refused (each with its reason), or the seller offers this network and token not at all.
 */
export declare function unsupportedOfferError(asset: X402Asset, paymentRequired: PaymentRequired, inspection: X402OfferInspection): ApnError;
/**
 * The seller's resource names the requested endpoint: the same scheme, host, port and path after WHATWG normalisation.
 * Query and fragment may differ (most sellers name the resource without the caller's query); the seller's resource is
 * still echoed unchanged in the payment payload, and the paid request goes to the requested URL.
 */
export declare function x402ResourceNamesRequest(value: string, requested: string): boolean;
