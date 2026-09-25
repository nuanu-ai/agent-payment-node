import { approvalCode } from "../approval-code.js";
import { ApnError } from "../errors.js";
import { assertBridgeRemaining, guardBridgeEffect } from "./economics.js";
import { validateMaterial } from "./effect-store.js";
import { BridgeObservation, replaceEffect } from "./observation.js";
import { retainedUnsentBridgeRpcFailure } from "./operation-model.js";
import { assertBridgeOwner } from "./owner.js";
import { publicBridgeOperation } from "./receipt.js";
import { bridgeFailure } from "./validation.js";
import { BridgeAllowlistGate } from "./allowlist.js";
export class BridgeExecution {
    state;
    source;
    destination;
    custody;
    now;
    save;
    physicalBudget;
    observation;
    constructor(state, source, destination, provider, custody, now, save, observationRpc = { source: () => source, destination: () => destination, residual: () => source }, physicalBudget) {
        this.state = state;
        this.source = source;
        this.destination = destination;
        this.custody = custody;
        this.now = now;
        this.save = save;
        this.physicalBudget = physicalBudget;
        this.observation = new BridgeObservation(observationRpc.source, observationRpc.destination, provider, save, observationRpc.residual);
    }
    async approve(op, approval) {
        if (op.terminal || op.state !== "awaiting_approval")
            return op;
        try {
            await this.guard(op, op.effects[0].role);
        }
        catch (error) {
            return budgetExhausted(error) ? op : await this.haltUnsent(op, error);
        }
        const accepted = await approval.confirm({ operationId: op.operationId, fingerprint: op.fingerprint,
            exactPhrase: approvalCode("bridge", op.fingerprint), summary: publicBridgeOperation(op) });
        if (!accepted)
            return await this.save(op, { state: "failed_before_effect", failure: { reason: "approval_rejected", residualAllowance: null } });
        // Consent does not extend the exact materialization expiry.
        try {
            assertBridgeRemaining(op, this.now());
        }
        catch (error) {
            return await this.haltUnsent(op, error);
        }
        let usageLease = null;
        if (op.intent.allowlist !== null) {
            try {
                usageLease = await this.allowlist().reserve(op);
            }
            catch (error) {
                return await this.haltUnsent(op, error);
            }
        }
        op = await this.save(op, { state: "execution_pending", approval: { policy: "apn.bridge.foreground-approval.v1",
                fingerprint: op.fingerprint, approvedAt: new Date(this.now()).toISOString(), expiresAt: op.intent.expiresAt }, usageLease });
        return await this.run(op);
    }
    async run(op) {
        if (op.terminal || op.state === "awaiting_approval")
            return op;
        const haltReason = op.failure?.reason.startsWith("unsent_") ? op.failure.reason : null;
        const refreshed = await this.observation.sources(op);
        op = refreshed.operation;
        if (!refreshed.reliable) {
            if (haltReason !== null)
                op = await this.save(op, { failure: retainedUnsentBridgeRpcFailure(op) ?? { reason: haltReason, residualAllowance: null } });
            return op;
        }
        const reverted = op.effects.findIndex((e) => e.phase === "safe_revert");
        if (reverted >= 0 && op.effects.slice(0, reverted).every((e) => e.phase === "safe_success"))
            return await this.terminalFailure(op, "failed_confirmed_revert", "source_transaction_reverted");
        if (op.effects.some((e) => e.phase === "included_revert" || e.phase === "safe_revert"))
            return op;
        if (haltReason !== null)
            return await this.haltUnsent(op, new ApnError("APN_OPERATION_BLOCKED", haltReason), haltReason);
        for (const initial of op.effects) {
            let effect = op.effects.find((e) => e.role === initial.role);
            if (effect.submissionAttempts === 1) {
                if (effect.phase !== "included_success" && effect.phase !== "safe_success")
                    return op;
                continue;
            }
            if (effect.role === "bridge" && op.effects[0].role === "approval" &&
                !["included_success", "safe_success"].includes(op.effects[0].phase))
                return op;
            if (effect.phase === "unsealed") {
                try {
                    await this.guard(op, effect.role);
                }
                catch (error) {
                    return budgetExhausted(error) ? op : await this.haltUnsent(op, error);
                }
                op = await this.save(op, { effects: replaceEffect(op, { ...effect, phase: "signing_started" }) });
                // The marker is durable before entering custody. A recovered marker only loads its original seal.
                try {
                    await this.custody.seal(op, effect.role, op.intent.owner);
                }
                catch { /* A completed durable seal is recoverable even if its response was lost. */ }
                effect = op.effects.find((e) => e.role === effect.role);
            }
            if (effect.phase === "signing_started") {
                const material = await this.custody.load(op, effect.role);
                if (material === null)
                    bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_committed_signing_material_missing");
                await validateMaterial(material, op, effect.role);
                op = await this.save(op, { effects: replaceEffect(op, { ...effect, phase: "sealed",
                        transactionHash: material.transactionHash, sealedMaterialHash: material.materialHash }) });
                effect = op.effects.find((e) => e.role === effect.role);
            }
            const material = await this.custody.load(op, effect.role);
            if (material === null)
                bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_committed_sealed_material_missing");
            await validateMaterial(material, op, effect.role);
            try {
                await this.guard(op, effect.role);
            }
            catch (error) {
                return budgetExhausted(error) ? op : await this.haltUnsent(op, error);
            }
            // Preserve a sealed effect for a later invocation when its one permitted send cannot fit.
            if (this.physicalBudget?.remaining() === 0)
                return op;
            op = await this.save(op, { state: "source_pending", effects: replaceEffect(op, { ...effect, phase: "submitting",
                    submittedAt: new Date(this.now()).toISOString(), submissionAttempts: 1 }) });
            effect = op.effects.find((e) => e.role === effect.role);
            let sent = false;
            try {
                assertBridgeRemaining(op, this.now());
                const hash = await this.source.send(material.rawTransaction);
                if (hash !== effect.transactionHash)
                    bridgeFailure("APN_RPC_AMBIGUOUS", "bridge_returned_hash_mismatch");
                sent = true;
            }
            catch { /* The durable first-send boundary is final even when submission is ambiguous. */ }
            op = await this.save(op, { state: sent ? "source_pending" : "unknown_finality", effects: replaceEffect(op, {
                    ...effect, phase: sent ? "submitted_pending" : "unknown_finality",
                }) });
            const observed = await this.observation.sources(op);
            op = observed.operation;
            if (!observed.reliable)
                return op;
            effect = op.effects.find((e) => e.role === effect.role);
            if (effect.phase === "safe_revert" && op.effects.slice(0, op.effects.findIndex((e) => e.role === effect.role)).every((e) => e.phase === "safe_success"))
                return await this.terminalFailure(op, "failed_confirmed_revert", "source_transaction_reverted");
            if (effect.phase !== "included_success" && effect.phase !== "safe_success")
                return op;
        }
        if (op.effects.every((e) => e.phase === "safe_success"))
            return await this.observation.destinationProof(op);
        return op;
    }
    async guard(op, role) {
        await assertBridgeOwner(this.state, op.intent);
        if (op.intent.allowlist === null)
            throw new ApnError("APN_ALLOWLIST_REFUSED", "This bridge operation predates common allowlist enforcement; prepare it again under an active policy.", {
                reason: "allowlist_binding_missing", rail: "bridge",
            });
        await this.allowlist().confirm(op.intent.profile, op.intent.materialization.request, op.intent.materialization.tool, op.intent.allowlist);
        await guardBridgeEffect(op, role, this.source, this.destination, this.now);
    }
    allowlist() {
        return new BridgeAllowlistGate({ state: this.state, clock: { now: () => new Date(this.now()) } });
    }
    async haltUnsent(op, error, existingReason) {
        const retained = retainedUnsentBridgeRpcFailure(op);
        const reason = retained?.reason ?? existingReason ?? `unsent_${error instanceof ApnError ? error.code.toLowerCase() : "guard_unavailable"}`;
        const classifiedRpc = preSignRpcFailure(error);
        const classifiedEffect = classifiedRpc === null ? undefined : op.effects.find((effect) => effect.role === classifiedRpc.effectRole);
        const preSignRpc = retained?.preSignRpc ?? (classifiedRpc !== null && classifiedEffect?.phase === "unsealed" &&
            classifiedEffect.submissionAttempts === 0 ? classifiedRpc : null);
        const failure = preSignRpc === null ? { reason, residualAllowance: null } : {
            reason: "unsent_apn_rpc_ambiguous", residualAllowance: null, preSignRpc,
            ...(retained?.residualAllowanceStatus === "unavailable" ? { residualAllowanceStatus: "unavailable" } : {}),
        };
        if (op.effects.some((e) => e.phase === "signing_started"))
            bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_committed_signing_material_unresolved");
        if (op.effects.every((e) => e.submissionAttempts === 0))
            return await this.save(op, { state: "failed_before_effect", failure });
        if (op.effects[0]?.role === "approval" && op.effects[0].phase === "safe_success" && op.effects.at(-1).submissionAttempts === 0) {
            return await this.terminalFailure(op, "failed_after_approval", reason, preSignRpc);
        }
        return await this.save(op, { state: "unknown_finality", failure });
    }
    async terminalFailure(op, state, reason, preSignRpc = null) {
        const retained = retainedUnsentBridgeRpcFailure(op), diagnostic = preSignRpc ?? retained?.preSignRpc ?? null;
        const failureReason = diagnostic === null ? reason : "unsent_apn_rpc_ambiguous";
        const residual = await this.observation.residualObservation(op);
        if (!residual.ok)
            return await this.save(op, { state: "unknown_finality", observationTelemetry: residual.observationTelemetry,
                failure: { reason: failureReason, residualAllowance: null,
                    ...(diagnostic === null ? {} : { residualAllowanceStatus: "unavailable", preSignRpc: diagnostic }) } });
        return await this.save(op, { state, observationTelemetry: residual.observationTelemetry, failure: { reason: failureReason, residualAllowance: residual.value,
                ...(diagnostic === null ? {} : { residualAllowanceStatus: "observed", preSignRpc: diagnostic }) } });
    }
}
function budgetExhausted(error) {
    return error instanceof ApnError && error.code === "APN_RPC_BUDGET_EXCEEDED";
}
function preSignRpcFailure(error) {
    if (!(error instanceof ApnError) || error.code !== "APN_RPC_AMBIGUOUS")
        return null;
    const d = error.details;
    if (d === undefined || typeof d.rpcStage !== "string" || typeof d.rpcChainRole !== "string" || typeof d.rpcChainId !== "string" ||
        typeof d.rpcCategory !== "string" || typeof d.effectRole !== "string")
        return null;
    return { schemaVersion: "apn.bridge-presign-rpc-failure.v1", phase: "pre_sign_guard",
        effectRole: d.effectRole, stage: d.rpcStage,
        chainRole: d.rpcChainRole, chainId: Number(d.rpcChainId),
        category: d.rpcCategory,
        method: typeof d.rpcMethod === "string" ? d.rpcMethod : null };
}
//# sourceMappingURL=execution.js.map