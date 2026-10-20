/**
 * The longest seller payment window (`maxTimeoutSeconds`) APN signs for, EIP-3009 and Permit2 alike: the signed
 * authorization (EIP-3009 `validBefore`, Permit2 `deadline`) stays valid this long after prepare. In the public x402
 * discovery catalog (25,959 resources, 71,406 `exact` offers, read 2026-10-21) 95.1% of offers ask at most 300 s and
 * 96.4% at most 3,600 s; about 3.5% ask 604,800–605,400 s (seven days), which APN refuses by name
 * (`x402_offer_timeout_exceeds_bound`) instead of leaving a payment signature live for a week.
 */
export declare const X402_OFFER_MAX_TIMEOUT_SECONDS = 3600;
/** The shortest window unattended x402 signs for: prepare, the owner's approval, signing and the paid request must fit. */
export declare const X402_OFFER_MIN_TIMEOUT_SECONDS = 30;
export type X402OfferRefusalReason = "x402_offer_scheme_unsupported" | "x402_offer_amount_invalid" | "x402_offer_payee_invalid" | "x402_offer_method_unsupported" | "x402_offer_timeout_exceeds_bound" | "x402_offer_timeout_below_bound" | "x402_offer_extra_invalid" | "x402_offer_spender_mismatch" | "x402_offer_chain_mismatch" | "x402_token_decimals_mismatch" | "x402_solana_fee_payer_invalid";
/** Why one seller offer cannot be signed: the deciding field, the seller's value and what APN accepts there. */
export interface X402OfferRefusal {
    readonly reason: X402OfferRefusalReason;
    readonly field: string;
    readonly value?: string;
    readonly expected?: string;
}
/** A refused offer as a refusal names it: its place in the seller's list and what it offered. */
export interface X402RefusedOffer extends X402OfferRefusal {
    readonly index: string;
    readonly network: string;
    readonly asset: string;
    readonly method: string;
}
export type X402EvmMethod = "eip3009" | "permit2" | "erc7710";
export declare function offerRefusal(reason: X402OfferRefusalReason, field: string, value?: unknown, expected?: string): X402OfferRefusal;
export declare function isOfferRefusal(value: unknown): value is X402OfferRefusal;
/** The seller's window must be a whole number of seconds from `minimum` through {@link X402_OFFER_MAX_TIMEOUT_SECONDS}. */
export declare function timeoutRefusal(value: unknown, minimum: number): X402OfferRefusal | null;
/** `extra.assetTransferMethod`: absent or `eip3009`, `permit2`, `erc7710`; any other method is refused by its name. */
export declare function evmOfferMethod(extra: Readonly<Record<string, unknown>>): X402EvmMethod | X402OfferRefusal;
/**
 * The `extra` keys APN understands, checked strictly: `name`/`version` (bounded text; required for EIP-3009, a pair for
 * Permit2), `decimals` (0..255; the token's own decimals are compared where they are read), `paymentFlow`
 * (`authorization` outside Permit2), Permit2 `spenderAddress` (exactly the x402 exact Permit2 proxy) and `chainId`
 * (exactly the offer's chain). Every other key is the seller's own: never a reason to refuse, carried unchanged in the
 * `accepted` requirements the payment payload echoes.
 */
export declare function evmExtraRefusal(extra: Readonly<Record<string, unknown>>, method: X402EvmMethod, chainId: number): X402OfferRefusal | null;
/** The offer's declared token decimals must equal the token's own; absent, nothing is compared. */
export declare function decimalsRefusal(extra: Readonly<Record<string, unknown>>, decimals: number): X402OfferRefusal | null;
/** The method an offer names, as text for a refusal's details (never trusted for anything else). */
export declare function declaredMethod(extra: unknown): string;
/**
 * The refusal details for offers of the selected chain and token that were all refused: the reason they share (or
 * `x402_offers_refused` when they differ), the first one's deciding field with the seller's value and what APN accepts
 * there, a message naming it, and every refused offer in seller order as one line each (at most 16).
 */
export declare function refusedOffersDetails(refused: readonly X402RefusedOffer[]): {
    readonly message: string;
    readonly details: {
        readonly reason: string;
        readonly field: string;
        readonly sellerValue?: string;
        readonly accepted?: string;
        readonly refused: readonly string[];
    };
};
