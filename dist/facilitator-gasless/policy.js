import { getAddress } from "viem";
import { canonicalJson } from "../canonical.js";
import { activeAssetPolicyFromState } from "../allowlist-active-policy.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { facilitatorFail } from "./failure.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
/** The owner's allowlist pins this exact relaying route: PayAI's public x402 facilitator on Avalanche C-Chain. */
export const FACILITATOR_GASLESS_MECHANISM = Object.freeze({
    provider: "payai-x402-facilitator", reference: `${R.network}:${R.facilitatorOrigin}`,
});
const TOKEN = getAddress(R.token);
function identity(intent) {
    return { account: intent.owner.address, chain: R.network, asset: { kind: "token", identifier: TOKEN } };
}
const key = (operationId) => `facilitator-gasless:${operationId}`;
const at = (now) => new Date(now);
const refused = (reason) => facilitatorFail(reason);
const corrupt = () => facilitatorFail("facilitator_gasless_state_corrupt");
/** The saved binding is checked only against its own operation (rule R2); the current pin is compared before effects. */
export function validateFacilitatorAllowlist(op) {
    const bound = op.intent.allowlist;
    if (bound === undefined || bound.reservationId !== assetUsageReservationId(identity(op.intent), key(op.operationId)))
        corrupt();
    return bound;
}
/**
 * Owner admission, caps and the shared asset-usage ledger for Avalanche facilitator transfers (rail `gasless`). Called
 * only while the operation's profile lock and the allowlist profile lock are held; ledger bucket locks nest inside.
 */
