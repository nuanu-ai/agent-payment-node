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
/** Revalidate a frozen selection against the asset it carries; any drift is state corruption. */
export declare function validatePermit2Selection(value: Permit2OfferSelection, payer: Address): Permit2OfferSelection;
