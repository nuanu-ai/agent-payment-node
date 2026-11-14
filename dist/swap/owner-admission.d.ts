import { type AssetPolicyAdmission, type AssetPolicyRegistry } from "../asset-policy-registry.js";
import { type AssetUsageLedger } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { type SwapProtocolFamily } from "./pin.js";
import type { SwapAssetIdentity } from "./quote.js";
export declare const SWAP_OWNER_ADMISSION_REQUIRED: "swap_owner_admission_required";
/** What the profile's active owner policy lacks for one asset of a swap. */
export type SwapAdmissionGap = "network_not_listed" | "asset_not_listed" | "swap_rail_not_admitted" | "swap_route_not_admitted";
export type SwapAssetSide = "source" | "destination";
/** One asset of a swap whose owner admission is checked, and the lane's inventory that prints the route to admit. */
export interface SwapAdmissionSubject {
    readonly profile: string;
    readonly side: SwapAssetSide;
    readonly asset: SwapAssetIdentity;
    /** The lane's inventory command; null when the installed registry names no single lane. */
    readonly inventory: string | null;
}
/** The inventory of each lane that prepares through the shared guarded swap service. */
export declare const GUARDED_SWAP_INVENTORY: Readonly<Record<SwapProtocolFamily, string>>;
/** The owner command that lists the profile's staged and active allowlist revisions: where admitting an asset starts. */
export declare function swapPolicyStatusCommand(profile: string): string;
/**
 * The asset policy evaluation of one swap asset on the swap rail. A policy that does not list the network or the asset,
 * or lists the asset without the swap rail, refuses as swap_owner_admission_required and names the gap; an amount above
 * the asset's per-transfer or daily cap refuses as allowlist_per_transfer_cap_exceeded or allowlist_daily_cap_exceeded,
 * the reasons the direct rail uses. Every other refusal (the policy window, invalid input) is thrown exactly as the policy
 * evaluation threw it.
 */
export declare function evaluateSwapAssetAdmission(policy: AssetPolicyRegistry, subject: SwapAdmissionSubject, amounts: {
    readonly amountAtomic: string;
    readonly dailyUsageAtomic: string;
}, at: string): AssetPolicyAdmission;
/**
 * The usage ledger refuses a new reservation of a swap's source asset with the policy evaluation's own denial. When the
 * ledger holds no reservation of this operation and today's usage plus the amount is above a cap of the admitted asset,
 * that cap is the refusal (allowlist_daily_cap_exceeded, or allowlist_per_transfer_cap_exceeded); anything else, a replay
 * included, is returned unchanged.
 */
export declare function swapReservationRefusal(error: unknown, ledger: AssetUsageLedger, input: {
    readonly policy: AssetPolicyRegistry;
    readonly subject: SwapAdmissionSubject;
    readonly account: string;
    readonly amountAtomic: string;
    readonly idempotencyKey: string;
    readonly now: Date;
}): Promise<unknown>;
/** The refusal for one swap asset the active owner policy does not admit, with the commands that show and fix it. */
export declare function swapOwnerAdmissionRequired(subject: SwapAdmissionSubject, gap: SwapAdmissionGap, lead?: string): ApnError;
/** The side a route refusal of admittedSwapProtocol names, or null for any other error. */
export declare function swapRouteGapSide(error: unknown): SwapAssetSide | null;