export class FacilitatorGaslessPolicy {
    now;
    store;
    usage;
    constructor(root, now) {
        this.now = now;
        this.store = new AllowlistPolicyStore(root);
        this.usage = new AssetUsageLedger(root);
    }
    async active(profile) {
        let active;
        try {
            active = activeAssetPolicyFromState(await this.store.readUnderProfileLock(profile), at(this.now()));
        }
        catch (error) {
            if (error instanceof ApnError && error.details?.reason === "allowlist_policy_expired")
                refused("facilitator_gasless_allowlist_required");
            throw error;
        }
        if (active === null)
            return refused("facilitator_gasless_allowlist_required");
        return active;
    }
    admit(active, intent, dailyUsageAtomic) {
        if (active.profile !== intent.profile || active.accounts.evm !== intent.owner.address ||
            active.digest !== active.registry.policyDigest)
            refused("facilitator_gasless_allowlist_refused");
        const date = at(this.now()).toISOString();
        let admission;
        try {
            admission = evaluateAssetPolicy(active.registry, { chain: R.network, asset: identity(intent).asset, rail: "gasless",
                amountAtomic: intent.request.grossAtomic, dailyUsageAtomic, asOfDate: date.slice(0, 10), asOf: date });
        }
        catch (error) {
            if (error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED")
                refused("facilitator_gasless_allowlist_refused");
            throw error;
        }
        const pinned = admission.asset.mechanismPins?.gasless;
        if (admission.asset.decimals !== R.decimals || pinned === undefined ||
            canonicalJson(pinned) !== canonicalJson(FACILITATOR_GASLESS_MECHANISM) ||
            (admission.asset.gaslessRecipient !== undefined && admission.asset.gaslessRecipient !== intent.request.recipient)) {
            refused("facilitator_gasless_allowlist_refused");
        }
    }
    async prepare(intent, operationId) {
        const active = await this.active(intent.profile), account = identity(intent);
        this.admit(active, intent, (await this.usage.usage(account, at(this.now()))).amountAtomic);
        return { policyDigest: active.digest, policyRevision: active.revision, activationDigest: active.activationDigest,
            mechanism: { ...FACILITATOR_GASLESS_MECHANISM }, reservationId: assetUsageReservationId(account, key(operationId)) };
    }
    /** Recheck the unchanged owner activation and caps; `requireReservation` before the authorization leaves APN. */
    async assert(op, requireReservation) {
        const bound = validateFacilitatorAllowlist(op);
        if (canonicalJson(bound.mechanism) !== canonicalJson(FACILITATOR_GASLESS_MECHANISM))
            refused("facilitator_gasless_allowlist_changed");
        const active = await this.active(op.intent.profile);
        if (active.digest !== bound.policyDigest || active.revision !== bound.policyRevision ||
            active.activationDigest !== bound.activationDigest)
            refused("facilitator_gasless_allowlist_changed");
        const { snapshot, reservation } = await this.usage.usageWithReservation(identity(op.intent), bound.reservationId, at(this.now()));
        if (reservation !== null)
            this.checked(op, reservation);
        if (requireReservation && reservation?.state !== "reserved")
            refused("facilitator_gasless_allowlist_changed");
        const own = reservation?.state === "reserved" ? BigInt(reservation.amountAtomic) : 0n;
        if (own !== 0n && reservation.reservedAt.slice(0, 10) !== snapshot.windowStart.slice(0, 10)) {
            refused("facilitator_gasless_allowlist_changed");
        }
        const other = BigInt(snapshot.amountAtomic) - own;
        if (other < 0n)
            corrupt();
        this.admit(active, op.intent, other.toString());
        return active;
    }
    /** Charges the exact gross before the owner signs; a replay returns the same reservation. */
    async reserve(op) {
        const active = await this.assert(op, false), bound = validateFacilitatorAllowlist(op);
        const lease = await this.usage.reserve({ ...identity(op.intent), registry: active.registry, rail: "gasless",
            mechanism: bound.mechanism, amountAtomic: op.intent.request.grossAtomic, idempotencyKey: key(op.operationId), now: at(this.now()) });
        this.checked(op, lease);
        if (lease.state !== "reserved")
            refused("facilitator_gasless_allowlist_changed");
        await this.assert(op, true);
    }
    /**
     * The saved operation is authoritative; a crash between the journal and the ledger is repaired on the next read.
     * Exposure keeps the full charge until finalized evidence proves delivery or an unused, expired authorization.
     */
    async reconcile(op) {
        if (op.intent.allowlist === undefined)
            return;
        const bound = validateFacilitatorAllowlist(op), account = identity(op.intent);
        const lease = await this.usage.load(account, bound.reservationId);
        if (lease === null) {
            if (op.signed !== null)
                corrupt();
            return;
        }
        this.checked(op, lease);
        const target = op.state === "failed_before_effect" ? "failed_before_effect"
            : op.state === "completed" ? "finalized"
                : op.state === "expired_unused" ? "released_unsubmitted"
                    : op.state === "verify_started" || op.state === "settle_started" || op.state === "settle_submitted" ||
                        op.state === "abandoned_unknown" ? "unknown_finality" : null;
        if (target === null || lease.state === target)
            return;
        if ((target === "failed_before_effect" || target === "unknown_finality") && lease.state !== "reserved")
            corrupt();
        if ((target === "finalized" || target === "released_unsubmitted") && lease.state !== "reserved" &&
            lease.state !== "unknown_finality")
            corrupt();
        await this.usage.transition({ ...account, reservationId: bound.reservationId, policyDigest: bound.policyDigest,
            state: target, now: at(this.now()), ...(target === "unknown_finality" ? {} : { outcomeDigest: op.integrityHash }) });
    }
    checked(op, lease) {
        const bound = validateFacilitatorAllowlist(op);
        if (lease.reservationId !== bound.reservationId || lease.policyDigest !== bound.policyDigest || lease.rail !== "gasless" ||
            lease.amountAtomic !== op.intent.request.grossAtomic ||
            canonicalJson({ account: lease.account, chain: lease.chain, asset: lease.asset }) !== canonicalJson(identity(op.intent)))
            corrupt();
    }
}
//# sourceMappingURL=policy.js.map