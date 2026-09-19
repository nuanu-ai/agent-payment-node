import { canonicalJson, hashObject, sha256 } from "./canonical.js";
import { chainAsset, chainDecimal } from "./chain-policy.js";
import { ChainPolicyService } from "./chain-policy-service.js";
import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import { newRailOperation, publicRailOperation, transitionRail, validateRailPrepared, validateRailTransactionId } from "./rail-operation-model.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import { RAIL_PRESEND_ATTEMPTS, RAIL_PRESEND_MIN_REMAINING_MS, RAIL_PRESEND_RETRY_MS, railSendReason, railSendTransient } from "./rail-send-binding.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import { DirectAllowlistGate, refuse } from "./direct-allowlist-gate.js";
import { railAllowlistSubject, railUsageTarget, requireListedRailAsset } from "./rail-direct-allowlist.js";
export class RailOperationService {
    context;
    records;
    policies;
    operations;
    allowlist;
    constructor(context) {
        this.context = context;
        this.allowlist = new DirectAllowlistGate(context);
        this.records = new RailOperationRepository(context.state.root);
        this.policies = new ChainPolicyService(context);
        this.operations = new OperationService(context.state, context.providerX402Repository, this.records);
    }
    async prepare(input) {
        const profile = canonicalProfile(input.profile);
        const asset = chainAsset(input.rail, input.asset);
        requireListedRailAsset(asset);
        const amountAtomic = chainDecimal(input.amount, asset.decimals);
        const maximumFeeAtomic = chainDecimal(input.maximumFee, input.rail === "solana" ? 9 : 6);
        const key = canonicalIdempotencyKey(input.idempotencyKey);
        const state = this.context.state;
        const profileHash = state.profileHash(profile);
        const operationId = state.operationId(profile, key);
        const idempotencyHash = state.idempotencyHash(key);
        await this.context.ready();
        return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
            const account = await this.policies.account(profile, input.rail);
            const adapter = this.policies.adapter(input.rail, account.provider);
            const recipient = adapter.canonicalAddress(input.recipient);
            if (recipient === account.address)
                throw new ApnError("APN_INVALID_INPUT", "The recipient must differ from the sender for a direct rail transfer.");
            const requestHash = hashObject({ kind: "rail_transfer", account, asset, recipient, amountAtomic, maximumFeeAtomic });
            const existing = await this.operations.resolvePrepare({ kind: "rail_transfer", profileHash, operationId, idempotencyHash, requestHash });
            if (existing !== null) {
                if (existing.kind !== "rail_transfer")
                    corrupt();
                return publicRailOperation(existing.record);
            }
            await this.operations.assertRailAccountAvailable(profileHash, account.rail, account.address);
            const policy = await this.policies.authorize(account, input.asset, maximumFeeAtomic);
            // Owner amount caps: the active allowlist policy and the shared usage ledger, checked before any RPC call.
            const allowlist = await this.allowlist.admit(railAllowlistSubject({ profile, operationId, account, prepared: { asset, amountAtomic } }));
            const prepared = await adapter.prepare({ account, asset, recipient, amountAtomic, maximumFeeAtomic, now: this.context.clock.now() });
            validateRailPrepared(prepared, account);
            if (prepared.recipient !== recipient || prepared.amountAtomic !== amountAtomic || prepared.maximumFeeAtomic !== maximumFeeAtomic || canonicalJson(prepared.asset) !== canonicalJson(asset) || prepared.networkIdentity !== policy.networkIdentity)
                corrupt();
            const operation = newRailOperation({ schemaVersion: "apn.rail-operation.v1", kind: "rail_transfer", operationId,
                profile, profileHash, idempotencyHash, requestHash, account, prepared, policyHash: policy.policyHash, allowlist });
            await this.records.persist(operation);
            return publicRailOperation(operation);
        });
    }
    async approve(operationId) {
        return await this.locked(operationId, async (operation) => {
            if (operation.terminal)
                return operation;
            if (operation.state !== "awaiting_approval")
                throw new ApnError("APN_OPERATION_BLOCKED", "The operation has already entered execution; use operation resume.");
            const approval = this.context.railApproval;
            if (approval === undefined)
                throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "A foreground terminal is required for direct-rail approval.");
            const adapter = this.adapter(operation);
            try {
                // A record prepared before the owner allowlist gate is refused before the owner is asked to approve it.
                if (operation.allowlist === undefined)
                    refuse("allowlist_binding_missing", "This transfer was prepared before the owner allowlist gate; prepare a new transfer.");
                await this.revalidate(operation, adapter);
                await approval.approve({ account: operation.account, operationId: operation.operationId, fingerprint: operation.fingerprint, policyHash: operation.policyHash,
                    prepared: operation.prepared, allowlist: operation.allowlist });
                await this.revalidate(operation, adapter);
            }
            catch (error) {
                await this.move(operation, "failed_before_effect", "approval_or_pre_effect_validation_refused", "durable_pre_effect");
                throw error;
            }
            if (adapter.execution === "provider_atomic")
                return await this.submit(operation, adapter, null, await this.reserveUsage(operation));
            let send;
            if (adapter.bindSend !== undefined) {
                try {
                    send = await this.patientBind(operation, adapter.bindSend.bind(adapter));
                }
                catch (error) {
                    await this.move(operation, "failed_before_effect", railSendReason(error, "pre_send_guard_refused"), "durable_pre_effect");
                    throw error;
                }
            }
            const allowlistLease = await this.reserveUsage(operation);
            operation = await this.move(operation, "signing_started", "foreground_signing_started", "durable_pre_effect", undefined, send, allowlistLease);
            let effect;
            try {
                effect = await adapter.sign(binding(operation));
            }
            catch (error) {
                const recovered = await adapter.recoverEffect(binding(operation));
                if (recovered === null)
                    await this.move(operation, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect");
                throw error;
            }
            this.assertEffect(operation, effect);
            operation = await this.move(operation, "signed_not_submitted", "encrypted_effect_bound", "durable_signed_effect", effect);
            return await this.firstLocalSubmit(operation, adapter, effect);
        });
    }
    async resume(operationId) {
        return await this.locked(operationId, async (operation) => {
            if (operation.terminal || operation.state === "awaiting_approval")
                return operation;
            const adapter = this.adapter(operation);
            if (operation.state === "signing_started" || operation.state === "signed_not_submitted") {
                const effect = await adapter.recoverEffect(binding(operation));
                if (effect === null) {
                    if (operation.state !== "signing_started")
                        corrupt();
                    return await this.move(operation, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect");
                }
                this.assertEffect(operation, effect);
                if (operation.state === "signing_started")
                    operation = await this.move(operation, "signed_not_submitted", "encrypted_effect_recovered", "durable_signed_effect", effect);
                return await this.firstLocalSubmit(operation, adapter, effect);
            }
            if (operation.state === "submitting")
                operation = await this.move(operation, "unknown_finality", "interrupted_submission_observation_only", "effect_outcome_unknown");
            return await this.inspect(operation, adapter);
        });
    }
    async receipt(operationId) {
        const found = await this.required(operationId);
        return await this.records.loadReceipt(found.profileHash, found.operationId);
    }
    async locked(operationIdInput, action) {
        const operationId = canonicalOperationId(operationIdInput);
        const found = await this.required(operationId);
        return await this.context.state.withLocks([`profile:${found.profileHash}`, `operation:${operationId}`], async () => {
            const operation = await this.required(operationId);
            await this.records.repairReceipt(operation);
            await this.followUsage(operation);
            return publicRailOperation(await action(operation));
        });
    }
    async required(operationId) {
        const found = await this.operations.required(operationId);
        if (found.kind !== "rail_transfer")
            throw new ApnError("APN_OPERATION_BLOCKED", "The operation is not a direct-rail transfer.");
        return found.record;
    }
    adapter(operation) { return this.policies.adapter(operation.account.rail, operation.account.provider); }
    /**
     * The send guard re-acquires a validity window and simulates, so a lost read must be re-run
     * rather than reported as a refusal. Only a transport loss is retried, only while the owner's
     * approved window still leaves room to send, and every attempt re-acquires a fresh window.
     */
    async patientBind(operation, bind) {
        const deadline = Date.parse(operation.prepared.expiresAt) - RAIL_PRESEND_MIN_REMAINING_MS;
        for (let attempt = 1;; attempt += 1) {
            try {
                return await bind(operation.account, operation.prepared);
            }
            catch (error) {
                if (attempt >= RAIL_PRESEND_ATTEMPTS || !railSendTransient(error) ||
                    this.context.clock.now().getTime() + RAIL_PRESEND_RETRY_MS >= deadline ||
                    await this.context.wait.wait(RAIL_PRESEND_RETRY_MS) === "interrupted")
                    throw error;
            }
        }
    }
    async revalidate(operation, adapter) {
        if (this.context.clock.now().getTime() >= Date.parse(operation.prepared.expiresAt))
            throw new ApnError("APN_REPREPARE_REQUIRED", "The frozen direct-rail approval expired.");
        const current = await this.policies.account(operation.profile, operation.account.rail);
        if (canonicalJson(current) !== canonicalJson(operation.account))
            throw new ApnError("APN_PROFILE_DRIFT", "The direct-rail account changed.");
        const policy = await this.policies.authorize(current, operation.prepared.asset.alias, operation.prepared.maximumFeeAtomic);
        if (policy.policyHash !== operation.policyHash)
            throw new ApnError("APN_PROFILE_DRIFT", "The chain policy changed after preparation.");
        if (operation.allowlist !== undefined)
            await this.allowlist.confirm(railAllowlistSubject(operation), operation.allowlist);
        await adapter.revalidate(current, operation.prepared, operation.send ?? null);
    }
    async firstLocalSubmit(operation, adapter, effect) {
        try {
            await this.revalidate(operation, adapter);
        }
        catch {
            return await this.move(operation, "failed_before_effect", "never_submitted_frozen_effect_no_longer_valid", "durable_pre_effect");
        }
        return await this.submit(operation, adapter, effect);
    }
    async submit(operation, adapter, effect, allowlistLease) {
        // This durable write is outside the catch: no invocation follows a failed write.
        operation = await this.move(operation, "submitting", "submission_intent_persisted", "effect_outcome_unknown", undefined, undefined, allowlistLease);
        let transactionId;
        try {
            const result = await adapter.submit(binding(operation), effect);
            transactionId = result.transactionId;
            validateRailTransactionId(transactionId, operation.account.rail);
            if (operation.transactionId !== null && transactionId !== operation.transactionId)
                throw new Error("effect mismatch");
        }
        catch {
            return await this.move(operation, "unknown_finality", "submission_outcome_unknown", "effect_outcome_unknown");
        }
        operation = await this.move(operation, "submitted_pending", "submission_identifier_bound", "submission_acknowledged", { transactionId });
        return await this.inspect(operation, adapter);
    }
    async inspect(operation, adapter) {
        if (operation.transactionId === null)
            return operation;
        let result;
        try {
            if (await adapter.assertNetwork() !== operation.prepared.networkIdentity)
                throw new Error("network mismatch");
            result = await adapter.inspect(operation.account, operation.prepared, operation.transactionId, operation.rawPayloadHash ?? undefined, operation.send ?? null);
        }
        catch {
            return operation;
        }
        if (!("evidence" in result))
            return operation;
        const next = transitionRail(operation, { state: result.status, at: this.context.clock.now().toISOString(),
            reason: result.status === "completed" ? "exact_finalized_transfer_verified" : "exact_finalized_revert_verified",
            proofClass: operation.account.rail === "solana" ? "solana_finalized_transaction_effect" : "tron_solidified_transaction_effect", evidence: result.evidence });
        await this.records.persist(next);
        return await this.followUsage(next);
    }
    assertEffect(operation, effect) {
        validateRailTransactionId(effect.transactionId, operation.account.rail);
        if (effect.operationId !== operation.operationId || effect.fingerprint !== operation.fingerprint || sha256(effect.rawPayload) !== effect.rawPayloadHash ||
            (operation.transactionId !== null && effect.transactionId !== operation.transactionId) ||
            (operation.rawPayloadHash !== null && effect.rawPayloadHash !== operation.rawPayloadHash))
            corrupt();
    }
    async move(operation, state, reason, proofClass, effect = undefined, send = undefined, allowlistLease = undefined) {
        const next = transitionRail(operation, { state, at: this.context.clock.now().toISOString(), reason, proofClass, ...effect,
            ...(send === undefined ? {} : { send }), ...(allowlistLease === undefined ? {} : { allowlistLease }) });
        await this.records.persist(next);
        return await this.followUsage(next);
    }
    /** After the foreground decision and every pre-send check, before signing or a provider send. Refusals end the operation. */
    async reserveUsage(operation) {
        try {
            if (operation.allowlist === undefined) {
                refuse("allowlist_binding_missing", "This transfer was prepared before the owner allowlist gate; prepare a new transfer.");
            }
            return await this.allowlist.reserve(railAllowlistSubject(operation), operation.allowlist);
        }
        catch (error) {
            await this.move(operation, "failed_before_effect", "allowlist_refused_at_approval", "durable_pre_effect");
            throw error;
        }
    }
    /** The journal owns the effect state; the shared usage ledger follows it forward, idempotently. */
    async followUsage(operation) {
        if (operation.allowlist !== undefined) {
            await this.allowlist.follow(railAllowlistSubject(operation), railUsageTarget(operation.state), operation.transitions.at(-1).transitionHash);
        }
        return operation;
    }
}
function binding(operation) { return { account: operation.account, operationId: operation.operationId, fingerprint: operation.fingerprint, prepared: operation.prepared, send: operation.send ?? null }; }
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail effect or operation binding is invalid."); }
//# sourceMappingURL=rail-operation-service.js.map