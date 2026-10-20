import { canonicalJson, domainHash } from "../canonical.js";
import { loadActiveAssetPolicyRegistry, type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { recipientAdmitted } from "../allowlist-recipient-pins.js";
import { ASSET_POLICY_REGISTRY_SCHEMA_V2, evaluateAssetPolicy, type AssetAtomicCaps, type AssetPolicyAdmission, type AssetPolicyRow } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity, type AssetUsageReservation, type AssetUsageState } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { X402_SOLANA_ALLOWLIST_CHAIN, X402_SOLANA_MECHANISM, X402_SOLANA_NETWORK } from "./constants.js";
import type { X402SolanaRecord, X402SolanaState, X402SolanaTerms } from "./model.js";

/** The owner's admission of one mint for Solana x402: the active allowlist row, its x402 caps and the exact mechanism pin. */
export interface X402SolanaOwnerRow { readonly active: ActiveAssetPolicy; readonly row: AssetPolicyRow; readonly caps: AssetAtomicCaps }

export async function x402SolanaOwnerRow(root: string, profile: string, payer: string, mint: string, now: Date): Promise<X402SolanaOwnerRow> {
  const active = await loadActiveAssetPolicyRegistry(root, profile, now);
  const refuse = (reason: string, message: string): never => {
    throw new ApnError("APN_ALLOWLIST_REFUSED", message, { reason, rail: "x402", chain: X402_SOLANA_NETWORK, asset: mint,
      nextActions: [`apn allowlist policy status --profile ${profile}`] });
  };
  if (active === null) return refuse("allowlist_policy_required", "Solana x402 requires an owner-activated allowlist policy for this profile.");
  if (active.accounts.solana !== payer) return refuse("allowlist_account_mismatch", "The active owner allowlist policy names a different Solana account.");
  const row = active.registry.chains.find((chain) => chain.chain === X402_SOLANA_ALLOWLIST_CHAIN)?.assets
    .find((asset) => asset.kind === "token" && asset.identifier === mint);
  const pin = row?.mechanismPins?.x402;
  const caps = row === undefined || !row.rails.x402 ? undefined
    : active.registry.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? row.railCaps?.x402 : row.caps;
  if (row === undefined || caps === undefined || pin?.provider !== X402_SOLANA_MECHANISM.provider || pin.reference !== X402_SOLANA_MECHANISM.reference) {
    return refuse("allowlist_x402_not_admitted", `The active owner allowlist policy does not admit ${mint} for Solana x402 ` +
      `(an x402 row with the ${X402_SOLANA_MECHANISM.provider} / ${X402_SOLANA_MECHANISM.reference} mechanism pin).`);
  }
  return { active, row, caps };
}

/** The exact admission of one amount today (per-payment and daily caps against the shared usage of this account and mint). */
export function evaluateX402Solana(owner: X402SolanaOwnerRow, amountAtomic: string, dailyUsageAtomic: string, now: Date): AssetPolicyAdmission {
  const caps = owner.caps, details = { rail: "x402", chain: X402_SOLANA_NETWORK, asset: owner.row.identifier!, amount_atomic: amountAtomic,
    maximum_per_transfer_atomic: caps.maximumPerTransferAtomic, daily_limit_atomic: caps.dailyLimitAtomic, daily_usage_atomic: dailyUsageAtomic };
  if (BigInt(amountAtomic) > BigInt(caps.maximumPerTransferAtomic)) {
    throw new ApnError("APN_ALLOWLIST_REFUSED", "The price exceeds the owner's per-payment cap for this mint.", { reason: "allowlist_per_transfer_cap_exceeded", ...details });
  }
  if (BigInt(dailyUsageAtomic) + BigInt(amountAtomic) > BigInt(caps.dailyLimitAtomic)) {
    throw new ApnError("APN_ALLOWLIST_REFUSED", "The price exceeds the owner's daily cap for this mint given today's usage.", { reason: "allowlist_daily_cap_exceeded", ...details });
  }
  const at = now.toISOString();
  return evaluateAssetPolicy(owner.active.registry, { chain: X402_SOLANA_ALLOWLIST_CHAIN, asset: { kind: "token", identifier: owner.row.identifier! },
    rail: "x402", amountAtomic, dailyUsageAtomic, asOfDate: at.slice(0, 10), asOf: at });
}

export function payeeAdmitted(owner: X402SolanaOwnerRow, payee: string, now: Date): boolean {
  return recipientAdmitted({ admission: evaluateX402Solana(owner, "1", "0", now), recipient: payee });
}

export function x402SolanaUsageIdentity(terms: Pick<X402SolanaTerms, "payer" | "mint">): AssetUsageIdentity {
  return { account: terms.payer, chain: X402_SOLANA_ALLOWLIST_CHAIN, asset: { kind: "token", identifier: terms.mint } };
}
export function x402SolanaUsageKey(operationId: string): string { return `apn.x402-solana-usage:${operationId}`; }

const TARGET: Readonly<Record<X402SolanaState, AssetUsageState | null>> = {
  prepared: null, reserving: "reserved", signed: "reserved", exposed: "submitted", settled: "finalized",
  failed_onchain: "failed_confirmed_revert", expired_unlanded: "released_unsubmitted", failed_before_effect: "failed_before_effect",
  // The owner acknowledged an unknown outcome: the price is charged as spent.
  abandoned_unknown: "finalized",
};
const TERMINAL: readonly AssetUsageState[] = ["finalized", "failed_before_effect", "released_unsubmitted", "failed_confirmed_revert"];

/** The usage hold follows the journal forward and never backward; each command repairs a lagging ledger. */
export async function followX402SolanaUsage(root: string, record: X402SolanaRecord, now: Date): Promise<AssetUsageReservation | null> {
  const ledger = new AssetUsageLedger(root), identity = x402SolanaUsageIdentity(record.terms);
  let current = await ledger.load(identity, assetUsageReservationId(identity, x402SolanaUsageKey(record.operationId)));
  const target = TARGET[record.state];
  if (current === null || target === null || target === "reserved" || current.state === target) return current;
  if (TERMINAL.includes(current.state)) {
    throw new ApnError("APN_STATE_CORRUPT", "The Solana x402 usage hold reached a different outcome than its operation.");
  }
  const move = async (state: Exclude<AssetUsageState, "reserved">) => await ledger.transition({ ...identity, reservationId: current!.reservationId,
    policyDigest: current!.policyDigest, state, now, ...(TERMINAL.includes(state) ? { outcomeDigest: domainHash("apn.x402-solana-usage-outcome.v1",
      canonicalJson({ operationId: record.operationId, state, evidence: record.integrityHash })) } : {}),
    ...(state === "failed_confirmed_revert" ? { consumedAtomic: "0" } : {}) });
  if (target === "submitted") return current.state === "reserved" ? await move("submitted") : current;
  if (target === "failed_confirmed_revert" && current.state === "reserved") current = await move("submitted");
  if (target === "released_unsubmitted" && current.state === "submitted") current = await move("unknown_finality");
  return await move(target);
}
