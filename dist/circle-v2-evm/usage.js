import { assertHeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import { consumeHistoricalPaidClosure } from "./historical-paid-closure.js";
import { consumeCleanup85Settlement } from "./cleanup85-settlement-authority.js";
import { validateCleanup85RecoveryProof } from "./cleanup85-recovery-proof.js";
import { Cleanup85RecoveryStore } from "./cleanup85-recovery-store.js";
import { CircleRepository } from "./repository.js";
import { CircleExternalStore } from "./external-store.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { activeAssetPolicyFromState } from "../allowlist-active-policy.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, validateAssetUsageReservation } from "../asset-usage-ledger.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { CIRCLE_SOURCE_TOKEN, circleRoute } from "./catalog.js";
import { circleBlocked, circleCorrupt } from "./operation-model.js";
export const circleMechanism = (chain) => ({ provider: "circle-cctp-v2", reference: `circle-v2-evm-fast-42161-${chain}.v1` });
function leases(op) {
    const source = op.sourceCustody.walletAddress, destination = op.destinationCustody.walletAddress;
    return [{ key: "usdc", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "token", identifier: CIRCLE_SOURCE_TOKEN } }, amount: "40100" },
        { key: "approval-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "30000000000000" },
        { key: "burn-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "30000000000000" },
        { key: "cleanup-native", profile: op.profile, identity: { account: source, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, amount: "15000000000000" },
        { key: "mint-native", profile: op.destinationProfile, identity: { account: destination, chain: `eip155:${op.destinationChain}`, asset: { kind: "native", identifier: null } }, amount: circleRoute(op.destinationChain, op.destinationProfile).destinationNativeCap }];
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
    /** Finite cleanup scope only: the private wrapper already owns every policy lock. */
    async withCleanup85HeldPolicyScope(held, request, operationId, action) {
        if (this.policyScope.getStore() !== undefined)
            circleBlocked("policy_lock_scope_reentry");
        const guard = () => assertHeldCleanup85Scope(held, this.state, request, operationId);
        guard();
        const scope = { profiles: new Set(["evm-live-buyer", "evm-live-seller", "default"]), active: true, guard };
        return this.policyScope.run(scope, async () => { try {
            return await action();
        }
        finally {
            scope.active = false;
        } });
    }
    async active(profile, account) {
        const scope = this.policyScope.getStore();
        if (scope?.active !== true || !scope.profiles.has(profile))
            circleBlocked("owner_policy_lock_required");
        scope.guard?.();
        const stored = await this.policiesStore.readUnderProfileLock(profile);
        scope.guard?.();
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
            const admission = evaluateAssetPolicy(active.registry, { chain: lease.identity.chain, asset: lease.identity.asset, rail: "bridge", mechanism: circleMechanism(op.destinationChain), amountAtomic: lease.amount,
                dailyUsageAtomic: current.amountAtomic, asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
            if (!bridgeMechanismAdmitted(admission, circleMechanism(op.destinationChain)))
                circleBlocked("exact_circle_mechanism_admission_required");
            const policy = { profile: lease.profile, profileHash: this.state.profileHash(lease.profile), policyDigest: active.digest, revision: active.revision, activationDigest: active.activationDigest };
            if (!result.some(row => row.profileHash === policy.profileHash))
                result.push(policy);
        }
        return result;
    }
    /** Capture new cleanup authority without reserving or counting historical holds twice. */
    async retirementPolicies(op) {
        const result = [];
        for (const profile of [op.profile, op.destinationProfile]) {
            const account = profile === op.profile ? op.sourceCustody.walletAddress : op.destinationCustody.walletAddress;
            const active = await this.active(profile, account);
            result.push({ profile, profileHash: this.state.profileHash(profile), policyDigest: active.digest, revision: active.revision, activationDigest: active.activationDigest });
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
            const admission = evaluateAssetPolicy(active.registry, { chain: lease.identity.chain, asset: lease.identity.asset, rail: "bridge", mechanism: circleMechanism(op.destinationChain),
                amountAtomic: lease.amount, dailyUsageAtomic: other.toString(), asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
            if (!bridgeMechanismAdmitted(admission, circleMechanism(op.destinationChain)))
                circleBlocked("exact_circle_mechanism_admission_required");
        }
    }
    async reserve(op) {
        const result = [];
        for (const lease of leases(op)) {
            const active = await this.active(lease.profile, lease.identity.account), frozen = op.policies.find(p => p.profile === lease.profile);
            if (frozen === undefined || frozen.activationDigest === undefined || active.activationDigest !== frozen.activationDigest || active.digest !== frozen.policyDigest || active.revision !== frozen.revision)
                circleBlocked("reserve_policy_changed");
            const reservation = await this.ledger.reserve({ ...lease.identity, registry: active.registry, rail: "bridge", mechanism: circleMechanism(op.destinationChain), amountAtomic: lease.amount,
                idempotencyKey: `circle-v2-evm.v1:${op.operationId}:${lease.key}`, now: new Date(this.now()) });
            if (reservation.state !== "reserved")
                circleBlocked("reserve_replay_already_exposed");
            result.push(reservation);
        }
        return result;
    }
    /** Finite historical completion consumes fresh private source+destination provenance before ledger access. */
    async closeHistoricalPaid(op, authority) {
        const bound = await consumeHistoricalPaidClosure(authority, this.state, op), frame = bound.closure;
        const rows = [];
        for (const planned of frame.outcomes) {
            const row = planned.reservation, current = await this.ledger.load(row, row.reservationId);
            if (current === null)
                circleBlocked("historical_paid_ledger_missing");
            for (const key of ["schemaVersion", "reservationId", "idempotencyHash", "policyDigest", "registryVersion", "rail", "amountAtomic", "account", "chain", "reservedAt"])
                if (current[key] !== row[key])
                    circleBlocked("historical_paid_ledger_binding");
            if (canonicalJson(current.asset) !== canonicalJson(row.asset))
                circleBlocked("historical_paid_ledger_binding");
            if (current.state === planned.state) {
                if (current.outcomeDigest !== planned.outcomeDigest || (current.consumedAtomic ?? null) !== planned.consumedAtomic)
                    circleBlocked("historical_paid_ledger_outcome");
            }
            else if (bound.operation.terminal || !["reserved", "submitted", "unknown_finality"].includes(current.state))
                circleBlocked("historical_paid_ledger_state");
            rows.push(current);
        }
        const result = [];
        for (const [index, planned] of frame.outcomes.entries()) {
            if (rows[index].state === planned.state) {
                result.push(rows[index]);
                continue;
            }
            const row = planned.reservation;
            result.push(await this.ledger.transition({ account: row.account, chain: row.chain, asset: row.asset, reservationId: row.reservationId, policyDigest: row.policyDigest, state: planned.state, now: new Date(this.now()), outcomeDigest: planned.outcomeDigest, ...(planned.consumedAtomic === null ? {} : { consumedAtomic: planned.consumedAtomic }), expectedCurrentStates: ["reserved", "submitted", "unknown_finality"] }));
        }
        return result;
    }
    async followExternalFulfillment(op) {
        if (op.externalFulfillment === undefined || op.source?.finalityTag !== "finalized" || op.residualAllowanceAtomic !== "0" || op.usage.length !== 5)
            circleBlocked("external_settlement_proof_required");
        const durable = await new CircleRepository(this.state.root).load(op.operationId), claim = await new CircleExternalStore(this.state.root).readClaim(op);
        if (durable?.externalFulfillment === undefined || claim === null || hashObject(durable.externalFulfillment) !== hashObject(op.externalFulfillment) || hashObject(claim) !== hashObject(op.externalFulfillment))
            circleBlocked("external_durable_settlement_binding");
        const result = [];
        for (const [index, row] of op.usage.entries()) {
            const current = await this.ledger.load(row, row.reservationId);
            if (current === null)
                circleCorrupt("external_usage_missing");
            const state = index < 3 ? "finalized" : "released_unsubmitted";
            const outcomeDigest = hashObject({ kind: "circle_external_mint_fulfillment", operationId: op.operationId, fingerprint: op.fingerprint, proofHash: op.externalFulfillment.proofHash, reservationId: row.reservationId, index, state });
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
    /** Only a fully verified versioned recovery chooses the new86 fee; old cleanup85 stays unknown. */
    async closeCleanup85Recovery(op, proof, authority) {
        const bound = await consumeCleanup85Settlement(authority, this.state, op, proof);
        op = bound.operation;
        proof = bound.proof;
        validateCleanup85RecoveryProof(proof, op);
        if (op.usage.length !== 5)
            circleBlocked("cleanup85_usage_missing");
        const durable = await new Cleanup85RecoveryStore(this.state.root).publicRecord(op, proof.cleanup85Recovery.mode === "observed_original" ? "observed-original-proof" : "cleanup86-finalized-proof");
        if (durable === null || canonicalJson(durable) !== canonicalJson(proof))
            circleBlocked("cleanup85_durable_settlement_proof_required");
        const result = [];
        for (const [index, row] of op.usage.entries()) {
            const saved = await this.ledger.load(row, row.reservationId);
            if (saved === null || saved.policyDigest !== row.policyDigest || saved.amountAtomic !== row.amountAtomic)
                circleBlocked("cleanup85_usage_hold_changed");
            const consumedAtomic = index === 1 ? "1116903336000" : index === 3 ? proof.actualCleanupFeeAtomic : "0", outcomeDigest = hashObject({ version: "apn.circle-cleanup85-retirement-usage.v1", proofHash: proof.proofHash, operationId: op.operationId, reservationId: row.reservationId, index });
            if (saved.state === "failed_confirmed_revert") {
                if (saved.consumedAtomic !== consumedAtomic || saved.outcomeDigest !== outcomeDigest)
                    circleBlocked("cleanup85_usage_outcome_changed");
                result.push(saved);
                continue;
            }
            result.push(await this.ledger.transition({ account: row.account, chain: row.chain, asset: row.asset, reservationId: row.reservationId, policyDigest: row.policyDigest, state: "failed_confirmed_revert", consumedAtomic, outcomeDigest, now: new Date(this.now()), expectedCurrentStates: ["reserved", "submitted", "unknown_finality"] }));
        }
        return result;
    }
    async follow(op, target) {
        let rows = op.usage;
        if (target === "failed_before_effect" && rows.length === 0) {
            const existing = [];
            for (const lease of leases(op)) {
                const saved = await this.ledger.load(lease.identity, assetUsageReservationId(lease.identity, `circle-v2-evm.v1:${op.operationId}:${lease.key}`));
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