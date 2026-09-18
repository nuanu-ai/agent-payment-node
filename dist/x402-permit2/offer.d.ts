import type { Address } from "../model.js";
import { type Permit2ListAsset } from "./registry.js";
/** One x402 v2 PaymentRequirements object exactly as the seller sent it; never rewritten. */
export interface Permit2Requirement {
    readonly scheme: "exact";
    readonly network: string;
    readonly asset: string;
    readonly amount: string;
    readonly payTo: string;
    readonly maxTimeoutSeconds: number;
    readonly extra: Readonly<Record<string, string>>;
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
 * Select the first seller offer that pays a list-pinned token on a list network through the exact Permit2 flow.
 * Unsupported offers may coexist; they are skipped, never repaired. An offer naming a pinned token with any
 * deviation (unknown field, another transfer method, other token domain, unbounded timeout) is not selectable.
 */
export declare function selectPermit2Offer(accepts: readonly unknown[], payer: Address): Permit2OfferSelection;
/** Revalidate a frozen selection against its pinned registry row; any drift is state corruption. */
export declare function validatePermit2Selection(value: Permit2OfferSelection, payer: Address): Permit2OfferSelection;
