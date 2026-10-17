import { CircleFundingExternalStore } from "./funding-external-store.js";
import { validateCircleFundingBinding } from "./funding-binding.js";
import { CircleRepository } from "./repository.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { activeAssetPolicyFromState } from "../allowlist-active-policy.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { assertRecipientAdmitted } from "../allowlist-recipient-pins.js";
import { AssetUsageLedger, assetUsageReservationId, validateAssetUsageReservation } from "../asset-usage-ledger.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { CIRCLE_SOURCE_TOKEN, circleRoute } from "./catalog.js";
import { circleBlocked, circleCorrupt } from "./operation-model.js";
// Only funding-v2 operations execute; v1 journals are read-only and never reach usage admission or settlement.
const ordinaryMechanism = (op) => validateCircleFundingBinding(op.funding).mechanism;
/** The burned USDC is the asset that reaches the beneficiary; the native holds only pay the signers' own gas. */
const beneficiary = (op) => validateCircleFundingBinding(op.funding).recipient;
/** OD-1: an owner recipient pin on the source USDC bridge admission must list the beneficiary. */
function assertBeneficiaryAdmitted(op, lease, admission) {
    if (lease.key === "usdc")
        assertRecipientAdmitted({ admission, mechanism: ordinaryMechanism(op), recipient: beneficiary(op) });
}
const ordinaryNamespace = "circle-v2-evm.v2";
function leases(op) {
    const source = op.sourceCustody.walletAddress, destination = op.destinationCustody.walletAddress;
    return [{ key: "usdc", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "token", identifier: CIRCLE_SOURCE_TOKEN } }, amount: validateCircleFundingBinding(op.funding).amountAtomic },
        { key: "approval-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "30000000000000" },
        { key: "burn-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "30000000000000" },
        { key: "cleanup-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "15000000000000" },
        { key: "mint-native", profile: op.destinationProfile, identity: { account: destination, chain: `eip155:${op.destinationChain}`, asset: { kind: "native", identifier: null } }, amount: circleRoute(op.destinationChain).destinationNativeCap }];
}
export class CircleUsage {
    state;
    now;
    ledger;
    policiesStore;
    policyScope = new AsyncLocalStorage();
    constructor(state, now) {
        this.state = state;
        this.now = now;
        this.ledger = new AssetUsageLedger(state.root);
        this.policiesStore = new AllowlistPolicyStore(state.root);
    }
    /** Wallet/operation/address locks are outermost; policy locks are held through every effect. */
    async withPolicyLocks(profiles, action) {
        if (this.policyScope.getStore() !== undefined)
            circleBlocked("policy_lock_scope_reentry");
        const canonical = [...new Set(profiles)].sort(), keys = canonical.map(p => `profile:${allowlistProfileHash(p)}`).sort();
        return this.state.withLocks(keys, () => {
            const scope = { profiles: new Set(canonical), active: true };
            return this.policyScope.run(scope, async () => { try {
                return await action();
            }
            finally {
                scope.active = false;
            } });
        });
    }
    async active(profile, account) {
        const scope = this.policyScope.getStore();
        if (scope?.active !== true || !scope.profiles.has(profile))
            circleBlocked("owner_policy_lock_required");
        const stored = await this.policiesStore.readUnderProfileLock(profile);
        if (!scope.active)
            circleBlocked("owner_policy_lock_required");
        const active = activeAssetPolicyFromState(stored, new Date(this.now()));
        if (active === null || active.accounts.evm !== account)
            circleBlocked("active_owner_asset_policy_required");
        return active;
    }
    async policies(op) {
        const result = [];
        for (const lease of leases(op)) {
            const active = await this.active(lease.profile, lease.identity.account), at = new Date(this.now()), current = await this.ledger.usageReadOnly(lease.identity, at);
            const admission = evaluateAssetPolicy(active.registry, { chain: lease.identity.chain, asset: lease.identity.asset, rail: "bridge", mechanism: ordinaryMechanism(op), amountAtomic: lease.amount,
                dailyUsageAtomic: current.amountAtomic, asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
            if (!bridgeMechanismAdmitted(admission, ordinaryMechanism(op)))
                circleBlocked("exact_circle_mechanism_admission_required");
            assertBeneficiaryAdmitted(op, lease, admission);
            const policy = { profile: lease.profile, profileHash: this.state.profileHash(lease.profile), policyDigest: active.digest, revision: active.revision, activationDigest: active.activationDigest };
            if (!result.some(row => row.profileHash === policy.profileHash))
                result.push(policy);
        }
        return result;
    }
    /** Readonly authority window from both exact owner activations while their locks remain held. */
    async authorizationDeadline(op, policies = op.policies) {
        let end = Infinity;
        for (const profile of new Set([op.profile, op.destinationProfile])) {
            const frozen = policies.find(p => p.profile === profile), account = profile === op.profile ? op.sourceCustody.walletAddress : op.destinationCustody.walletAddress;
            const active = await this.active(profile, account), at = this.now();
            if (frozen?.activationDigest === undefined || active.activationDigest !== frozen.activationDigest || active.digest !== frozen.policyDigest || active.revision !== frozen.revision)
                circleBlocked("owner_policy_changed");
            if (new Date(at).toISOString().slice(0, 10) < active.registry.effectiveDate || active.registry.effectiveAt !== undefined && at < Date.parse(active.registry.effectiveAt))
                circleBlocked("owner_policy_not_effective");
            if (active.registry.expiresAt !== undefined)
                end = Math.min(end, Date.parse(active.registry.expiresAt));
        }
        if (this.now() >= end)
            circleBlocked("owner_policy_window_expired");
        return end === Infinity ? null : new Date(end).toISOString();
    }
    async confirm(op, policies = op.policies) {
        for (const policy of policies) {
            const account = policy.profile === op.profile ? op.sourceCustody.walletAddress : op.destinationCustody.walletAddress;
            const active = await this.active(policy.profile, account);
            if (policy.activationDigest === undefined || active.activationDigest !== policy.activationDigest || active.digest !== policy.policyDigest || active.revision !== policy.revision)
                circleBlocked("owner_policy_changed");
        }
        if (op.usage.length !== 5)
            circleBlocked("all_asset_usage_reserves_required");
        for (const [index, row] of op.usage.entries()) {
            validateAssetUsageReservation(row);
            const saved = await this.ledger.load(row, row.reservationId);
            if (saved === null || saved.policyDigest !== row.policyDigest || saved.amountAtomic !== row.amountAtomic || saved.account !== row.account || saved.chain !== row.chain ||
                ["failed_before_effect", "failed_confirmed_revert", "released_unsubmitted", "finalized"].includes(saved.state))
                circleBlocked("asset_usage_hold_changed");
            const lease = leases(op)[index], active = await this.active(lease.profile, lease.identity.account), at = new Date(this.now());
            const current = await this.ledger.usageReadOnly(lease.identity, at), other = BigInt(current.amountAtomic) - BigInt(saved.amountAtomic);
            if (other < 0n)
                circleCorrupt("usage_total_below_hold");
            const admission = evaluateAssetPolicy(active.registry, { chain: lease.identity.chain, asset: lease.identity.asset, rail: "bridge", mechanism: ordinaryMechanism(op),
                amountAtomic: lease.amount, dailyUsageAtomic: other.toString(), asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
            if (!bridgeMechanismAdmitted(admission, ordinaryMechanism(op)))
                circleBlocked("exact_circle_mechanism_admission_required");
            assertBeneficiaryAdmitted(op, lease, admission);
        }
    }
    async reserve(op) {
        const result = [];
        for (const lease of leases(op)) {
            const active = await this.active(lease.profile, lease.identity.account), frozen = op.policies.find(p => p.profile === lease.profile);
            if (frozen === undefined || frozen.activationDigest === undefined || active.activationDigest !== frozen.activationDigest || active.digest !== frozen.policyDigest || active.revision !== frozen.revision)
                circleBlocked("reserve_policy_changed");
            if (lease.key === "usdc") {
                // The recipient pin of the admission row; the ledger reservation below checks the caps (a replayed hold is not counted twice).
                const at = new Date(this.now());
                assertBeneficiaryAdmitted(op, lease, evaluateAssetPolicy(active.registry, { chain: lease.identity.chain, asset: lease.identity.asset, rail: "bridge", mechanism: ordinaryMechanism(op),
                    amountAtomic: lease.amount, dailyUsageAtomic: "0", asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() }));
            }
            const reservation = await this.ledger.reserve({ ...lease.identity, registry: active.registry, rail: "bridge", mechanism: ordinaryMechanism(op), amountAtomic: lease.amount,
                idempotencyKey: `${ordinaryNamespace}:${op.operationId}:${lease.key}`, now: new Date(this.now()) });
            if (reservation.state !== "reserved")
                circleBlocked("reserve_replay_already_exposed");
            result.push(reservation);
        }
        return result;
    }
    /** V2 explicit public settlement: source caps remain USED; owned never-entered effects consume zero. */
    async followFundingExternalFulfillment(op) {
        if (op.externalFulfillment === undefined || op.source?.finalityTag !== "finalized" || op.residualAllowanceAtomic !== "0" || op.usage.length !== 5)
            circleBlocked("external_settlement_proof_required");
        const durable = await new CircleRepository(this.state.root).loadAny(op.operationId), claim = await new CircleFundingExternalStore(this.state.root).readClaim(op);
        if (durable?.schemaVersion !== "apn.circle-v2-evm-operation.v2" || durable.externalFulfillment === undefined || claim === null || hashObject(durable.externalFulfillment) !== hashObject(op.externalFulfillment) || hashObject(claim) !== hashObject(op.externalFulfillment))
            circleBlocked("external_durable_settlement_binding");
        const result = [];
        for (const [index, row] of op.usage.entries()) {
            const current = await this.ledger.load(row, row.reservationId);
            if (current === null)
                circleCorrupt("external_usage_missing");
            for (const key of ["schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "rail", "amountAtomic", "account", "chain", "reservedAt"])
                if (current[key] !== row[key])
                    circleBlocked("external_usage_binding");
            if (canonicalJson(current.asset) !== canonicalJson(row.asset))
                circleBlocked("external_usage_binding");
            const state = index < 3 ? "finalized" : "released_unsubmitted";
            const outcomeDigest = hashObject({ kind: "circle_funding_external_mint_fulfillment", operationId: op.operationId, fingerprint: op.fingerprint, proofHash: op.externalFulfillment.proofHash, reservationId: row.reservationId, index, state });
            if (index < 3 && current.state === "finalized" && canonicalJson(current) === canonicalJson(row)) {
                result.push(current);
                continue;
            }
            if (current.state === state) {
                if (current.outcomeDigest !== outcomeDigest || current.consumedAtomic !== undefined)
                    circleBlocked("external_usage_outcome_changed");
                result.push(current);
                continue;
            }
            result.push(await this.ledger.transition({ account: row.account, chain: row.chain, asset: row.asset, reservationId: row.reservationId, policyDigest: row.policyDigest, state, now: new Date(this.now()), outcomeDigest, expectedCurrentStates: index < 3 ? ["reserved", "submitted", "unknown_finality"] : ["reserved", "unknown_finality"] }));
        }
        return result;
    }
    async follow(op, target) {
        let rows = op.usage;
        if (target === "failed_before_effect" && rows.length === 0) {
            const existing = [];
            for (const lease of leases(op)) {
                const saved = await this.ledger.load(lease.identity, assetUsageReservationId(lease.identity, `${ordinaryNamespace}:${op.operationId}:${lease.key}`));
                if (saved === null)
                    break;
                const policy = op.policies.find(p => p.profile === lease.profile);
                if (saved.policyDigest !== policy?.policyDigest || saved.amountAtomic !== lease.amount || !["reserved", "failed_before_effect"].includes(saved.state))
                    circleBlocked("unsubmitted_reserve_exposed_or_drifted");
                existing.push(saved);
            }
            rows = existing;
        }
        if (target !== "failed_before_effect" && rows.length !== 5)
            circleCorrupt("usage_missing");
        const result = [];
        for (const [index, row] of rows.entries()) {
            const current = await this.ledger.load(row, row.reservationId);
            if (current === null)
                circleCorrupt("usage_missing");
            const actualTarget = target === "finalized" && index === 3 ? "failed_confirmed_revert" : target;
            if (current.state === actualTarget) {
                result.push(current);
                continue;
            }
            const isTerminal = actualTarget !== "unknown_finality";
            let consumed;
            if (actualTarget === "failed_confirmed_revert") {
                consumed = index === 1 ? op.effects.find(e => e.role === "approval")?.proof?.actualFeeAtomic ?? "0" : index === 2 ? op.effects.find(e => e.role === "burn")?.proof?.actualFeeAtomic ?? "0" : index === 3 ? op.effects.find(e => e.role === "cleanup")?.proof?.actualFeeAtomic ?? "0" : "0";
            }
            // Finalized reserves intentionally charge the owner's full approved caps; receipt retains exact native cost.
            const outcomeDigest = hashObject({ operationId: op.operationId, target, source: op.source?.sourceMessageHash ?? null, destination: op.destination?.transactionHash ?? null,
                cleanup: op.effects.find(e => e.role === "cleanup")?.transactionHash ?? null, reservation: row.reservationId });
            result.push(await this.ledger.transition({ account: row.account, chain: row.chain, asset: row.asset, reservationId: row.reservationId, policyDigest: row.policyDigest,
                state: actualTarget, now: new Date(this.now()), ...(target === "failed_before_effect" ? { expectedCurrentStates: ["reserved", "failed_before_effect"] } : {}), ...(isTerminal ? { outcomeDigest } : {}), ...(consumed === undefined ? {} : { consumedAtomic: consumed }) }));
        }
        return result;
    }
}
//# sourceMappingURL=usage.js.map