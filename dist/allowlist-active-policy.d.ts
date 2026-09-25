import { type AllowlistPolicyActivationEntry, type AllowlistPolicyState, type StagedAllowlistPolicyRecord } from "./allowlist-policy-store.js";
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
    readonly state: {
        readonly root: string;
    };
    readonly clock: ClockPort;
}
/**
 * Load the profile's ACTIVE allowlist registry. Returns null when nothing is active (never activated or revoked).
 * Every staged revision and the whole activation chain are authenticated first; tamper fails closed with
 * APN_STATE_CORRUPT and an expired activation fails closed with APN_OPERATION_BLOCKED.
 */
export declare function loadActiveAssetPolicyRegistry(context: ActiveAssetPolicyContext, profile: string): Promise<ActiveAssetPolicy | null>;
export declare function loadActiveAssetPolicyRegistry(stateRoot: string, profile: string, now: Date): Promise<ActiveAssetPolicy | null>;
/** Decode an authenticated state already read while the caller holds the profile lock. */
export declare function activeAssetPolicyFromState(state: AllowlistPolicyState, at: Date): ActiveAssetPolicy | null;
/** The chain head when it is an activation. The store has already bound it to its staged record. */
export declare function activeAllowlistPolicy(state: AllowlistPolicyState): {
    readonly entry: AllowlistPolicyActivationEntry;
    readonly record: StagedAllowlistPolicyRecord;
} | null;
