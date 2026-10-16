import { canonicalJson, domainHash } from "./canonical.js";
import { loadActiveAssetPolicyRegistry } from "./allowlist-active-policy.js";
import { ASSET_POLICY_REGISTRY_SCHEMA_V2 } from "./asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "./asset-usage-ledger.js";
import { ApnError } from "./errors.js";
const OUTCOME_DOMAIN = "apn.rail-usage-outcome.v1";
/** One reservation per operation and rail: a replayed approval can never reserve twice. */
export function railUsageKey(rail, operationId) { return `apn.rail-usage:${rail}:${operationId}`; }
/**
 * The shared cap hook for rails that do not yet bind an allowlist revision at prepare (local x402 first).
 * `reserveBeforeEffect` runs after every pre-check and before any signature or provider call: the owner's active
 * policy must admit this account, asset, rail and mechanism, and today's shared asset usage plus this amount must
 * fit the per-operation and daily caps. The owning journal then calls `follow` after each durable transition.
 */
export class RailUsageGate {
    context;
    ledger;
    constructor(context) {
        this.context = context;
        this.ledger = new AssetUsageLedger(context.state.root);
    }
    async reserveBeforeEffect(subject) {
        const existing = await this.reservation(subject);
        if (existing !== null) {
            if (existing.state !== "reserved")
                blocked("The usage reservation of this operation already crossed a durable transition.");
            return existing;
        }
        const active = await this.active(subject), now = this.context.clock.now();
        const caps = admittedCaps(active, subject, now);
        const usage = BigInt((await this.ledger.usage(identity(subject), now)).amountAtomic), amount = BigInt(subject.amountAtomic);
        if (amount > BigInt(caps.maximumPerTransferAtomic)) {
            refuse(subject, "allowlist_per_transfer_cap_exceeded", "The payment exceeds the owner's per-operation cap for this asset and rail.", { maximum_per_transfer_atomic: caps.maximumPerTransferAtomic, amount_atomic: subject.amountAtomic });
        }
        if (usage + amount > BigInt(caps.dailyLimitAtomic)) {
            refuse(subject, "allowlist_daily_cap_exceeded", "The payment exceeds the owner's daily cap for this asset given today's usage.", { daily_limit_atomic: caps.dailyLimitAtomic, daily_usage_atomic: usage.toString(), amount_atomic: subject.amountAtomic });
        }
        // The ledger re-evaluates the caps against the usage it reads under its bucket lock before it writes.
        const reservation = await this.ledger.reserve({ ...identity(subject), registry: active.registry, rail: subject.rail,
            amountAtomic: subject.amountAtomic, idempotencyKey: railUsageKey(subject.rail, subject.operationId), now });
        if (reservation.state !== "reserved")
            blocked("The usage reservation of this operation already crossed a durable transition.");
        return reservation;
    }
    /** Idempotent, so every resume can repair a lagging ledger. A missing reservation is corrupt unless nothing was spent. */
    async follow(subject, target, evidenceHash) {
        const current = await this.reservation(subject);
        if (current === null) {
            if (target === "failed_before_effect" || target === "released_unsubmitted")
                return;
            corrupt("The operation journal names a usage reservation that the ledger does not hold.");
        }
        if (current.state === target)
            return;
        if (["finalized", "failed_before_effect", "released_unsubmitted", "failed_confirmed_revert"].includes(current.state)) {
            corrupt("The usage reservation reached a different terminal state than its operation.");
        }
        const outcomeDigest = domainHash(OUTCOME_DOMAIN, canonicalJson({ rail: subject.rail, operationId: subject.operationId, state: target, evidenceHash }));
        const move = async (state, withOutcome) => await this.ledger.transition({ ...identity(subject),
            reservationId: current.reservationId, policyDigest: current.policyDigest, state, now: this.context.clock.now(),
            ...(withOutcome ? { outcomeDigest } : {}) });
        if (target === "submitted") {
            if (current.state === "reserved")
                await move("submitted", false);
            return;
        }
        if (target === "unknown_finality") {
            await move("unknown_finality", false);
            return;
        }
        if (target === "failed_before_effect" && current.state !== "reserved") {
            corrupt("A usage reservation past the effect boundary cannot be released before effect.");
        }
        if (target === "failed_confirmed_revert" && current.state === "reserved")
            await move("submitted", false);
        await move(target, true);
    }
    async reservation(subject) {
        const id = identity(subject);
        return await this.ledger.load(id, assetUsageReservationId(id, railUsageKey(subject.rail, subject.operationId)));
    }
    async active(subject) {
        let active;
        try {
            active = await loadActiveAssetPolicyRegistry(this.context, subject.profile);
        }
        catch (error) {
            if (error instanceof ApnError && error.details?.reason === "allowlist_policy_expired") {
                refuse(subject, "allowlist_policy_expired", "The active owner allowlist policy has expired; stage and activate a new revision.");
            }
            throw error;
        }
        if (active === null) {
            refuse(subject, "allowlist_policy_required", "Payments on this rail require an owner-activated allowlist policy for this profile.", { nextActions: [`apn allowlist policy status --profile ${subject.profile}`] });
        }
        if (active.accounts[subject.family] !== subject.account) {
            refuse(subject, "allowlist_account_mismatch", "The active owner allowlist policy names a different owner account for this network family.", { account: subject.account });
        }
        return active;
    }
}
function admittedCaps(active, subject, now) {
    const registry = active.registry, at = now.toISOString();
    if (registry.expiresAt !== undefined && at >= registry.expiresAt) {
        refuse(subject, "allowlist_policy_expired", "The active owner allowlist policy has expired; stage and activate a new revision.");
    }
    if (registry.effectiveAt !== undefined && at < registry.effectiveAt) {
        refuse(subject, "allowlist_policy_not_effective", "The active owner allowlist policy is not effective yet.", { effective_at: registry.effectiveAt });
    }
    const row = registry.chains.find((chain) => chain.chain === subject.chain)?.assets
        .find((asset) => asset.kind === subject.asset.kind && asset.identifier === subject.asset.identifier);
    const caps = row === undefined || !row.rails[subject.rail] ? undefined
        : registry.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? row.railCaps?.[subject.rail] : row.caps;
    const pin = row?.mechanismPins?.[subject.rail];
    if (caps === undefined || pin?.provider !== subject.mechanism.provider || pin.reference !== subject.mechanism.reference) {
        refuse(subject, "allowlist_rail_not_admitted", "The active owner allowlist policy does not admit this asset on this rail and mechanism.", { chain: subject.chain, asset: subject.asset.identifier ?? "native", provider: subject.mechanism.provider, reference: subject.mechanism.reference });
    }
    return caps;
}
function identity(value) {
    return { account: value.account, chain: value.chain, asset: value.asset.kind === "native"
            ? { kind: "native", identifier: null } : { kind: "token", identifier: value.asset.identifier } };
}
function refuse(subject, reason, message, details = {}) {
    throw new ApnError("APN_ALLOWLIST_REFUSED", message, { reason, rail: subject.rail, ...details });
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=rail-usage-gate.js.map