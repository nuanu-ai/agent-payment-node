import { canonicalJson, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import { effectiveX402Cap, policyBinding, requireProfilePolicy, } from "./profile-policy.js";
import { LOCAL_PROVIDER_ID } from "./provider-profile.js";
import { captureProviderEvidenceLowerBlock, observeProviderSettlement, providerX402ReadPort, } from "./provider-x402-evidence.js";
import { appendProviderX402Transition, providerX402BindingHash, providerX402RequestHash, publicProviderX402Operation, sealProviderX402Operation, sealProviderX402Receipt, } from "./provider-x402-model.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import { stagedProviderX402Operation } from "./provider-x402-stage.js";
import { isCode } from "./secure-state-store.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import { canonicalPrepareUrl, freshChallenge, positiveCap } from "./x402-policy.js";
import { assertProviderAtomicAmount, assertProviderPolicyBalance, sameFrozenProviderPolicy, sameFrozenProviderProfile, soleProviderOffer, } from "./provider-x402-policy.js";
import { waitForProviderSettlement } from "./provider-x402-wait.js";
import { boundedX402ReadPort } from "./x402-service-rpc.js";
import { assertFrozenProviderX402Policy, assertProviderX402RpcBinding, canonicalProviderX402RpcUrl, observeProviderX402Balance, requireProviderX402Adapter, requireProviderX402Profile, } from "./provider-x402-preconditions.js";
const SETTLEMENT_OBSERVATION_REASONS = new Set([
    "provider_evidence_capability_gap",
    "settlement_block_mismatch",
    "settlement_evidence_contradiction",
    "settlement_mismatch",
    "settlement_not_unique",
    "settlement_receipt_mismatch",
    "settlement_receipt_missing",
]);
const RETRYABLE_SETTLEMENT_OBSERVATION_REASONS = new Set([
    "provider_evidence_capability_gap",
    "settlement_receipt_missing",
]);
const EVIDENCE_WINDOW_MS = 240_000;
export class ProviderX402Service {
    context;
    repository;
    operations;
    constructor(context) {
        this.context = context;
        this.repository = context.providerX402Repository ?? new ProviderX402Repository(context.state.root);
        this.operations = new OperationService(context.state, this.repository);
    }
    async canHandle(profileInput) {
        if (this.context.profileRepository === undefined)
            return false;
        await this.context.ready();
        const profile = canonicalProfile(profileInput);
        const stored = await this.context.requireProfileRepository().load(this.context.state.profileHash(profile));
        return stored !== null && stored.provider_id !== LOCAL_PROVIDER_ID;
    }
    async prepare(request) {
        const profile = canonicalProfile(request.profile);
        const key = canonicalIdempotencyKey(request.idempotencyKey);
        const callerCap = request.maxAmountAtomic === undefined ? undefined : positiveCap(request.maxAmountAtomic);
        const endpoint = canonicalPrepareUrl(request.url);
        const canonicalUrl = endpoint.toString();
        const rpcUrl = canonicalProviderX402RpcUrl(this.context.requireRpcUrl());
        await this.context.ready();
        const state = this.context.state;
        const profileHash = state.profileHash(profile);
        const operationId = state.operationId(profile, key);
        const idempotencyHash = state.idempotencyHash(key);
        const requestHash = providerX402RequestHash({
            profile, canonicalUrl, rpcUrl, ...(callerCap === undefined ? {} : { callerCapAtomic: callerCap }),
        });
        return await state.withLocks([
            `profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`,
        ], async () => {
            const existing = await this.operations.resolvePrepare({
                kind: "x402_fetch", profileHash, operationId, idempotencyHash, requestHash,
            });
            if (existing !== null) {
                if (existing.kind !== "x402_fetch" || existing.strategy !== "provider_atomic") {
                    throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to a different operation strategy.");
                }
                return publicProviderX402Operation(existing.record);
            }
            await this.operations.assertProfileAvailable(profileHash);
            const bound = await requireProviderX402Profile(this.context, profileHash);
            const policy = requireProfilePolicy(await this.context.requirePolicy().load(policyBinding(bound)));
            const capAtomic = effectiveX402Cap(policy, callerCap);
            const challenge = await freshChallenge(this.context.requireHttp(), canonicalUrl);
            const selected = soleProviderOffer(challenge);
            assertProviderAtomicAmount(selected.amountAtomic);
            if (BigInt(selected.amountAtomic) > BigInt(capAtomic)) {
                throw new ApnError("APN_X402_OFFER_EXCEEDS_LIMIT", "The exact seller offer exceeds the effective x402 limit.");
            }
            const operation = stagedProviderX402Operation({
                operationId, idempotencyHash, profile, profileHash, requestHash, endpoint, rpcUrl,
                ...(callerCap === undefined ? {} : { callerCapAtomic: callerCap }),
                effectiveCapAtomic: capAtomic, bound, policy, selected,
                createdAt: this.context.clock.now().toISOString(),
            });
            await this.repository.writeOperation(operation);
            try {
                return publicProviderX402Operation(await this.completePreparation(operation));
            }
            catch {
                const durable = await this.repository.loadOperation(profileHash, operationId);
                if (durable !== null)
                    return publicProviderX402Operation(durable);
                throw new ApnError("APN_STATE_CORRUPT", "Staged provider x402 operation disappeared during preparation.");
            }
        });
    }
    async completePreparation(operation) {
        if (operation.state !== "preparing")
            return operation;
        const bound = await requireProviderX402Profile(this.context, operation.profileHash);
        if (!sameFrozenProviderProfile(bound, operation)) {
            return await this.failBeforeEffect(operation, "provider_profile_changed");
        }
        const policy = requireProfilePolicy(await this.context.requirePolicy().load(policyBinding(bound)));
        const cap = effectiveX402Cap(policy, operation.policy.callerCapAtomic);
        if (!sameFrozenProviderPolicy(operation, policy, cap)) {
            return await this.failBeforeEffect(operation, "provider_policy_changed");
        }
        let current = operation;
        if (current.preparedBalance === undefined) {
            const adapter = requireProviderX402Adapter(this.context, bound);
            adapter.x402.assertCompatibleIntent?.({ amountAtomic: current.requirement.amountAtomic });
            const balance = await observeProviderX402Balance(this.context, bound, adapter);
            assertProviderPolicyBalance(policy, balance, current.requirement.amountAtomic);
            current = await this.transition(current, "preparing", "provider_balance_observed", "x402_frozen_offer", { preparedBalance: {
                    amountAtomic: balance.raw,
                    observedAt: balance.observed_at,
                    accountBindingHash: balance.account_binding_hash,
                } });
        }
        assertProviderX402RpcBinding(this.context, current);
        const rpcIdentity = await this.context.requireRpc().assertBaseChain();
        if (rpcIdentity.chainId !== 8453 || sha256(rpcIdentity.rpcOrigin) !== current.rpcOriginHash) {
            throw new ApnError("APN_CHAIN_MISMATCH", "Provider x402 settlement RPC is not the frozen Base endpoint.");
        }
        return await this.transition(current, "awaiting_approval", "x402_awaiting_authorization", "x402_frozen_offer");
    }
    async approve(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.repository.findOperation(operationId);
        if (found === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        return await this.withOperationLock(found, async (loaded) => {
            const current = await this.recoverOrphanReceipt(loaded);
            if (current.terminal)
                return publicProviderX402Operation(current);
            if (current.state !== "awaiting_approval")
                return publicProviderX402Operation(await this.reconcile(current));
            let operation = current;
            try {
                const bound = await requireProviderX402Profile(this.context, operation.profileHash);
                if (!sameFrozenProviderProfile(bound, operation))
                    await this.failBeforeEffect(operation, "provider_profile_changed");
                const adapter = requireProviderX402Adapter(this.context, bound);
                adapter.x402.assertCompatibleIntent?.({ amountAtomic: operation.requirement.amountAtomic });
                await adapter.x402.prime?.();
                const balance = await observeProviderX402Balance(this.context, bound, adapter);
                const policy = requireProfilePolicy(await this.context.requirePolicy().load(policyBinding(bound)));
                assertFrozenProviderX402Policy(operation, policy, balance);
                assertProviderX402RpcBinding(this.context, operation);
                const rpc = providerX402ReadPort(this.context.requireRpc());
                const lower = await captureProviderEvidenceLowerBlock(rpc);
                if (lower.rpcOriginHash !== operation.rpcOriginHash)
                    await this.failBeforeEffect(operation, "rpc_origin_changed");
                const challenge = await freshChallenge(this.context.requireHttp(), operation.request.canonicalUrl);
                const selected = soleProviderOffer(challenge);
                if (selected.digest !== operation.requirement.digest || selected.payee !== operation.requirement.payee ||
                    selected.amountAtomic !== operation.requirement.amountAtomic ||
                    canonicalJson(selected.requirements) !== operation.requirement.declaredCanonicalJson)
                    await this.failBeforeEffect(operation, "final_preflight_offer_changed");
                const startedAt = this.context.clock.now();
                operation = await this.transition(operation, "started", "provider_paid_fetch_started", "x402_unknown_finality", {
                    finalPreflight: { requirementDigest: selected.digest, observedAt: startedAt.toISOString() },
                    evidenceLowerBlock: lower.lowerBlock,
                    evidenceDeadlineAt: new Date(startedAt.getTime() + EVIDENCE_WINDOW_MS).toISOString(),
                });
                let effect;
                try {
                    effect = await adapter.x402.execute({
                        url: operation.request.canonicalUrl,
                        amountAtomic: operation.requirement.amountAtomic,
                        correlationId: operation.operationId,
                        requestDigest: operation.request.requestDigest,
                    });
                }
                catch {
                    operation = await this.transition(operation, "ambiguous_effect", "provider_invocation_outcome_unknown", "x402_unknown_finality");
                    return publicProviderX402Operation(await this.reconcile(operation));
                }
                if (effect.disposition === "not_started") {
                    return publicProviderX402Operation(await this.failBeforeEffect(operation, effect.reason, false));
                }
                if (effect.disposition === "ambiguous") {
                    operation = await this.transition(operation, "ambiguous_effect", effect.reason, "x402_unknown_finality", {
                        ...(effect.invocation === undefined ? {} : { invocation: effect.invocation }),
                    });
                    return publicProviderX402Operation(await this.reconcile(operation));
                }
                operation = await this.transition(operation, "settlement_pending", "x402_settlement_pending", "x402_unknown_finality", {
                    invocation: effect.invocation,
                    sellerResult: effect.result,
                });
                return publicProviderX402Operation(await this.reconcile(operation));
            }
            catch (error) {
                const durable = await this.repository.loadOperation(operation.profileHash, operation.operationId);
                if (durable !== null && await this.repository.loadReceipt(durable.profileHash, durable.operationId) !== null) {
                    await this.recoverOrphanReceipt(durable);
                    throw error;
                }
                if (durable !== null && durable.state !== "awaiting_approval" && !durable.terminal) {
                    await this.transition(durable, "ambiguous_effect", "provider_result_invalid", "x402_unknown_finality");
                    throw error;
                }
                if (durable === null || durable.state !== "awaiting_approval" || operation.state !== "awaiting_approval")
                    throw error;
                await this.failBeforeEffect(operation, "provider_pre_effect_check_failed");
            }
        });
    }
    async recoverRead(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.repository.findOperation(operationId);
        if (found === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        await this.withOperationLock(found, async (current) => { await this.recoverOrphanReceipt(current); });
    }
    async resume(operationIdInput, waitSeconds) {
        if (waitSeconds !== undefined && (!Number.isSafeInteger(waitSeconds) || waitSeconds < 1 || waitSeconds > 300)) {
            throw new ApnError("APN_INVALID_INPUT", "Settlement wait must be an integer from 1 through 300 seconds.");
        }
        const operationId = canonicalOperationId(operationIdInput);
        const deadline = waitSeconds === undefined ? undefined : this.context.wait.nowMs() + waitSeconds * 1_000;
        await this.context.ready();
        const found = await this.repository.findOperation(operationId);
        if (found === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        try {
            await this.withOperationLock(found, async (loaded) => {
                const current = await this.recoverOrphanReceipt(loaded);
                if (current.state === "preparing") {
                    if (waitSeconds !== undefined) {
                        throw new ApnError("APN_OPERATION_BLOCKED", "Settlement wait requires a prepared provider x402 operation.");
                    }
                    await this.completePreparation(current);
                    return;
                }
                if (current.state === "awaiting_approval") {
                    throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation still requires fetch approve.");
                }
                let operation = current;
                if (operation.state === "started" && operation.invocation === undefined) {
                    operation = await this.transition(operation, "ambiguous_effect", "provider_result_missing_after_restart", "x402_unknown_finality");
                }
                await this.reconcile(operation, deadline);
            }, deadline);
        }
        catch (error) {
            if (waitSeconds !== undefined && isCode(error, "APN_STATE_BUSY"))
                return waitTimeout(waitSeconds, 0);
            throw error;
        }
        if (waitSeconds === undefined)
            return undefined;
        const current = await this.repository.findOperation(operationId);
        if (current?.terminal === true)
            return {
                outcome: "completed", requestedSeconds: waitSeconds.toString(), observationCount: "0",
            };
        return await waitForProviderSettlement(this.context.wait, waitSeconds, deadline, async () => {
            if (this.context.wait.nowMs() >= deadline)
                return false;
            const latest = await this.repository.findOperation(operationId);
            if (latest === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
            try {
                await this.withOperationLock(latest, async (locked) => await this.reconcile(locked, deadline), deadline);
            }
            catch (error) {
                if (isCode(error, "APN_STATE_BUSY"))
                    return false;
                throw error;
            }
            return (await this.repository.findOperation(operationId))?.terminal === true;
        });
    }
    async reconcile(operation, deadline) {
        operation = await this.recoverOrphanReceipt(operation);
        if (operation.terminal)
            return operation;
        if (operation.settlementEvidence !== undefined) {
            if (operation.state === "ambiguous_effect" && operation.sellerResult !== undefined)
                return operation;
            return await this.terminalizeSettled(operation);
        }
        if (operation.evidenceLowerBlock === undefined)
            return operation;
        if (operation.state === "ambiguous_effect" && SETTLEMENT_OBSERVATION_REASONS.has(operation.reason) &&
            (operation.immutableUpperBlock === undefined || !RETRYABLE_SETTLEMENT_OBSERVATION_REASONS.has(operation.reason)))
            return operation;
        assertProviderX402RpcBinding(this.context, operation);
        const remaining = deadline === undefined ? undefined : Math.floor(deadline - this.context.wait.nowMs());
        if (remaining !== undefined && remaining < 1)
            return operation;
        const rpc = remaining === undefined
            ? providerX402ReadPort(this.context.requireRpc())
            : boundedX402ReadPort(this.context.requireRpc(), Math.min(20_000, remaining));
        if (rpc === null)
            throw new ApnError("APN_OPERATION_BLOCKED", "Provider settlement wait requires bounded x402 RPC.");
        const observation = await observeProviderSettlement(operation, rpc);
        if (observation.kind === "pending")
            return operation;
        if (observation.kind === "ambiguous") {
            const sameUpper = observation.upperBlock === undefined
                ? operation.immutableUpperBlock === undefined
                : operation.immutableUpperBlock !== undefined &&
                    canonicalJson(operation.immutableUpperBlock) === canonicalJson(observation.upperBlock);
            if (operation.state === "ambiguous_effect" && operation.reason === observation.reason && sameUpper)
                return operation;
            return await this.transition(operation, "ambiguous_effect", observation.reason, "x402_unknown_finality", {
                ...(observation.upperBlock === undefined ? {} : { immutableUpperBlock: observation.upperBlock }),
            });
        }
        if (operation.state === "ambiguous_effect" && operation.sellerResult !== undefined) {
            const retryableObservation = RETRYABLE_SETTLEMENT_OBSERVATION_REASONS.has(operation.reason);
            const evidenced = await this.transition(operation, retryableObservation ? "settlement_pending" : "ambiguous_effect", retryableObservation ? "x402_settlement_verified" : "settlement_verified_after_ambiguity", retryableObservation ? "x402_settlement_verified_result_pending" : "x402_unknown_finality", { immutableUpperBlock: observation.upperBlock, settlementEvidence: observation.evidence });
            return retryableObservation ? await this.terminalizeSettled(evidenced) : evidenced;
        }
        const evidenced = await this.transition(operation, operation.sellerResult === undefined ? "ambiguous_effect" : "settlement_pending", operation.sellerResult === undefined ? "seller_result_missing" : "x402_settlement_verified", operation.sellerResult === undefined ? "x402_unknown_finality" : "x402_settlement_verified_result_pending", { immutableUpperBlock: observation.upperBlock, settlementEvidence: observation.evidence });
        return await this.terminalizeSettled(evidenced);
    }
    async terminalizeSettled(operation) {
        if (operation.settlementEvidence === undefined)
            return operation;
        const completed = operation.sellerResult !== undefined;
        const terminalState = completed ? "completed" : "failed_settled_without_result";
        const reason = completed ? "x402_completed" : "seller_result_missing";
        const proofClass = completed ? "x402_safe_settlement" : "confirmed_settlement_without_seller_result";
        const at = this.context.clock.now().toISOString();
        const receipt = this.terminalReceipt(operation, terminalState, reason, proofClass, at);
        await this.repository.writeReceipt(operation.profileHash, receipt);
        return await this.transition(operation, terminalState, reason, proofClass, {}, at);
    }
    terminalReceipt(operation, terminalState, reason, proofClass, createdAt) {
        return sealProviderX402Receipt({
            schemaVersion: "apn.provider-x402.receipt.v1",
            kind: "x402_fetch",
            operationId: operation.operationId,
            terminalState,
            reason,
            proofClass,
            fingerprint: operation.fingerprint,
            requestDigest: operation.request.requestDigest,
            requirementDigest: operation.requirement.digest,
            payer: operation.provider.payer,
            payee: operation.requirement.payee,
            amountAtomic: operation.requirement.amountAtomic,
            network: operation.requirement.network,
            token: operation.requirement.token,
            ...(operation.sellerResult === undefined ? {} : { result: {
                    classification: operation.sellerResult.classification,
                    sha256: operation.sellerResult.sha256,
                    byteLength: operation.sellerResult.byte_length,
                } }),
            ...(operation.settlementEvidence === undefined ? {} : { settlement: operation.settlementEvidence }),
            operationBindingHash: providerX402BindingHash(operation),
            createdAt,
        });
    }
    async recoverOrphanReceipt(operation) {
        const receipt = await this.repository.loadReceipt(operation.profileHash, operation.operationId);
        if (operation.terminal) {
            if (receipt === null) {
                const terminalState = operation.state;
                const reconstructed = this.terminalReceipt(operation, terminalState, operation.reason, operation.proofClass, operation.updatedAt);
                await this.repository.writeReceipt(operation.profileHash, reconstructed);
            }
            return operation;
        }
        if (receipt === null)
            return operation;
        if (receipt.terminalState === "failed_before_effect") {
            return await this.transition(operation, "failed_before_effect", receipt.reason, receipt.proofClass);
        }
        if (operation.settlementEvidence === undefined || (receipt.terminalState === "completed" ? operation.sellerResult === undefined : operation.sellerResult !== undefined)) {
            throw new ApnError("APN_STATE_CORRUPT", "Provider x402 terminal receipt has no matching durable evidence.");
        }
        return await this.transition(operation, receipt.terminalState, receipt.reason, receipt.proofClass);
    }
    async withOperationLock(operation, action, deadline) {
        const remaining = deadline === undefined ? undefined : Math.floor(deadline - this.context.wait.nowMs());
        if (remaining !== undefined && remaining < 1)
            throw new ApnError("APN_STATE_BUSY", "Settlement wait deadline elapsed before lock acquisition.");
        return await this.context.state.withLocks([
            `profile:${operation.profileHash}`, `operation:${operation.operationId}`, `operation:evidence:${operation.operationId}`,
        ], async () => {
            const current = await this.repository.loadOperation(operation.profileHash, operation.operationId);
            if (current === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
            return await action(current);
        }, remaining === undefined ? {} : { waitMs: remaining });
    }
    async failBeforeEffect(operation, reason, shouldThrow = true) {
        const at = this.context.clock.now().toISOString();
        const receipt = this.terminalReceipt(operation, "failed_before_effect", reason, "x402_proven_no_effect", at);
        await this.repository.writeReceipt(operation.profileHash, receipt);
        const failed = await this.transition(operation, "failed_before_effect", reason, "x402_proven_no_effect", {}, at);
        if (shouldThrow)
            throw new ApnError("APN_REPREPARE_REQUIRED", "Frozen x402 inputs changed before provider effect; prepare a new operation.");
        return failed;
    }
    async transition(operation, state, reason, proofClass, extra = {}, at = this.context.clock.now().toISOString()) {
        const transitions = appendProviderX402Transition(operation.transitions, { at, state, reason, proofClass });
        const { integrityHash: _integrity, ...base } = operation;
        const terminal = ["completed", "failed_before_effect", "failed_settled_without_result"].includes(state);
        const updated = sealProviderX402Operation({
            ...base,
            ...extra,
            state,
            finalityClass: terminal ? "terminal" : ["preparing", "awaiting_approval"].includes(state) ? "pre_effect" : "unknown_finality",
            terminal,
            reason,
            proofClass,
            nextActions: state === "awaiting_approval" ? ["x402.fetch.approve", "operation.status"]
                : terminal ? ["receipt.get"] : ["operation.status", "operation.resume"],
            updatedAt: at,
            transitions,
        });
        await this.repository.writeOperation(updated);
        return updated;
    }
}
function waitTimeout(seconds, observations) {
    return { outcome: "timeout", requestedSeconds: seconds.toString(), observationCount: observations.toString() };
}
//# sourceMappingURL=provider-x402-service.js.map