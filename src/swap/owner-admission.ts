import { ASSET_POLICY_REGISTRY_SCHEMA_V2, evaluateAssetPolicy, type AssetAtomicCaps, type AssetPolicyAdmission,
  type AssetPolicyRegistry } from "../asset-policy-registry.js";
import { assetUsageReservationId, type AssetUsageLedger } from "../asset-usage-ledger.js";
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

/** The owner command that lists the profile's staged and active allowlist revisions: where admitting an asset starts. */
export function swapPolicyStatusCommand(profile: string): string { return `apn allowlist policy status --profile ${profile}`; }

/**
 * The asset policy evaluation of one swap asset on the swap rail. A policy that does not list the network or the asset,
 * or lists the asset without the swap rail, refuses as swap_owner_admission_required and names the gap; an amount above
 * the asset's per-transfer or daily cap refuses as allowlist_per_transfer_cap_exceeded or allowlist_daily_cap_exceeded,
 * the reasons the direct rail uses. Every other refusal (the policy window, invalid input) is thrown exactly as the policy
 * evaluation threw it.
 */
export function evaluateSwapAssetAdmission(policy: AssetPolicyRegistry, subject: SwapAdmissionSubject,
  amounts: { readonly amountAtomic: string; readonly dailyUsageAtomic: string }, at: string): AssetPolicyAdmission {
  const { asset } = subject;
  try {
    return evaluateAssetPolicy(policy, { chain: asset.chain, asset: asset.kind === "native" ? { kind: "native", identifier: null } :
      { kind: "token", identifier: asset.identifier! }, rail: "swap", amountAtomic: amounts.amountAtomic,
      dailyUsageAtomic: amounts.dailyUsageAtomic, asOfDate: at.slice(0, 10), asOf: at });
  } catch (error) {
    // The policy evaluation denies without details; only such a denial can be a missing listing or a cap.
    if (!(error instanceof ApnError) || error.code !== "APN_OPERATION_BLOCKED" || error.details !== undefined) throw error;
    const found = listing(policy, asset, at);
    if (found.kind === "gap") throw swapOwnerAdmissionRequired(subject, found.gap);
    throw (found.kind === "admitted" ? swapCapRefusal(subject, found.caps, amounts) : null) ?? error;
  }
}

/**
 * The usage ledger refuses a new reservation of a swap's source asset with the policy evaluation's own denial. When the
 * ledger holds no reservation of this operation and today's usage plus the amount is above a cap of the admitted asset,
 * that cap is the refusal (allowlist_daily_cap_exceeded, or allowlist_per_transfer_cap_exceeded); anything else, a replay
 * included, is returned unchanged.
 */
export async function swapReservationRefusal(error: unknown, ledger: AssetUsageLedger, input: { readonly policy: AssetPolicyRegistry;
  readonly subject: SwapAdmissionSubject; readonly account: string; readonly amountAtomic: string; readonly idempotencyKey: string;
  readonly now: Date }): Promise<unknown> {
  if (!(error instanceof ApnError) || error.code !== "APN_OPERATION_BLOCKED" || error.details !== undefined) return error;
  const { asset } = input.subject, found = listing(input.policy, asset, input.now.toISOString());
  if (found.kind !== "admitted") return error;
  try {
    const identity = { account: input.account, chain: asset.chain, asset: asset.kind === "native" ? { kind: "native" as const, identifier: null }
      : { kind: "token" as const, identifier: asset.identifier! } };
    if (await ledger.load(identity, assetUsageReservationId(identity, input.idempotencyKey)) !== null) return error;
    const usage = (await ledger.usage(identity, input.now)).amountAtomic;
    return swapCapRefusal(input.subject, found.caps, { amountAtomic: input.amountAtomic, dailyUsageAtomic: usage }) ?? error;
  } catch { return error; }
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
    nextActions: [swapPolicyStatusCommand(subject.profile), ...(subject.inventory === null ? [] : [subject.inventory])] });
}

/** The cap the amount exceeds, in the policy evaluation's order and with its exact messages; null when it fits both. */
function swapCapRefusal(subject: SwapAdmissionSubject, caps: AssetAtomicCaps,
  amounts: { readonly amountAtomic: string; readonly dailyUsageAtomic: string }): ApnError | null {
  const { asset } = subject, where = { side: subject.side, chain: asset.chain, asset: asset.kind === "native" ? "native" : asset.identifier! };
  const amount = BigInt(amounts.amountAtomic), usage = BigInt(amounts.dailyUsageAtomic), daily = BigInt(caps.dailyLimitAtomic);
  if (amount > BigInt(caps.maximumPerTransferAtomic)) return new ApnError("APN_OPERATION_BLOCKED", "The transfer exceeds the asset policy per-transfer cap.",
    { reason: "allowlist_per_transfer_cap_exceeded", ...where, maximum_per_transfer_atomic: caps.maximumPerTransferAtomic, amount_atomic: amounts.amountAtomic });
  if (usage > daily || usage + amount > daily) return new ApnError("APN_OPERATION_BLOCKED", "The transfer exceeds the asset policy daily cap.",
    { reason: "allowlist_daily_cap_exceeded", ...where, daily_limit_atomic: caps.dailyLimitAtomic, daily_usage_atomic: amounts.dailyUsageAtomic,
      amount_atomic: amounts.amountAtomic });
  return null;
}

/** The side a route refusal of admittedSwapProtocol names, or null for any other error. */
export function swapRouteGapSide(error: unknown): SwapAssetSide | null {
  const details = error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" ? error.details : undefined;
  if (details === undefined || details.reason !== SWAP_OWNER_ADMISSION_REQUIRED || details.admissionGap !== "swap_route_not_admitted") return null;
  const side = details.side;
  return side === "source" || side === "destination" ? side : null;
}

type Listing = { readonly kind: "outside_window" | "no_swap_caps" } | { readonly kind: "gap"; readonly gap: Exclude<SwapAdmissionGap, "swap_route_not_admitted"> } |
  { readonly kind: "admitted"; readonly caps: AssetAtomicCaps };
/**
 * Mirrors the policy evaluation's own order: outside the policy window nothing is a listing gap; then the network, the
 * canonical asset row and its swap rail, then the rail's caps (version 2: the swap rail's own pair).
 */
function listing(policy: AssetPolicyRegistry, asset: SwapAssetIdentity, at: string): Listing {
  if (at.slice(0, 10) < policy.effectiveDate || (policy.effectiveAt !== undefined && at < policy.effectiveAt) ||
      (policy.expiresAt !== undefined && at >= policy.expiresAt)) return { kind: "outside_window" };
  const chain = policy.chains.find((row) => row.chain === asset.chain);
  if (chain === undefined) return { kind: "gap", gap: "network_not_listed" };
  const identifier = asset.kind === "native" ? null : canonicalProgramIdentity(chain.family, asset.identifier!);
  const row = chain.assets.find((candidate) => candidate.kind === asset.kind && candidate.identifier === identifier);
  if (row === undefined) return { kind: "gap", gap: "asset_not_listed" };
  if (!row.rails.swap) return { kind: "gap", gap: "swap_rail_not_admitted" };
  const caps = policy.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? row.railCaps?.swap : row.caps;
  return caps === undefined ? { kind: "no_swap_caps" } : { kind: "admitted", caps };
}
