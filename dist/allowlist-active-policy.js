import { ApnError } from "./errors.js";
import { AllowlistPolicyStore, stagedRecordAccounts, } from "./allowlist-policy-store.js";
export async function loadActiveAssetPolicyRegistry(source, profile, now) {
    const at = typeof source === "string" ? now : source.clock.now();
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
        throw new ApnError("APN_INVALID_INPUT", "An exact instant is required to load the active allowlist policy.", { reason: "invalid_time" });
    }
    const state = await new AllowlistPolicyStore(typeof source === "string" ? source : source.state.root).read(profile);
    return activeAssetPolicyFromState(state, at);
}
/** Decode an authenticated state already read while the caller holds the profile lock. */
export function activeAssetPolicyFromState(state, at) {
    const active = activeAllowlistPolicy(state);
    if (active === null)
        return null;
    const { entry, record } = active;
    if (record.registry.expiresAt !== undefined && at.toISOString() >= record.registry.expiresAt) {
        throw new ApnError("APN_OPERATION_BLOCKED", "The active allowlist policy has expired; stage and activate a new revision.", { reason: "allowlist_policy_expired" });
    }
    return { profile: state.profile, registry: structuredClone(record.registry), digest: record.registry.policyDigest,
        revision: record.revision, accounts: stagedRecordAccounts(record), activationDigest: entry.entryDigest, activatedAt: entry.decidedAt };
}
/** The chain head when it is an activation. The store has already bound it to its staged record. */
export function activeAllowlistPolicy(state) {
    const entry = state.entries.at(-1);
    if (entry === undefined || entry.status !== "active")
        return null;
    const record = state.records.find((candidate) => candidate.revision === entry.revision);
    if (record === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "The active allowlist revision is missing.");
    return { entry, record };
}
//# sourceMappingURL=allowlist-active-policy.js.map