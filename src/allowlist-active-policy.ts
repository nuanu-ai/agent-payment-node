import { ApnError } from "./errors.js";
import {
  AllowlistPolicyStore,
  stagedRecordAccounts,
  type AllowlistPolicyActivationEntry,
  type AllowlistPolicyState,
  type StagedAllowlistPolicyRecord,
} from "./allowlist-policy-store.js";
import type { AllowlistPolicyAccounts } from "./allowlist-policy-v2.js";
import type { AssetPolicyRegistry } from "./asset-policy-registry.js";
import type { ClockPort } from "./ports.js";

/** The owner-activated registry a money rail may evaluate, bound to its exact revision and activation entry. */
export interface ActiveAssetPolicy {
  readonly profile: string;
  readonly registry: AssetPolicyRegistry;
  /** The sealed registry policy digest; rails bind their operation journals to it. */
  readonly digest: string;
  readonly revision: number;
  readonly accounts: AllowlistPolicyAccounts;
  readonly activationDigest: string;
  readonly activatedAt: string;
}

export interface ActiveAssetPolicyContext {
  readonly state: { readonly root: string };
  readonly clock: ClockPort;
}

/**
 * Load the profile's ACTIVE allowlist registry. Returns null when nothing is active (never activated or revoked).
 * Every staged revision and the whole activation chain are authenticated first; tamper fails closed with
 * APN_STATE_CORRUPT and an expired activation fails closed with APN_OPERATION_BLOCKED.
 */
export async function loadActiveAssetPolicyRegistry(context: ActiveAssetPolicyContext, profile: string): Promise<ActiveAssetPolicy | null>;
export async function loadActiveAssetPolicyRegistry(stateRoot: string, profile: string, now: Date): Promise<ActiveAssetPolicy | null>;
export async function loadActiveAssetPolicyRegistry(
  source: ActiveAssetPolicyContext | string,
  profile: string,
  now?: Date,
): Promise<ActiveAssetPolicy | null> {
  const at = typeof source === "string" ? now : source.clock.now();
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new ApnError("APN_INVALID_INPUT", "An exact instant is required to load the active allowlist policy.", { reason: "invalid_time" });
  }
  const state = await new AllowlistPolicyStore(typeof source === "string" ? source : source.state.root).read(profile);
  return activeAssetPolicyFromState(state, at);
}

/** Decode an authenticated state already read while the caller holds the profile lock. */
export function activeAssetPolicyFromState(state: AllowlistPolicyState, at: Date): ActiveAssetPolicy | null {
  const active = activeAllowlistPolicy(state);
  if (active === null) return null;
  const { entry, record } = active;
  if (record.registry.expiresAt !== undefined && at.toISOString() >= record.registry.expiresAt) {
    throw new ApnError("APN_OPERATION_BLOCKED", "The active allowlist policy has expired; stage and activate a new revision.",
      { reason: "allowlist_policy_expired" });
  }
  return { profile: state.profile, registry: structuredClone(record.registry), digest: record.registry.policyDigest,
    revision: record.revision, accounts: stagedRecordAccounts(record), activationDigest: entry.entryDigest, activatedAt: entry.decidedAt };
}

/** The chain head when it is an activation. The store has already bound it to its staged record. */
export function activeAllowlistPolicy(state: AllowlistPolicyState): {
  readonly entry: AllowlistPolicyActivationEntry; readonly record: StagedAllowlistPolicyRecord;
} | null {
  const entry = state.entries.at(-1);
  if (entry === undefined || entry.status !== "active") return null;
  const record = state.records.find((candidate) => candidate.revision === entry.revision);
  if (record === undefined) throw new ApnError("APN_STATE_CORRUPT", "The active allowlist revision is missing.");
  return { entry, record };
}
