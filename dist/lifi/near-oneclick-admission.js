/** Owner allowlist admission and the shared usage hold of one NEAR 1Click source deposit. */
import { getAddress } from "viem";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { assertRecipientAdmitted } from "../allowlist-recipient-pins.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { oneClickRecordLane } from "./near-oneclick-source-journal.js";
import { bridgeFailure } from "./validation.js";
/** One exact bridge mechanism per lane: an owner admits each lane on its own, with its own cap and recipient pin. */
export function oneClickMechanism(lane) {
    return Object.freeze({ provider: "near-1click", reference: `${lane.id}.v1` });
}
/** The payer's origin asset: Base USDC on the Base lane, Ethereum ETH on the Ethereum lanes. */
export function oneClickUsageIdentity(lane, payer) {
    const token = lane.origin.token;
    if ((lane.origin.kind === "native") !== (token === null))
        bridgeFailure("APN_INTERNAL", "oneclick_lane_origin_asset");
    const asset = token === null ? { kind: "native", identifier: null } : { kind: "token", identifier: getAddress(token) };
    return { account: getAddress(payer), chain: `eip155:${lane.origin.chainId}`, asset };
}
const usageKey = (operationId) => `oneclick-source:${operationId}`;
function refused(reason, details = {}) {
    return bridgeFailure("APN_ALLOWLIST_REFUSED", `oneclick_source_${reason}`, details);
}
/** The deposit principal is held against the payer's origin-asset bridge caps from before signing until its outcome. */
export class OneClickSourceAdmission {
    state;
    profile;
    amountAtomic;
    operationId;
    recipient;
    now;
    ledger;
    identity;
    mechanism;
    policyDigest = null;
    /** `recipient` is the TRON or Solana destination recipient; an owner recipient pin must list it (OD-1). */
    constructor(state, profile, lane, payer, amountAtomic, operationId, recipient, now) {
        this.state = state;
        this.profile = profile;
        this.amountAtomic = amountAtomic;
        this.operationId = operationId;
        this.recipient = recipient;
        this.now = now;
        this.ledger = new AssetUsageLedger(state.root);
        this.identity = oneClickUsageIdentity(lane, payer);
        this.mechanism = oneClickMechanism(lane);
    }
    async active() {
        const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: this.now } }, this.profile);
        if (active === null || active.accounts.evm === undefined || getAddress(active.accounts.evm) !== this.identity.account) {
            refused("active_owner_policy_required");
        }
        return active;
    }
    /** Read-only, before the quote: policy account, the origin asset's bridge rail, this lane's mechanism, caps and pin. */
    async admit() {
        await this.evaluate(await this.active(), (await this.ledger.usage(this.identity, this.now())).amountAtomic);
    }
    async evaluate(active, dailyUsageAtomic) {
        const at = this.now();
        let admission;
        try {
            admission = evaluateAssetPolicy(active.registry, { chain: this.identity.chain, asset: this.identity.asset, rail: "bridge",
                mechanism: this.mechanism, amountAtomic: this.amountAtomic, dailyUsageAtomic, asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
        }
        catch (error) {
            // Asset, rail or lane not admitted, a cap, or the policy window: one reason, with the evaluator's own words as the cause.
            if (error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED")
                refused("policy_refused", { cause: error.message });
            throw error;
        }
        if (!bridgeMechanismAdmitted(admission, this.mechanism))
            refused("mechanism_not_admitted");
        assertRecipientAdmitted({ admission, mechanism: this.mechanism, recipient: this.recipient });
    }
    /** After consent and before signing: the active policy and its pin again; the ledger checks the caps atomically. */
    async reserve() {
        const active = await this.active();
        await this.evaluate(active, "0");
        const reservation = await this.ledger.reserve({ ...this.identity, registry: active.registry, rail: "bridge", mechanism: this.mechanism,
            amountAtomic: this.amountAtomic, idempotencyKey: usageKey(this.operationId), now: this.now() });
        if (reservation.state !== "reserved")
            refused("usage_hold_unavailable");
        this.policyDigest = reservation.policyDigest;
    }
    /** The seal's guard, run under the record lock: the hold this run took is still held, so status has not released it. */
    async assertHeld() {
        const hold = await this.ledger.load(this.identity, assetUsageReservationId(this.identity, usageKey(this.operationId)));
        if (this.policyDigest === null || hold?.state !== "reserved" || hold.policyDigest !== this.policyDigest)
            refused("usage_hold_not_held");
    }
    /** Nothing was sealed, so the signature never left this process: the hold is released without counting. */
    async releaseBeforeEffect() {
        if (this.policyDigest === null)
            return;
        await this.ledger.transition({ ...this.identity, reservationId: assetUsageReservationId(this.identity, usageKey(this.operationId)),
            policyDigest: this.policyDigest, state: "failed_before_effect", expectedCurrentStates: ["reserved"], now: this.now(),
            outcomeDigest: hashObject({ kind: "oneclick_source_unsealed", operationId: this.operationId }) });
    }
}
const OPEN = ["reserved", "submitted", "unknown_finality"];
/**
 * The ledger path a journal phase proves, from each open hold state. An unsigned or sealed record proves nothing yet (an
 * unsigned one past its deadline is released by `releaseUnsignedOneClickUsage`); a sent one is `submitted`, an
 * ambiguous one `unknown_finality`; a safe receipt finalizes the spend or confirms the revert; a source proven never to
 * land releases it.
 */
function path(record, from) {
    switch (record.phase) {
        case "submitting":
        case "unknown_finality": return from === "unknown_finality" ? [] : ["unknown_finality"];
        case "submitted_pending": return from === "reserved" ? ["submitted"] : [];
        case "source_observed":
            if (record.sourceReceiptStatus === "success")
                return ["finalized"];
            return from === "reserved" ? ["submitted", "failed_confirmed_revert"] : ["failed_confirmed_revert"];
        case "failed_proven_superseded": return from === "submitted" ? ["unknown_finality", "released_unsubmitted"] : ["released_unsubmitted"];
        default: return [];
    }
}
/**
 * Brings this operation's hold to the state its journal proves, idempotently. Records written before 1Click held usage
 * have no hold and are left alone; a hold whose principal is not this deposit's is never touched.
 */
export async function settleOneClickUsage(root, record, now) {
    const identity = oneClickUsageIdentity(oneClickRecordLane(record), record.payer), ledger = new AssetUsageLedger(root);
    const reservationId = assetUsageReservationId(identity, usageKey(record.operationId));
    const outcomeDigest = hashObject({ kind: "oneclick_source_outcome", operationId: record.operationId, phase: record.phase,
        receiptHash: record.sourceReceiptHash, finalizedNonceAtomic: record.finalizedNonceAtomic ?? null });
    // One step per pass from a fresh read: a concurrent submit or status that moved the hold first only shortens the path.
    for (let pass = 0;; pass++) {
        const hold = await ledger.load(identity, reservationId);
        if (hold === null)
            return null;
        const step = OPEN.includes(hold.state) && hold.amountAtomic === record.amountInAtomic ? path(record, hold.state)[0] : undefined;
        if (step === undefined)
            return { reservationId, state: hold.state, amountAtomic: hold.amountAtomic };
        try {
            await ledger.transition({ ...identity, reservationId, policyDigest: hold.policyDigest, state: step, expectedCurrentStates: [hold.state],
                now, ...(OPEN.includes(step) ? {} : { outcomeDigest }) });
        }
        catch (error) {
            const moved = await ledger.load(identity, reservationId);
            if (pass >= 4 || moved === null || moved.state === hold.state)
                throw error;
        }
    }
}
/** An unsigned record past its effective deadline can never be sealed (the journal refuses it): its hold is released. */
export async function releaseUnsignedOneClickUsage(root, record, now) {
    const identity = oneClickUsageIdentity(oneClickRecordLane(record), record.payer), ledger = new AssetUsageLedger(root);
    const reservationId = assetUsageReservationId(identity, usageKey(record.operationId));
    const hold = await ledger.load(identity, reservationId);
    if (hold === null || hold.state !== "reserved" || hold.amountAtomic !== record.amountInAtomic)
        return;
    await ledger.transition({ ...identity, reservationId, policyDigest: hold.policyDigest, state: "failed_before_effect",
        expectedCurrentStates: ["reserved"], now, outcomeDigest: hashObject({ kind: "oneclick_source_unsealed", operationId: record.operationId }) });
}
//# sourceMappingURL=near-oneclick-admission.js.map