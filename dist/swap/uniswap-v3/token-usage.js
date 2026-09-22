import { canonicalJson, domainHash } from "../../canonical.js";
import { evaluateAssetPolicy } from "../../asset-policy-registry.js";
import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../asset-usage-ledger.js";
import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
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
        const current = await this.ledger.usage(identity, now);
        const source = evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "swap", amountAtomic: request.amountAtomic,
            dailyUsageAtomic: current.amountAtomic, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        const destination = evaluateAssetPolicy(active.registry, { chain: "eip155:1", asset: { kind: "token", identifier: request.outputToken },
            rail: "swap", amountAtomic: request.minimumOutputAtomic, dailyUsageAtomic: "0",
            asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
        const mechanism = swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN);
        if (source.asset.mechanismPins?.swap === undefined || destination.asset.mechanismPins?.swap === undefined ||
            swapMechanismDigest(source.asset.mechanismPins.swap) !== mechanism || swapMechanismDigest(destination.asset.mechanismPins.swap) !== mechanism) {
            blocked("Token pair lacks the exact Uniswap mechanism admission.", "uniswap_token_policy_mechanism");
        }
        return active.digest;
    }
    async reserve(op) {
        const active = await this.active(op.profile, op.account);
        if (active.digest !== op.policyDigest)
            blocked("The active token swap policy changed.", "uniswap_token_policy_changed");
        const lease = await this.ledger.reserve({ ...identityOf(op), registry: active.registry, rail: "swap", amountAtomic: op.route.amountIn,
            idempotencyKey: usageKey(op.operationId), now: this.clock.now() });
        this.assert(op, lease.reservationId, lease.policyDigest, lease.amountAtomic, lease.rail);
        return { reservationId: lease.reservationId, state: lease.state };
    }
    async confirmMaterial(material) {
        const active = await this.active(material.profile, material.account), now = this.clock.now(), identity = usageIdentity(material.account, material.route.inputToken);
        if (active.digest !== material.policyDigest)
            blocked("The active token swap policy changed.", "uniswap_token_policy_changed");
        const current = await this.ledger.usage(identity, now);
        evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "swap", amountAtomic: material.route.amountIn,
            dailyUsageAtomic: current.amountAtomic, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    }
    async confirmReserved(op) {
        const active = await this.active(op.profile, op.account), now = this.clock.now(), identity = identityOf(op), current = await this.ledger.usage(identity, now);
        if (active.digest !== op.policyDigest || BigInt(current.amountAtomic) < BigInt(op.route.amountIn))
            blocked("Token swap usage or policy changed.", "uniswap_token_policy_changed");
        evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "swap", amountAtomic: op.route.amountIn,
            dailyUsageAtomic: (BigInt(current.amountAtomic) - BigInt(op.route.amountIn)).toString(), asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    }
    async confirmCleanup(op) {
        const active = await this.active(op.profile, op.account), now = this.clock.now();
        if (active.digest !== op.policyDigest)
            blocked("The active token swap policy changed.", "uniswap_token_policy_changed");
        await this.current(op);
        await this.ledger.usage(identityOf(op), now);
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
        if (["finalized", "failed_before_effect", "failed_confirmed_revert"].includes(current.state))
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
        else if (target === "failed_before_effect") {
            if (current.state !== "reserved")
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
            blocked("An active owner token swap policy is required.", "swap_owner_admission_required");
        return active;
    }
    assert(op, id, policy, amount, rail) {
        if (id !== assetUsageReservationId(identityOf(op), usageKey(op.operationId)) || policy !== op.policyDigest || amount !== op.route.amountIn || rail !== "swap") {
            corrupt("Uniswap token usage binding changed.");
        }
    }
}
function usageIdentity(account, token) { return { account, chain: "eip155:1", asset: { kind: "token", identifier: token } }; }
function identityOf(op) { return usageIdentity(op.account, op.route.inputToken); }
function usageKey(operationId) { return `apn.uniswap-token-usage:${operationId}`; }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-usage.js.map