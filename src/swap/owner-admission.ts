import { evaluateAssetPolicy, type AssetPolicyAdmission, type AssetPolicyRegistry } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import { canonicalProgramIdentity, type SwapProtocolFamily } from "./pin.js";
import type { SwapAssetIdentity } from "./quote.js";

export const SWAP_OWNER_ADMISSION_REQUIRED = "swap_owner_admission_required" as const;
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
export const GUARDED_SWAP_INVENTORY: Readonly<Record<SwapProtocolFamily, string>> = Object.freeze({
  uniswap_ethereum: "apn swap ethereum uniswap inventory", orca_solana: "apn swap solana orca inventory",
  sunswap_tron: "apn swap tron sunswap inventory", jupiter_solana: "apn swap solana jupiter inventory" });

/**
 * The asset policy evaluation of one swap asset on the swap rail. A policy that does not list the network or the asset,
 * or lists the asset without the swap rail, refuses as swap_owner_admission_required and names the gap; every other
 * refusal (a cap, the policy window, invalid input) is thrown exactly as the policy evaluation threw it.
 */
export function evaluateSwapAssetAdmission(policy: AssetPolicyRegistry, subject: SwapAdmissionSubject,
  amounts: { readonly amountAtomic: string; readonly dailyUsageAtomic: string }, at: string): AssetPolicyAdmission {
  const { asset } = subject;
  try {
    return evaluateAssetPolicy(policy, { chain: asset.chain, asset: asset.kind === "native" ? { kind: "native", identifier: null } :
      { kind: "token", identifier: asset.identifier! }, rail: "swap", amountAtomic: amounts.amountAtomic,
      dailyUsageAtomic: amounts.dailyUsageAtomic, asOfDate: at.slice(0, 10), asOf: at });
  } catch (error) {
    // The policy evaluation denies without details; only such a denial can be a missing listing.
    const gap = error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" && error.details === undefined
      ? listingGap(policy, asset, at) : null;
    if (gap === null) throw error;
    throw swapOwnerAdmissionRequired(subject, gap);
  }
}

/** The refusal for one swap asset the active owner policy does not admit, with the commands that show and fix it. */
export function swapOwnerAdmissionRequired(subject: SwapAdmissionSubject, gap: SwapAdmissionGap, lead?: string): ApnError {
  const { asset } = subject, named = `the swap's ${subject.side} asset (${asset.chain} ${asset.kind === "native" ? "native" : `token ${asset.identifier}`})`;
  const cause = gap === "network_not_listed" ? `does not list network ${asset.chain}, so it does not admit ${named}`
    : gap === "asset_not_listed" ? `does not list ${named}`
      : gap === "swap_rail_not_admitted" ? `lists ${named} but does not admit it for the swap rail`
        : `admits ${named} for the swap rail, but not with this lane's route`;
  return new ApnError("APN_OPERATION_BLOCKED", `${lead === undefined ? "" : `${lead} `}The profile's active owner policy ${cause}.`, {
    reason: SWAP_OWNER_ADMISSION_REQUIRED, side: subject.side, chain: asset.chain,
    asset: asset.kind === "native" ? "native" : asset.identifier!, admissionGap: gap,
    nextActions: [`apn allowlist policy status --profile ${subject.profile}`, ...(subject.inventory === null ? [] : [subject.inventory])] });
}

/** The side a route refusal of admittedSwapProtocol names, or null for any other error. */
export function swapRouteGapSide(error: unknown): SwapAssetSide | null {
  const details = error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" ? error.details : undefined;
  if (details === undefined || details.reason !== SWAP_OWNER_ADMISSION_REQUIRED || details.admissionGap !== "swap_route_not_admitted") return null;
  const side = details.side;
  return side === "source" || side === "destination" ? side : null;
}

/**
 * Mirrors the policy evaluation's own order: outside the policy window nothing is a listing gap; then the network, the
 * canonical asset row and its swap rail. Null means the listing admits the asset, so the denial was about something else.
 */
function listingGap(policy: AssetPolicyRegistry, asset: SwapAssetIdentity, at: string): Exclude<SwapAdmissionGap, "swap_route_not_admitted"> | null {
  if (at.slice(0, 10) < policy.effectiveDate || (policy.effectiveAt !== undefined && at < policy.effectiveAt) ||
      (policy.expiresAt !== undefined && at >= policy.expiresAt)) return null;
  const chain = policy.chains.find((row) => row.chain === asset.chain);
  if (chain === undefined) return "network_not_listed";
  const identifier = asset.kind === "native" ? null : canonicalProgramIdentity(chain.family, asset.identifier!);
  const row = chain.assets.find((candidate) => candidate.kind === asset.kind && candidate.identifier === identifier);
  if (row === undefined) return "asset_not_listed";
  return row.rails.swap ? null : "swap_rail_not_admitted";
}
