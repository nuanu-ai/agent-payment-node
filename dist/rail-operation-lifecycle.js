import { canonicalJson, sha256 } from "./canonical.js";
import { ChainPolicyService } from "./chain-policy-service.js";
import { ApnError } from "./errors.js";
import { publicRailOperation, transitionRail, validateRailTransactionId } from "./rail-operation-model.js";
import { RAIL_PRESEND_ATTEMPTS, RAIL_PRESEND_MIN_REMAINING_MS, RAIL_PRESEND_RETRY_MS, railSendTransient } from "./rail-send-binding.js";
import { DirectAllowlistGate, refuse } from "./direct-allowlist-gate.js";
import { railAllowlistSubject, railUsageTarget } from "./rail-direct-allowlist.js";
export class RailOperationLifecycle {
    context;
    records;
    policies;
    operations;
    allowlist;
    constructor(ports) {
        this.context = ports.context;
        this.records = ports.records;
        this.policies = ports.policies;
        this.operations = ports.operations;
        this.allowlist = ports.allowlist;
    }
    async finishLocalApproval(operation, adapter) {
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
    }
    /** The claim lock serializes recovery, while RPC revalidation and the one send run outside money-operation locks. */
    async executeLocalSolanaClaimed(initial, adapter, mayStartSigning = false) {
        const keys = [`profile:${initial.profileHash}`, `operation:${initial.operationId}`];
        const state = this.context.state;
        let signed;
        let effect;
        if (initial.state === "signing_started") {
            const recovered = await state.withLocks(keys, async () => {
                const latest = await this.required(initial.operationId);
                if (latest.integrityHash !== initial.integrityHash)
                    return { done: latest };
                const sealed = await adapter.recoverEffect(binding(latest));
                if (sealed === null)
                    return mayStartSigning
                        ? { pending: latest }
                        : { done: await this.move(latest, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect") };
                this.assertEffect(latest, sealed);
                return { signed: await this.move(latest, "signed_not_submitted", "encrypted_effect_recovered", "durable_signed_effect", sealed), effect: sealed };
            });
            if ("done" in recovered)
                return publicRailOperation(recovered.done);
            if ("signed" in recovered) {
                signed = recovered.signed;
                effect = recovered.effect;
            }
            else {
                const pending = recovered.pending;
                try {
                    await this.revalidate(pending, adapter);
                }
                catch (error) {
                    await state.withLocks(keys, async () => {
                        const latest = await this.required(initial.operationId);
                        if (latest.integrityHash === pending.integrityHash && await adapter.recoverEffect(binding(latest)) === null)
                            await this.move(latest, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect");
                    });
                    throw error;
                }
                const sealed = await state.withLocks(keys, async () => {
                    const latest = await this.required(initial.operationId);
                    if (latest.integrityHash !== pending.integrityHash)
                        return { done: latest };
                    try {
                        await this.assertCurrentRailPolicy(latest);
                    }
                    catch (error) {
                        await this.move(latest, "failed_before_effect", "pre_sign_owner_or_policy_changed", "durable_pre_effect");
                        throw error;
                    }
                    if (adapter.sealRevalidated === undefined)
                        corrupt();
                    let value;
                    try {
                        value = await adapter.sealRevalidated(binding(latest));
                    }
                    catch (error) {
                        if (await adapter.recoverEffect(binding(latest)) === null)
                            await this.move(latest, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect");
                        throw error;
                    }
                    this.assertEffect(latest, value);
                    return { signed: await this.move(latest, "signed_not_submitted", "encrypted_effect_bound", "durable_signed_effect", value), effect: value };
                });
                if ("done" in sealed)
                    return publicRailOperation(sealed.done);
                signed = sealed.signed;
                effect = sealed.effect;
            }
        }
        else if (initial.state === "signed_not_submitted") {
            const recovered = await state.withLocks(keys, async () => {
                const latest = await this.required(initial.operationId);
                if (latest.integrityHash !== initial.integrityHash)
                    return { done: latest };
                const sealed = await adapter.recoverEffect(binding(latest));
                if (sealed === null)
                    corrupt();
                this.assertEffect(latest, sealed);
                return { signed: latest, effect: sealed };
            });
            if ("done" in recovered)
                return publicRailOperation(recovered.done);
            signed = recovered.signed;
            effect = recovered.effect;
        }
        else
            return publicRailOperation(initial);
        try {
            await this.revalidate(signed, adapter);
        }
        catch {
            return await state.withLocks(keys, async () => {
                const latest = await this.required(initial.operationId);
                return publicRailOperation(latest.integrityHash === signed.integrityHash
                    ? await this.move(latest, "failed_before_effect", "never_submitted_frozen_effect_no_longer_valid", "durable_pre_effect") : latest);
            });
        }
        const committed = await state.withLocks(keys, async () => {
            const latest = await this.required(initial.operationId);
            if (latest.integrityHash !== signed.integrityHash)
                return { done: latest };
            try {
                await this.assertCurrentRailPolicy(latest);
            }
            catch {
                return { done: await this.move(latest, "failed_before_effect", "never_submitted_frozen_effect_no_longer_valid", "durable_pre_effect") };
            }
            // The intent is durable before adapter.submit can make even one physical send attempt.
            return { submitting: await this.move(latest, "submitting", "submission_intent_persisted", "effect_outcome_unknown") };
        });
        if ("done" in committed)
            return publicRailOperation(committed.done);
        const submitting = committed.submitting;
        let transactionId = null;
        try {
            const result = await adapter.submit(binding(submitting), effect);
            validateRailTransactionId(result.transactionId, submitting.account.rail);
            if (result.transactionId !== effect.transactionId)
                throw new Error("effect mismatch");
            transactionId = result.transactionId;
        }
        catch { /* Even a pre-send exception is conservatively ambiguous after the durable intent. */ }
        const acknowledged = await state.withLocks(keys, async () => {
            const latest = await this.required(initial.operationId);
            if (latest.integrityHash !== submitting.integrityHash)
                return latest;
            return transactionId === null
                ? await this.move(latest, "unknown_finality", "submission_outcome_unknown", "effect_outcome_unknown")
                : await this.move(latest, "submitted_pending", "submission_identifier_bound", "submission_acknowledged", { transactionId });
        });
        if (acknowledged.state !== "submitted_pending")
            return publicRailOperation(acknowledged);
        return await this.resumeLocalSolanaPhase(acknowledged.operationId, acknowledged.profileHash, true);
    }
    async resumeLocalSolanaPhase(operationId, profileHash, hasClaim) {
        const keys = [`profile:${profileHash}`, `operation:${operationId}`];
        const snapshot = await this.context.state.withLocks(keys, async () => {
            let operation = await this.required(operationId);
            await this.records.repairReceipt(operation);
            await this.followUsage(operation);
            if (operation.terminal || operation.state === "awaiting_approval")
                return { operation, mode: "done" };
            // The state decision belongs under the money locks. If approval advanced after an
            // unlocked caller's first read, acquire its claim before touching sign/submit recovery.
            if (!hasClaim && ["signing_started", "signed_not_submitted", "submitting"].includes(operation.state))
                return { operation, mode: "claim" };
            if (operation.state === "signing_started" || operation.state === "signed_not_submitted") {
                return { operation, mode: "execute" };
            }
            // A crashed submit is ambiguous. Persist this boundary before any unlocked observation;
            // recovery must never call submit again.
            if (operation.state === "submitting")
                operation = await this.move(operation, "unknown_finality", "interrupted_submission_observation_only", "effect_outcome_unknown");
            return { operation, mode: "observe" };
        });
        if (snapshot.mode === "done")
            return publicRailOperation(snapshot.operation);
        if (snapshot.mode === "claim")
            return await this.context.state.withLocks([`rail:approval-claim:${operationId}`], async () => await this.resumeLocalSolanaPhase(operationId, profileHash, true), { waitMs: 300_000 });
        if (snapshot.mode === "execute")
            return await this.executeLocalSolanaClaimed(snapshot.operation, this.adapter(snapshot.operation));
        const frozen = snapshot.operation;
        const inspection = await this.inspectEvidence(frozen, this.adapter(frozen));
        return await this.context.state.withLocks(keys, async () => {
            const latest = await this.required(operationId);
            await this.records.repairReceipt(latest);
            await this.followUsage(latest);
            // The journal hash covers the state, fingerprint, transaction ID, payload hash and send
            // binding. A competing resume/abandon wins; its latest record is returned unchanged.
            if (latest.integrityHash !== frozen.integrityHash || latest.profileHash !== profileHash ||
                latest.fingerprint !== frozen.fingerprint || latest.transactionId !== frozen.transactionId ||
                latest.rawPayloadHash !== frozen.rawPayloadHash || canonicalJson(latest.send ?? null) !== canonicalJson(frozen.send ?? null)) {
                return publicRailOperation(latest);
            }
            if (inspection === null || !("evidence" in inspection))
                return publicRailOperation(latest);
            // Check the current owner and policies again while holding both locks. Drift leaves the
            // ambiguous operation intact for a fresh reconciliation rather than accepting stale proof.
            try {
                const account = await this.policies.account(latest.profile, latest.account.rail);
                if (canonicalJson(account) !== canonicalJson(latest.account))
                    return publicRailOperation(latest);
                const policy = await this.policies.authorize(account, latest.prepared.asset.alias, latest.prepared.maximumFeeAtomic);
                if (policy.policyHash !== latest.policyHash)
                    return publicRailOperation(latest);
                if (latest.allowlist !== undefined)
                    await this.allowlist.confirm(railAllowlistSubject(latest), latest.allowlist);
            }
            catch {
                return publicRailOperation(latest);
            }
            const next = transitionRail(latest, { state: inspection.status, at: this.context.clock.now().toISOString(),
                reason: inspection.status === "completed" ? "exact_finalized_transfer_verified" : "exact_finalized_revert_verified",
                proofClass: "solana_finalized_transaction_effect", evidence: inspection.evidence });
            await this.records.persist(next);
            return publicRailOperation(await this.followUsage(next));
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
        const current = await this.assertCurrentRailPolicy(operation);
        await adapter.revalidate(current, operation.prepared, operation.send ?? null);
    }
    async assertCurrentRailPolicy(operation) {
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
        return current;
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
        const result = await this.inspectEvidence(operation, adapter);
        if (result === null)
            return operation;
        if (!("evidence" in result))
            return operation;
        const next = transitionRail(operation, { state: result.status, at: this.context.clock.now().toISOString(),
            reason: result.status === "completed" ? "exact_finalized_transfer_verified" : "exact_finalized_revert_verified",
            proofClass: operation.account.rail === "solana" ? "solana_finalized_transaction_effect" : "tron_solidified_transaction_effect", evidence: result.evidence });
        await this.records.persist(next);
        return await this.followUsage(next);
    }
    async inspectEvidence(operation, adapter) {
        if (operation.transactionId === null)
            return null;
        try {
            if (await adapter.assertNetwork() !== operation.prepared.networkIdentity)
                return null;
            return await adapter.inspect(operation.account, operation.prepared, operation.transactionId, operation.rawPayloadHash ?? undefined, operation.send ?? null);
        }
        catch {
            return null;
        }
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
export function binding(operation) { return { account: operation.account, operationId: operation.operationId, fingerprint: operation.fingerprint, prepared: operation.prepared, send: operation.send ?? null }; }
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail effect or operation binding is invalid."); }
//# sourceMappingURL=rail-operation-lifecycle.js.map