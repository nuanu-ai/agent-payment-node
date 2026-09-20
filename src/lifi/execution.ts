import { approvalCode } from "../approval-code.js";
import { ApnError } from "../errors.js";
import type { StateStore } from "../state.js";
import { assertBridgeRemaining, guardBridgeEffect } from "./economics.js";
import { validateMaterial } from "./effect-store.js";
import { BridgeObservation, replaceEffect, type BridgeSave } from "./observation.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import { assertBridgeOwner } from "./owner.js";
import type { BridgeApprovalPort, BridgeCustodyPort, BridgeRpcPort, LifiProviderPort } from "./ports.js";
import { publicBridgeOperation } from "./receipt.js";
import { bridgeFailure } from "./validation.js";
import { BridgeAllowlistGate } from "./allowlist.js";

export class BridgeExecution {
  private readonly observation: BridgeObservation;
  constructor(private readonly state: StateStore, private readonly source: BridgeRpcPort,
    private readonly destination: BridgeRpcPort, provider: LifiProviderPort, private readonly custody: BridgeCustodyPort,
    private readonly now: () => number, private readonly save: BridgeSave) {
    this.observation = new BridgeObservation(source, destination, provider, save);
  }
  async approve(op: BridgeOperationRecord, approval: BridgeApprovalPort): Promise<BridgeOperationRecord> {
    if (op.terminal || op.state !== "awaiting_approval") return op;
    try { await this.guard(op, op.effects[0]!.role); }
    catch (error) { return await this.haltUnsent(op, error); }
    const accepted = await approval.confirm({ operationId: op.operationId, fingerprint: op.fingerprint,
      exactPhrase: approvalCode("bridge", op.fingerprint), summary: publicBridgeOperation(op) });
    if (!accepted) return await this.save(op, { state: "failed_before_effect", failure: { reason: "approval_rejected", residualAllowance: null } });
    // Consent does not extend the exact materialization expiry.
    try { assertBridgeRemaining(op, this.now()); }
    catch (error) { return await this.haltUnsent(op, error); }
    let usageLease = null;
    if (op.intent.allowlist !== null) {
      try { usageLease = await this.allowlist().reserve(op); }
      catch (error) { return await this.haltUnsent(op, error); }
    }
    op = await this.save(op, { state: "execution_pending", approval: { policy: "apn.bridge.foreground-approval.v1",
      fingerprint: op.fingerprint, approvedAt: new Date(this.now()).toISOString(), expiresAt: op.intent.expiresAt }, usageLease });
    return await this.run(op);
  }
  async run(op: BridgeOperationRecord): Promise<BridgeOperationRecord> {
    if (op.terminal || op.state === "awaiting_approval") return op;
    const haltReason = op.failure?.reason.startsWith("unsent_") ? op.failure.reason : null;
    const refreshed = await this.observation.sources(op); op = refreshed.operation;
    if (!refreshed.reliable) {
      if (haltReason !== null) op = await this.save(op, { failure: { reason: haltReason, residualAllowance: null } });
      return op;
    }
    const reverted = op.effects.findIndex((e) => e.phase === "safe_revert");
    if (reverted >= 0 && op.effects.slice(0, reverted).every((e) => e.phase === "safe_success")) return await this.terminalFailure(op, "failed_confirmed_revert", "source_transaction_reverted");
    if (op.effects.some((e) => e.phase === "included_revert" || e.phase === "safe_revert")) return op;
    if (haltReason !== null) return await this.haltUnsent(op, new ApnError("APN_OPERATION_BLOCKED", haltReason), haltReason);
    for (const initial of op.effects) {
      let effect = op.effects.find((e) => e.role === initial.role)!;
      if (effect.submissionAttempts === 1) {
        if (effect.phase !== "included_success" && effect.phase !== "safe_success") return op;
        continue;
      }
      if (effect.role === "bridge" && op.effects[0]!.role === "approval" &&
        !["included_success", "safe_success"].includes(op.effects[0]!.phase)) return op;
      if (effect.phase === "unsealed") {
        try { await this.guard(op, effect.role); }
        catch (error) { return await this.haltUnsent(op, error); }
        op = await this.save(op, { effects: replaceEffect(op, { ...effect, phase: "signing_started" }) });
        // The marker is durable before entering custody. A recovered marker only loads its original seal.
        try { await this.custody.seal(op, effect.role, op.intent.owner); }
        catch { /* A completed durable seal is recoverable even if its response was lost. */ }
        effect = op.effects.find((e) => e.role === effect.role)!;
      }
      if (effect.phase === "signing_started") {
        const material = await this.custody.load(op, effect.role);
        if (material === null) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_committed_signing_material_missing");
        await validateMaterial(material, op, effect.role);
        op = await this.save(op, { effects: replaceEffect(op, { ...effect, phase: "sealed",
          transactionHash: material.transactionHash, sealedMaterialHash: material.materialHash }) });
        effect = op.effects.find((e) => e.role === effect.role)!;
      }
      const material = await this.custody.load(op, effect.role);
      if (material === null) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_committed_sealed_material_missing");
      await validateMaterial(material, op, effect.role);
      try { await this.guard(op, effect.role); }
      catch (error) { return await this.haltUnsent(op, error); }
      op = await this.save(op, { state: "source_pending", effects: replaceEffect(op, { ...effect, phase: "submitting",
        submittedAt: new Date(this.now()).toISOString(), submissionAttempts: 1 }) });
      effect = op.effects.find((e) => e.role === effect.role)!;
      let sent = false;
      try {
        assertBridgeRemaining(op, this.now());
        const hash = await this.source.send(material.rawTransaction);
        if (hash !== effect.transactionHash) bridgeFailure("APN_RPC_AMBIGUOUS", "bridge_returned_hash_mismatch");
        sent = true;
      } catch { /* The durable first-send boundary is final even when submission is ambiguous. */ }
      op = await this.save(op, { state: sent ? "source_pending" : "unknown_finality", effects: replaceEffect(op, {
        ...effect, phase: sent ? "submitted_pending" : "unknown_finality",
      }) });
      const observed = await this.observation.sources(op); op = observed.operation;
      if (!observed.reliable) return op;
      effect = op.effects.find((e) => e.role === effect.role)!;
      if (effect.phase === "safe_revert" && op.effects.slice(0, op.effects.findIndex((e) => e.role === effect.role)).every((e) => e.phase === "safe_success")) return await this.terminalFailure(op, "failed_confirmed_revert", "source_transaction_reverted");
      if (effect.phase !== "included_success" && effect.phase !== "safe_success") return op;
    }
    if (op.effects.every((e) => e.phase === "safe_success")) return await this.observation.destinationProof(op);
    return op;
  }
  private async guard(op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<void> {
    await assertBridgeOwner(this.state, op.intent);
    if (op.intent.allowlist !== null) await this.allowlist().confirm(op.intent.profile, op.intent.materialization.request, op.intent.materialization.tool, op.intent.allowlist);
    await guardBridgeEffect(op, role, this.source, this.destination, this.now);
  }
  private allowlist(): BridgeAllowlistGate {
    return new BridgeAllowlistGate({ state: this.state, clock: { now: () => new Date(this.now()) } });
  }
  private async haltUnsent(op: BridgeOperationRecord, error: unknown, existingReason?: string): Promise<BridgeOperationRecord> {
    const reason = existingReason ?? `unsent_${error instanceof ApnError ? error.code.toLowerCase() : "guard_unavailable"}`;
    if (op.effects.some((e) => e.phase === "signing_started")) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_committed_signing_material_unresolved");
    if (op.effects.every((e) => e.submissionAttempts === 0)) return await this.save(op, { state: "failed_before_effect", failure: { reason, residualAllowance: null } });
    if (op.effects[0]?.role === "approval" && op.effects[0].phase === "safe_success" && op.effects.at(-1)!.submissionAttempts === 0) return await this.terminalFailure(op, "failed_after_approval", reason);
    return await this.save(op, { state: "unknown_finality", failure: { reason, residualAllowance: null } });
  }
  private async terminalFailure(op: BridgeOperationRecord, state: "failed_after_approval" | "failed_confirmed_revert", reason: string): Promise<BridgeOperationRecord> {
    let residualAllowance;
    try { residualAllowance = await this.observation.residual(op); }
    catch { return await this.save(op, { state: "unknown_finality", failure: { reason, residualAllowance: null } }); }
    return await this.save(op, { state, failure: { reason, residualAllowance } });
  }
}
