import type { Address } from "../model.js";
import { type Permit2AssetResolver, type Permit2ListAsset } from "./registry.js";
/** One x402 v2 PaymentRequirements object exactly as the seller sent it; never rewritten. */
export interface Permit2Requirement {
    readonly scheme: "exact";
    readonly network: string;
    readonly asset: string;
    readonly amount: string;
    readonly payTo: string;
    readonly maxTimeoutSeconds: number;
    /** The seller's `extra`: the keys APN understands are checked; every other key is carried unchanged. */
    readonly extra: Readonly<Record<string, unknown>>;
}
export interface Permit2OfferSelection {
    /** Original index in the seller's `accepts` list. */
    readonly index: number;
    readonly requirement: Permit2Requirement;
    readonly listAsset: Permit2ListAsset;
    readonly amountAtomic: string;
    readonly payTo: Address;
    readonly maxTimeoutSeconds: number;
    readonly offerHash: string;
}
export type Permit2OfferRefusal = "x402_permit2_no_listed_offer" | "x402_permit2_offer_invalid" | "x402_permit2_facilitator_unavailable";
/**
 * Select the lowest-index seller offer whose (network, token) `resolve` admits, paid through the exact Permit2 flow.
 * Unsupported offers may coexist; they are skipped, never repaired. An admitted offer that APN cannot sign (another
 * scheme or transfer method, a timeout outside the bound, a field or `extra` key APN understands with a wrong value) is
 * refused by the field that decided it. Fields APN does not understand (v1-style `maxAmountRequired`, `resource`,
 * `description`, …) are the seller's own and stay in the requirement unchanged.
 */
export declare function selectPermit2Offer(accepts: readonly unknown[], payer: Address, resolve: Permit2AssetResolver): Permit2OfferSelection;
/**
 * A new Permit2 selection that APN signs through local custody (the foreground Permit2 lane, its preflight and the
 * inspection that leads to them): the offer {@link selectPermit2Offer} picks must leave at least
 * {@link X402_OFFER_MIN_TIMEOUT_SECONDS}, else it is refused by name (`x402_offer_timeout_below_bound`) here, before any
 * consent, instead of expiring at signing after the owner approved. The bound refuses the selected offer rather than
 * skipping it: a saved operation re-derives its offer with {@link selectPermit2Offer}, and both must pick the same one
 * (records prepared before the bound, with a shorter window, still load).
 */
export declare function selectPermit2OfferToSign(accepts: readonly unknown[], payer: Address, resolve: Permit2AssetResolver): Permit2OfferSelection;
/** Revalidate a frozen selection against the asset it carries; any drift is state corruption. */
export declare function validatePermit2Selection(value: Permit2OfferSelection, payer: Address): Permit2OfferSelection;
