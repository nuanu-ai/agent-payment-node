import { isPlainRecord } from "./canonical.js";
import { SOLANA_GENESIS } from "./chain-policy.js";
import { requireListedDirectAsset, validateDirectAllowlistBinding, validateDirectAllowlistLease } from "./direct-allowlist-gate.js";
import { ApnError } from "./errors.js";
import { TRON_GENESIS } from "./tron/constants.js";
/** The transitions at which a rail crosses into signing or a provider send; the usage lease is written with the first one. */
export const RAIL_LEASE_STATES = ["signing_started", "submitting"];
export function railAllowlistChain(rail) {
    return rail === "solana" ? `solana:${SOLANA_GENESIS}` : `tron:${TRON_GENESIS}`;
}
/** The TRON and Solana aliases are resolved against the frozen list before any account, RPC or custody call. */
export function requireListedRailAsset(asset) {
    requireListedDirectAsset(railAllowlistChain(asset.rail), railUsageAsset(asset));
}
export function railAllowlistSubject(input) {
    return { profile: input.profile, operationId: input.operationId, family: input.account.rail, account: input.account.address,
        chain: railAllowlistChain(input.account.rail), asset: railUsageAsset(input.prepared.asset), amountAtomic: input.prepared.amountAtomic };
}
/** Optional on records written before the gate; once bound, the lease is mandatory from the first signing or send transition. */
export function validateRailAllowlist(value, subject) {
    const crossed = Array.isArray(value.transitions) &&
        value.transitions.some((entry) => isPlainRecord(entry) && RAIL_LEASE_STATES.includes(entry.state));
    if (value.allowlist === undefined) {
        if (value.allowlistLease !== undefined)
            corrupt();
        return;
    }
    const binding = validateDirectAllowlistBinding(value.allowlist);
    if (value.allowlistLease === undefined) {
        if (crossed)
            corrupt();
        return;
    }
    if (!crossed)
        corrupt();
    validateDirectAllowlistLease(value.allowlistLease, binding, subject);
}
/** Signed bytes that were never sent stay reserved (they may still fail before effect); a send is charged until proven. */
export function railUsageTarget(state) {
    switch (state) {
        case "awaiting_approval":
        case "signing_started":
        case "signed_not_submitted": return "reserved";
        case "submitting":
        case "submitted_pending": return "submitted";
        case "unknown_finality":
        case "abandoned_unknown": return "unknown_finality";
        case "completed": return "finalized";
        case "failed_before_effect": return "failed_before_effect";
        case "failed_confirmed_revert": return "failed_confirmed_revert";
        default: return corrupt();
    }
}
function railUsageAsset(asset) {
    return asset.kind === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: asset.identifier };
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail allowlist binding is inconsistent with the operation."); }
//# sourceMappingURL=rail-direct-allowlist.js.map