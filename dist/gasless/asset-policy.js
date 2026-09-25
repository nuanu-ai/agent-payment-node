import { canonicalJson } from "../canonical.js";
import { activeAssetPolicyFromState } from "../allowlist-active-policy.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { gaslessDeployment } from "./registry.js";
import { gaslessFailure } from "./validation.js";
export const BASE_GASLESS_CHAIN = "eip155:8453";
/** The reference is the canonical Base Circle USDC paymaster, never a caller-supplied URL or alias. */
export function baseLocalGaslessMechanism() {
    return { provider: "local",
        reference: `${BASE_GASLESS_CHAIN}:${gaslessDeployment(8453).paymaster}` };
}
const identity = (intent) => ({
    account: intent.owner.address, chain: BASE_GASLESS_CHAIN,
    asset: { kind: "token", identifier: gaslessDeployment(8453).token },
});
const at = (now) => new Date(now);
const refused = (reason) => gaslessFailure("APN_ALLOWLIST_REFUSED", reason);
const corrupt = () => gaslessFailure("APN_STATE_CORRUPT", "gasless_allowlist_binding");
/** Called only while the common profile lock is held. Ledger bucket locks are nested after it. */
export class GaslessAssetPolicy {
    state;
    now;
    store;
    usage;
    constructor(state, now) {
        this.state = state;
        this.now = now;
        this.store = new AllowlistPolicyStore(state.root);
        this.usage = new AssetUsageLedger(state.root);
    }
    async active(profile) {
        const active = activeAssetPolicyFromState(await this.store.readUnderProfileLock(profile), at(this.now()));
        if (active === null)
            return refused("gasless_allowlist_required");
        return active;
    }
    admit(active, intent, dailyUsageAtomic) {
        const deployment = gaslessDeployment(8453), pin = baseLocalGaslessMechanism();
        if (active.profile !== intent.profile || active.accounts.evm !== intent.owner.address ||
            active.digest !== active.registry.policyDigest || intent.request.chainId !== 8453 || intent.token !== deployment.token) {
            refused("gasless_allowlist_identity");
        }
        const date = at(this.now()).toISOString();
        const admission = evaluateAssetPolicy(active.registry, { chain: BASE_GASLESS_CHAIN,
            asset: { kind: "token", identifier: deployment.token }, rail: "gasless",
            amountAtomic: intent.request.grossAtomic, dailyUsageAtomic,
            asOfDate: date.slice(0, 10), asOf: date });
        const pinned = admission.asset.mechanismPins?.gasless;
        if (admission.asset.decimals !== 6 || pinned === undefined || canonicalJson(pinned) !== canonicalJson(pin)) {
            refused("gasless_allowlist_mechanism");
        }
    }
    async prepare(intent, operationId) {
        const active = await this.active(intent.profile);
        const account = identity(intent), usage = await this.usage.usage(account, at(this.now()));
        this.admit(active, intent, usage.amountAtomic);
        return { policyDigest: active.digest, policyRevision: active.revision,
            activationDigest: active.activationDigest, chain: BASE_GASLESS_CHAIN,
            token: gaslessDeployment(8453).token, mechanism: baseLocalGaslessMechanism(),
            reservationId: assetUsageReservationId(account, operationId) };
    }
    /** Recheck the owner activation and caps before every first signature, disclosure and dispatch. */
    async assert(op, requireReservation) {
        if (op.intent.request.chainId !== 8453)
            return;
        const bound = op.intent.allowlist;
        if (bound === undefined)
            return refused("gasless_legacy_observation_only");
        this.assertBinding(op);
        const active = await this.active(op.intent.profile);
        if (active.digest !== bound.policyDigest || active.revision !== bound.policyRevision ||
            active.activationDigest !== bound.activationDigest)
            refused("gasless_allowlist_changed");
        const { snapshot, reservation } = await this.usage.usageWithReservation(identity(op.intent), bound.reservationId, at(this.now()));
        if (requireReservation && (reservation === null || reservation.state !== "reserved")) {
            refused("gasless_usage_reservation_missing");
        }
        const own = reservation === null ? 0n : this.checkedReservation(op, reservation);
        if (own !== 0n && reservation.reservedAt.slice(0, 10) !== snapshot.windowStart.slice(0, 10)) {
            refused("gasless_usage_window_changed");
        }
        const other = BigInt(snapshot.amountAtomic) - own;
        if (other < 0n)
            corrupt();
        this.admit(active, op.intent, other.toString());
    }
    async reserve(op) {
        if (op.intent.request.chainId !== 8453)
            return;
        await this.assert(op, false);
        const bound = op.intent.allowlist;
        const active = await this.active(op.intent.profile);
        if (active.digest !== bound.policyDigest || active.revision !== bound.policyRevision ||
            active.activationDigest !== bound.activationDigest)
            refused("gasless_allowlist_changed");
        const lease = await this.usage.reserve({ ...identity(op.intent), registry: active.registry,
            rail: "gasless", mechanism: bound.mechanism, amountAtomic: op.intent.request.grossAtomic,
            idempotencyKey: op.operationId, now: at(this.now()) });
        this.checkedReservation(op, lease);
        if (lease.state !== "reserved")
            refused("gasless_usage_reservation_closed");
        await this.assert(op, true);
    }
    /** A saved operation is authoritative; a crash between journal and ledger writes is repaired on the next read. */
    async reconcile(op) {
        if (op.intent.request.chainId !== 8453 || op.intent.allowlist === undefined)
            return;
        this.assertBinding(op);
        const bound = op.intent.allowlist, account = identity(op.intent);
        const lease = await this.usage.load(account, bound.reservationId);
        if (lease === null) {
            if (op.bootstrap.signingAttempts !== 0 || op.userOperation.signingAttempts !== 0)
                corrupt();
            return;
        }
        if (lease.state === "failed_before_effect" || lease.state === "failed_confirmed_revert" ||
            lease.state === "released_unsubmitted") {
            const expected = lease.state === "released_unsubmitted"
                ? op.state === "failed_permissions_invalidated" && op.userOperation.submissionAttempts === 0
                : lease.state === op.state;
            if (!expected || lease.outcomeDigest !== op.integrityHash ||
                (lease.state === "failed_confirmed_revert" &&
                    lease.consumedAtomic !== op.settlement?.accounting.feeAtomic))
                corrupt();
            return;
        }
        this.checkedReservation(op, lease);
        if (lease.state === "submitted" && op.userOperation.submissionAttempts === 0)
            corrupt();
        if (lease.state === "unknown_finality" && op.userOperation.submissionAttempts === 0 &&
            op.bootstrap.disclosureAttempts === 0)
            corrupt();
        let target = null;
        if (op.state === "failed_before_effect")
            target = "failed_before_effect";
        else if (op.state === "failed_confirmed_revert")
            target = "failed_confirmed_revert";
        else if (op.state === "failed_permissions_invalidated" && op.userOperation.submissionAttempts === 0) {
            target = "released_unsubmitted";
        }
        else if (op.state === "completed")
            target = "finalized";
        else if (op.userOperation.submissionAttempts === 1)
            target = op.state === "unknown_finality" || op.state === "abandoned_unknown"
                ? "unknown_finality" : "submitted";
        else if ((op.state === "unknown_finality" || op.state === "abandoned_unknown") &&
            op.bootstrap.disclosureAttempts === 1)
            target = "unknown_finality";
        if (lease.state === "finalized") {
            if (target !== "finalized" || lease.outcomeDigest !== op.integrityHash)
                corrupt();
            return;
        }
        if (target === null || lease.state === target)
            return;
        if (target === "submitted" && lease.state === "unknown_finality")
            return;
        if (target === "failed_before_effect" && lease.state !== "reserved")
            corrupt();
        await this.usage.transition({ ...account, reservationId: bound.reservationId, policyDigest: bound.policyDigest,
            state: target, now: at(this.now()),
            ...(target === "failed_confirmed_revert" ? { consumedAtomic: op.settlement.accounting.feeAtomic } : {}),
            ...(target === "failed_before_effect" || target === "released_unsubmitted" ||
                target === "failed_confirmed_revert" || target === "finalized"
                ? { outcomeDigest: op.integrityHash } : {}) });
    }
    assertBinding(op) {
        const bound = op.intent.allowlist;
        if (bound === undefined || bound.chain !== BASE_GASLESS_CHAIN || bound.token !== gaslessDeployment(8453).token ||
            canonicalJson(bound.mechanism) !== canonicalJson(baseLocalGaslessMechanism()) ||
            bound.reservationId !== assetUsageReservationId(identity(op.intent), op.operationId))
            corrupt();
    }
    checkedReservation(op, lease) {
        const bound = op.intent.allowlist;
        if (lease.reservationId !== bound.reservationId || lease.policyDigest !== bound.policyDigest ||
            lease.rail !== "gasless" || lease.amountAtomic !== op.intent.request.grossAtomic ||
            canonicalJson({ account: lease.account, chain: lease.chain, asset: lease.asset }) !== canonicalJson(identity(op.intent)) ||
            lease.state === "failed_before_effect" || lease.state === "released_unsubmitted" ||
            lease.state === "failed_confirmed_revert")
            corrupt();
        return BigInt(lease.amountAtomic);
    }
}
//# sourceMappingURL=asset-policy.js.map