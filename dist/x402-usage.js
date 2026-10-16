import { getAddress } from "viem";
import { canonicalJson, domainHash } from "./canonical.js";
import { AssetUsageLedger, assetUsageReservationId } from "./asset-usage-ledger.js";
/** The profile x402 policy, not an allowlist registry, governs local x402; its version names that source. */
const PROFILE_POLICY_SOURCE = "profile-x402-policy.v1";
const OUTCOME_DOMAIN = "apn.rail-usage-outcome.v1";
/** Persisted reservation key; stored holds are found by it, so it never changes. One operation holds one x402 reservation. */
export function x402UsageKey(operationId) { return `apn.rail-usage:x402:${operationId}`; }
/**
 * Local x402 spend in the shared asset-usage ledger. The reservation is made before anything is signed, under the
 * frozen per-request cap of the profile x402 policy, and then follows the operation journal forward. The profile x402
 * policy has no daily cap, so none is applied here; the reservation makes x402 spend count in the shared daily usage
 * that every capped rail on the same account and asset reads.
 */
export class X402Usage {
    context;
    ledger;
    constructor(context) {
        this.context = context;
        this.ledger = new AssetUsageLedger(context.state.root);
    }
    async reserve(operation) {
        return await this.ledger.reserveWithinOwnerCap({
            ...identity(operation), rail: "x402", amountAtomic: operation.amountAtomic, maximumAtomic: operation.capAtomic,
            policyDigest: policyDigest(operation), registryVersion: PROFILE_POLICY_SOURCE, idempotencyKey: x402UsageKey(operation.operationId),
            now: this.context.clock.now(),
        });
    }
    /** Idempotent; every approve, resume and abandon repairs a lagging ledger. Operations approved before this ledger have none. */
    async follow(operation) {
        const id = identity(operation);
        let current = await this.ledger.load(id, assetUsageReservationId(id, x402UsageKey(operation.operationId)));
        const target = TARGET[operation.state];
        if (current === null || target === null || current.state === target || rank(current.state) >= rank(target))
            return;
        const move = async (state) => await this.ledger.transition({
            ...id, reservationId: current.reservationId, policyDigest: current.policyDigest, state, now: this.context.clock.now(),
            ...(rank(state) === 3 ? { outcomeDigest: outcome(operation, state) } : {}),
        });
        // The ledger allows released_unsubmitted only from reserved or unknown_finality.
        if (target === "released_unsubmitted" && current.state === "submitted")
            current = await move("unknown_finality");
        await move(target);
    }
}
/** Where each journal state leaves the hold. A signed but never exposed authorization stays reserved. */
const TARGET = {
    awaiting_approval: null, authorization_material_pending: null, authorized_not_sent: null,
    paid_request_pending: "submitted", settlement_pending: "unknown_finality", effect_unknown: "unknown_finality",
    seller_result_recovery_pending: "finalized", completed: "finalized", failed_settled_without_result: "finalized",
    failed_before_effect: "failed_before_effect", failed_expired_unused: "released_unsubmitted",
    // The owner acknowledged an unknown outcome: the amount is charged as spent on the day of abandonment.
    abandoned_unknown: "finalized",
};
function rank(state) {
    return state === "reserved" ? 0 : state === "submitted" ? 1 : state === "unknown_finality" ? 2 : 3;
}
function identity(operation) {
    return { account: getAddress(operation.wallet), chain: operation.network, asset: { kind: "token", identifier: getAddress(operation.token) } };
}
function policyDigest(operation) {
    return domainHash("apn.x402-usage-policy.v1", canonicalJson({ profileHash: operation.profileHash, network: operation.network, capAtomic: operation.capAtomic }));
}
function outcome(operation, state) {
    return domainHash(OUTCOME_DOMAIN, canonicalJson({ rail: "x402", operationId: operation.operationId, state, evidenceHash: operation.integrityHash }));
}
//# sourceMappingURL=x402-usage.js.map