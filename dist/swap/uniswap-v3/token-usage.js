import { canonicalJson, domainHash } from "../../canonical.js";
import { assertRecipientAdmitted } from "../../allowlist-recipient-pins.js";
import { evaluateAssetPolicy } from "../../asset-policy-registry.js";
import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../asset-usage-ledger.js";
import { ApnError } from "../../errors.js";
import { assetAdmitsSwapMechanism } from "../route-admission.js";
import { evaluateSwapAssetAdmission, swapOwnerAdmissionRequired, swapPolicyStatusCommand, swapReservationRefusal } from "../owner-admission.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "./token-route.js";
export class UniswapTokenUsage {
    state;
    clock;
    ledger;
    constructor(state, clock, ledger) {
        this.state = state;
        this.clock = clock;
        this.ledger = ledger;
    }
    async admitQuote(request, now) {
        const active = await this.active(request.profile, request.account), identity = usageIdentity(request.account, request.sourceToken);
        const current = await this.ledger.usage(identity, now), at = now.toISOString();
        // A token the active policy does not list, admit for the swap rail or admit with this route refuses as
        // swap_owner_admission_required and names the token, like the other guarded swap lanes at prepare; a cap names the cap.
        const subject = (side, token) => tokenSubject(request.profile, side, token);
        const source = evaluateSwapAssetAdmission(active.registry, subject("source", request.sourceToken), { amountAtomic: request.amountAtomic, dailyUsageAtomic: current.amountAtomic }, at);
        const destination = evaluateSwapAssetAdmission(active.registry, subject("destination", request.outputToken), { amountAtomic: request.minimumOutputAtomic, dailyUsageAtomic: "0" }, at);
        for (const [side, token, admission] of [["source", request.sourceToken, source], ["destination", request.outputToken, destination]]) {
            if (!assetAdmitsSwapMechanism(admission.asset, UNISWAP_TOKEN_MECHANISM_PIN))
                throw swapOwnerAdmissionRequired(subject(side, token), "swap_route_not_admitted");
        }
        assertRecipientAdmitted({ admission: source, recipient: request.recipient });
        assertRecipientAdmitted({ admission: destination, recipient: request.recipient });
        return active.digest;
    }
    async reserve(op) {
        const active = await this.active(op.profile, op.account);
        if (active.digest !== op.policyDigest)
            blocked("The active token swap policy changed.", "uniswap_token_policy_changed");
        pinned(active.registry, op.route, this.clock.now());
        const now = this.clock.now(), idempotencyKey = usageKey(op.operationId);
        let lease;
        try {
            lease = await this.ledger.reserve({ ...identityOf(op), registry: active.registry, rail: "swap", amountAtomic: op.route.amountIn, idempotencyKey, now });
        }
        catch (error) {
            // The shared daily usage decides at approval: a cap the reservation exceeds is named, nothing else changes.
            throw await swapReservationRefusal(error, this.ledger, { policy: active.registry, subject: tokenSubject(op.profile, "source", op.route.inputToken),
                account: op.account, amountAtomic: op.route.amountIn, idempotencyKey, now });
        }
        this.assert(op, lease.reservationId, lease.policyDigest, lease.amountAtomic, lease.rail);
        return { reservationId: lease.reservationId, state: lease.state };
    }
    async confirmMaterial(material) {
        const active = await this.active(material.profile, material.account), now = this.clock.now(), identity = usageIdentity(material.account, material.route.inputToken);
        if (active.digest !== material.policyDigest)
            blocked("The active token swap policy changed.", "uniswap_token_policy_changed");
        const current = await this.ledger.usage(identity, now);
        // At prepare today's usage may have grown since the quote: a cap the input now exceeds is named.
        evaluateSwapAssetAdmission(active.registry, tokenSubject(material.profile, "source", material.route.inputToken), { amountAtomic: material.route.amountIn, dailyUsageAtomic: current.amountAtomic }, now.toISOString());
        pinned(active.registry, material.route, now);
    }
    async confirmReserved(op) {
        const active = await this.active(op.profile, op.account), now = this.clock.now(), identity = identityOf(op), current = await this.ledger.usage(identity, now);
        if (active.digest !== op.policyDigest || BigInt(current.amountAtomic) < BigInt(op.route.amountIn))
            blocked("Token swap usage or policy changed.", "uniswap_token_policy_changed");
        evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "swap", amountAtomic: op.route.amountIn,
            dailyUsageAtomic: (BigInt(current.amountAtomic) - BigInt(op.route.amountIn)).toString(), asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        // Before each signature (approval, swap), never before the cleanup that only revokes the allowance.
        pinned(active.registry, op.route, now);
    }
    async confirmCleanup(op) {
        await this.current(op);
    }
    async current(op) {
        const expected = assetUsageReservationId(identityOf(op), usageKey(op.operationId)), lease = await this.ledger.load(identityOf(op), expected);
        if (lease === null)
            corrupt("Uniswap token usage reservation is missing.");
        this.assert(op, lease.reservationId, lease.policyDigest, lease.amountAtomic, lease.rail);
        return { reservationId: lease.reservationId, state: lease.state };
    }
    async follow(op, target) {
        const identity = identityOf(op), expected = assetUsageReservationId(identity, usageKey(op.operationId));
        let current = await this.ledger.load(identity, expected);
        if (current === null)
            corrupt("Uniswap token usage reservation is missing.");
        this.assert(op, current.reservationId, current.policyDigest, current.amountAtomic, current.rail);
        if (current.state === target || target === "submitted" && current.state === "unknown_finality")
            return { reservationId: expected, state: current.state };
        if (["finalized", "failed_before_effect", "failed_confirmed_revert", "released_unsubmitted"].includes(current.state))
            corrupt("Uniswap token usage reached a conflicting terminal state.");
        const move = async (state, terminal = false) => {
            current = await this.ledger.transition({ ...identity, reservationId: expected, policyDigest: op.policyDigest, state, now: this.clock.now(),
                ...(terminal ? { outcomeDigest: domainHash("apn.uniswap-token-usage-outcome.v1", canonicalJson({ operationId: op.operationId,
                        state, transactionHash: op.swapAttempt?.transactionHash ?? op.approvalAttempt?.transactionHash ?? null })) } : {}) });
        };
        if (target === "unknown_finality") {
            if (current.state === "reserved")
                await move("submitted");
            if (current.state === "submitted")
                await move(target);
        }
        else if (target === "failed_confirmed_revert") {
            if (current.state === "reserved")
                await move("submitted");
            await move(target, true);
        }
        // A swap proven never to land (R4): its hold is released as unsubmitted, nothing of it was spent. A hold a crash left
        // reserved after the swap was bound releases directly (the ledger allows both).
        else if (target === "released_unsubmitted") {
            if (op.swapAttempt?.transactionHash == null)
                corrupt("Uniswap token usage can release as unsubmitted only a bound swap.");
            if (current.state === "submitted")
                await move("unknown_finality");
            await move(target, true);
        }
        else if (target === "failed_before_effect") {
            // No principal effect: nothing of the swap was signed or bound, or a cleaned or owner-abandoned swap carries the
            // proof that none can land.
            const proven = op.phase === "cleaned" && (op.cleanupEvidence?.kind === "expired_approval_no_swap" || op.principalRelease !== undefined) ||
                op.phase === "abandoned_unknown" && op.principalRelease !== undefined;
            if (current.state !== "reserved" || !proven && (op.swapAttempt !== null || op.approvalAttempt?.transactionHash != null))
                corrupt("Uniswap token usage cannot release after a possible principal effect.");
            await move(target, true);
        }
        else {
            if (target === "finalized" && current.state === "reserved")
                await move("submitted");
            await move(target, target === "finalized");
        }
        return { reservationId: expected, state: current.state };
    }
    async active(profile, account) {
        const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, profile);
        if (active === null || active.accounts.evm !== account)
            throw new ApnError("APN_OPERATION_BLOCKED", "An active owner token swap policy is required.", { reason: "swap_owner_admission_required", nextActions: [swapPolicyStatusCommand(profile)] });
        return active;
    }
    assert(op, id, policy, amount, rail) {
        if (id !== assetUsageReservationId(identityOf(op), usageKey(op.operationId)) || policy !== op.policyDigest || amount !== op.route.amountIn || rail !== "swap") {
            corrupt("Uniswap token usage binding changed.");
        }
    }
}
/**
 * The recipient pin (OD-1) of both swap rows, the spent and the received asset's, still lists the route's recipient.
 * Only the pins are the point here (the callers check the spent asset's caps against its usage), so usage is zero.
 */
function pinned(registry, route, now) {
    for (const [token, amountAtomic] of [[route.inputToken, route.amountIn], [route.outputToken, route.amountOutMinimum]]) {
        const admission = evaluateAssetPolicy(registry, { chain: "eip155:1", asset: { kind: "token", identifier: token }, rail: "swap",
            amountAtomic, dailyUsageAtomic: "0", asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        assertRecipientAdmitted({ admission, recipient: route.recipient });
    }
}
function tokenSubject(profile, side, token) {
    return { profile, side, inventory: "apn swap ethereum uniswap-token inventory", asset: { chain: "eip155:1", kind: "token", identifier: token } };
}
function usageIdentity(account, token) { return { account, chain: "eip155:1", asset: { kind: "token", identifier: token } }; }
function identityOf(op) { return usageIdentity(op.account, op.route.inputToken); }
function usageKey(operationId) { return `apn.uniswap-token-usage:${operationId}`; }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-usage.js.map