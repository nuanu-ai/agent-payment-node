import { canonicalJson, hashObject, sha256 } from "./canonical.js";
import { chainAsset, chainDecimal } from "./chain-policy.js";
import { ChainPolicyService } from "./chain-policy-service.js";
import type { ChainAssetAlias, DirectRailName, DirectRailPort, RailEffectBinding, RailInspection, RailSendBinding, RailSignedEffect } from "./direct-rail-ports.js";
import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import { newRailOperation, publicRailOperation, transitionRail, validateRailPrepared, validateRailTransactionId, type RailOperationRecord, type RailState } from "./rail-operation-model.js";
import { RailOperationRepository } from "./rail-operation-repository.js";
import { RAIL_PRESEND_ATTEMPTS, RAIL_PRESEND_MIN_REMAINING_MS, RAIL_PRESEND_RETRY_MS, railSendReason, railSendTransient } from "./rail-send-binding.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import { DirectAllowlistGate, refuse } from "./direct-allowlist-gate.js";
import type { DirectAssetUsageLease } from "./direct-asset-usage.js";
import { railAllowlistSubject, railUsageTarget, requireListedRailAsset } from "./rail-direct-allowlist.js";

export class RailOperationService {
  readonly records: RailOperationRepository;
  readonly policies: ChainPolicyService;
  private readonly operations: OperationService;
  private readonly allowlist: DirectAllowlistGate;
  constructor(private readonly context: RuntimeContext) {
    this.allowlist = new DirectAllowlistGate(context);
    this.records = new RailOperationRepository(context.state.root);
    this.policies = new ChainPolicyService(context);
    this.operations = new OperationService(context.state, context.providerX402Repository, this.records);
  }
  async prepare(input: {
    readonly profile: string; readonly rail: DirectRailName; readonly asset: ChainAssetAlias;
    readonly recipient: string; readonly amount: string; readonly maximumFee: string; readonly idempotencyKey: string;
  }): Promise<unknown> {
    const profile = canonicalProfile(input.profile); const asset = chainAsset(input.rail, input.asset);
    requireListedRailAsset(asset);
    const amountAtomic = chainDecimal(input.amount, asset.decimals);
    const maximumFeeAtomic = chainDecimal(input.maximumFee, input.rail === "solana" ? 9 : 6);
    const key = canonicalIdempotencyKey(input.idempotencyKey); const state = this.context.state;
    const profileHash = state.profileHash(profile); const operationId = state.operationId(profile, key); const idempotencyHash = state.idempotencyHash(key);
    await this.context.ready();
    return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
      const account = await this.policies.account(profile, input.rail);
      const adapter = this.policies.adapter(input.rail, account.provider);
      const recipient = adapter.canonicalAddress(input.recipient);
      if (recipient === account.address) throw new ApnError("APN_INVALID_INPUT", "The recipient must differ from the sender for a direct rail transfer.");
      const requestHash = hashObject({ kind: "rail_transfer", account, asset, recipient, amountAtomic, maximumFeeAtomic });
      const existing = await this.operations.resolvePrepare({ kind: "rail_transfer", profileHash, operationId, idempotencyHash, requestHash });
      if (existing !== null) {
        if (existing.kind !== "rail_transfer") corrupt();
        return publicRailOperation(existing.record);
      }
      await this.operations.assertRailAccountAvailable(profileHash, account.rail, account.address);
      const policy = await this.policies.authorize(account, input.asset, maximumFeeAtomic);
      // Owner amount caps: the active allowlist policy and the shared usage ledger, checked before any RPC call.
      const allowlist = await this.allowlist.admit(railAllowlistSubject({ profile, operationId, account, prepared: { asset, amountAtomic } }));
      const prepared = await adapter.prepare({ account, asset, recipient, amountAtomic, maximumFeeAtomic, now: this.context.clock.now() });
      validateRailPrepared(prepared, account);
      if (prepared.recipient !== recipient || prepared.amountAtomic !== amountAtomic || prepared.maximumFeeAtomic !== maximumFeeAtomic || canonicalJson(prepared.asset) !== canonicalJson(asset) || prepared.networkIdentity !== policy.networkIdentity) corrupt();
      const operation = newRailOperation({ schemaVersion: "apn.rail-operation.v1", kind: "rail_transfer", operationId,
        profile, profileHash, idempotencyHash, requestHash, account, prepared, policyHash: policy.policyHash, allowlist });
      await this.records.persist(operation);
      return publicRailOperation(operation);
    });
  }
  async approve(operationId: string): Promise<unknown> {
    return await this.locked(operationId, async (operation) => {
      if (operation.terminal) return operation;
      if (operation.state !== "awaiting_approval") throw new ApnError("APN_OPERATION_BLOCKED", "The operation has already entered execution; use operation resume.");
      const approval = this.context.railApproval;
      if (approval === undefined) throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "A foreground terminal is required for direct-rail approval.");
      const adapter = this.adapter(operation);
      try {
        // A record prepared before the owner allowlist gate is refused before the owner is asked to approve it.
        if (operation.allowlist === undefined) refuse("allowlist_binding_missing", "This transfer was prepared before the owner allowlist gate; prepare a new transfer.");
        await this.revalidate(operation, adapter);
        await approval.approve({ account: operation.account, operationId: operation.operationId, fingerprint: operation.fingerprint, policyHash: operation.policyHash,
          prepared: operation.prepared, allowlist: operation.allowlist });
        await this.revalidate(operation, adapter);
      } catch (error) {
        await this.move(operation, "failed_before_effect", "approval_or_pre_effect_validation_refused", "durable_pre_effect");
        throw error;
      }
      if (adapter.execution === "provider_atomic") return await this.submit(operation, adapter, null, await this.reserveUsage(operation));
      let send: RailSendBinding | undefined;
      if (adapter.bindSend !== undefined) {
        try { send = await this.patientBind(operation, adapter.bindSend.bind(adapter)); }
        catch (error) {
          await this.move(operation, "failed_before_effect", railSendReason(error, "pre_send_guard_refused"), "durable_pre_effect");
          throw error;
        }
      }
      const allowlistLease = await this.reserveUsage(operation);
      operation = await this.move(operation, "signing_started", "foreground_signing_started", "durable_pre_effect", undefined, send, allowlistLease);
      let effect: RailSignedEffect;
      try { effect = await adapter.sign(binding(operation)); }
      catch (error) {
        const recovered = await adapter.recoverEffect(binding(operation));
        if (recovered === null) await this.move(operation, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect");
        throw error;
      }
      this.assertEffect(operation, effect);
      operation = await this.move(operation, "signed_not_submitted", "encrypted_effect_bound", "durable_signed_effect", effect);
      return await this.firstLocalSubmit(operation, adapter, effect);
    });
  }
  async resume(operationId: string): Promise<unknown> {
    const found = await this.required(canonicalOperationId(operationId));
    if (found.account.rail === "solana" && found.account.provider === "local") return await this.resumeLocalSolana(found.operationId, found.profileHash);
    return await this.locked(operationId, async (operation) => {
      if (operation.terminal || operation.state === "awaiting_approval") return operation;
      const adapter = this.adapter(operation);
      if (operation.state === "signing_started" || operation.state === "signed_not_submitted") {
        const effect = await adapter.recoverEffect(binding(operation));
        if (effect === null) {
          if (operation.state !== "signing_started") corrupt();
          return await this.move(operation, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect");
        }
        this.assertEffect(operation, effect);
        if (operation.state === "signing_started") operation = await this.move(operation, "signed_not_submitted", "encrypted_effect_recovered", "durable_signed_effect", effect);
        return await this.firstLocalSubmit(operation, adapter, effect);
      }
      if (operation.state === "submitting") operation = await this.move(operation, "unknown_finality", "interrupted_submission_observation_only", "effect_outcome_unknown");
      return await this.inspect(operation, adapter);
    });
  }
  /** Observe an already bound local SOL effect without holding the profile lock during RPC pacing. */
  private async resumeLocalSolana(operationId: string, profileHash: string): Promise<unknown> {
    const keys = [`profile:${profileHash}`, `operation:${operationId}`];
    const snapshot = await this.context.state.withLocks(keys, async () => {
      let operation = await this.required(operationId);
      await this.records.repairReceipt(operation);
      await this.followUsage(operation);
      if (operation.terminal || operation.state === "awaiting_approval") return { operation, observe: false } as const;
      const adapter = this.adapter(operation);
      if (operation.state === "signing_started" || operation.state === "signed_not_submitted") {
        const effect = await adapter.recoverEffect(binding(operation));
        if (effect === null) {
          if (operation.state !== "signing_started") corrupt();
          operation = await this.move(operation, "failed_before_effect", "custody_proved_no_sealed_effect", "durable_pre_effect");
        } else {
          this.assertEffect(operation, effect);
          if (operation.state === "signing_started") operation = await this.move(operation, "signed_not_submitted", "encrypted_effect_recovered", "durable_signed_effect", effect);
          operation = await this.firstLocalSubmit(operation, adapter, effect);
        }
        return { operation, observe: false } as const;
      }
      // A crashed submit is ambiguous. Persist this boundary before any unlocked observation;
      // recovery must never call submit again.
      if (operation.state === "submitting") operation = await this.move(operation, "unknown_finality", "interrupted_submission_observation_only", "effect_outcome_unknown");
      return { operation, observe: true } as const;
    });
    if (!snapshot.observe) return publicRailOperation(snapshot.operation);
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
      if (inspection === null || !("evidence" in inspection)) return publicRailOperation(latest);
      // Check the current owner and policies again while holding both locks. Drift leaves the
      // ambiguous operation intact for a fresh reconciliation rather than accepting stale proof.
      try {
        const account = await this.policies.account(latest.profile, latest.account.rail);
        if (canonicalJson(account) !== canonicalJson(latest.account)) return publicRailOperation(latest);
        const policy = await this.policies.authorize(account, latest.prepared.asset.alias, latest.prepared.maximumFeeAtomic);
        if (policy.policyHash !== latest.policyHash) return publicRailOperation(latest);
        if (latest.allowlist !== undefined) await this.allowlist.confirm(railAllowlistSubject(latest), latest.allowlist);
      } catch { return publicRailOperation(latest); }
      const next = transitionRail(latest, { state: inspection.status, at: this.context.clock.now().toISOString(),
        reason: inspection.status === "completed" ? "exact_finalized_transfer_verified" : "exact_finalized_revert_verified",
        proofClass: "solana_finalized_transaction_effect", evidence: inspection.evidence });
      await this.records.persist(next);
      return publicRailOperation(await this.followUsage(next));
    });
  }
  async receipt(operationId: string): Promise<unknown> {
    const found = await this.required(operationId);
    return await this.records.loadReceipt(found.profileHash, found.operationId);
  }
  private async locked(operationIdInput: string, action: (operation: RailOperationRecord) => Promise<RailOperationRecord>): Promise<unknown> {
    const operationId = canonicalOperationId(operationIdInput);
    const found = await this.required(operationId);
    return await this.context.state.withLocks([`profile:${found.profileHash}`, `operation:${operationId}`], async () => {
      const operation = await this.required(operationId);
      await this.records.repairReceipt(operation);
      await this.followUsage(operation);
      return publicRailOperation(await action(operation));
    });
  }
  private async required(operationId: string): Promise<RailOperationRecord> {
    const found = await this.operations.required(operationId);
    if (found.kind !== "rail_transfer") throw new ApnError("APN_OPERATION_BLOCKED", "The operation is not a direct-rail transfer.");
    return found.record;
  }
  private adapter(operation: RailOperationRecord): DirectRailPort { return this.policies.adapter(operation.account.rail, operation.account.provider); }
  /**
   * The send guard re-acquires a validity window and simulates, so a lost read must be re-run
   * rather than reported as a refusal. Only a transport loss is retried, only while the owner's
   * approved window still leaves room to send, and every attempt re-acquires a fresh window.
   */
  private async patientBind(operation: RailOperationRecord, bind: NonNullable<DirectRailPort["bindSend"]>): Promise<RailSendBinding> {
    const deadline = Date.parse(operation.prepared.expiresAt) - RAIL_PRESEND_MIN_REMAINING_MS;
    for (let attempt = 1; ; attempt += 1) {
      try { return await bind(operation.account, operation.prepared); }
      catch (error) {
        if (attempt >= RAIL_PRESEND_ATTEMPTS || !railSendTransient(error) ||
          this.context.clock.now().getTime() + RAIL_PRESEND_RETRY_MS >= deadline ||
          await this.context.wait.wait(RAIL_PRESEND_RETRY_MS) === "interrupted") throw error;
      }
    }
  }
  private async revalidate(operation: RailOperationRecord, adapter: DirectRailPort): Promise<void> {
    if (this.context.clock.now().getTime() >= Date.parse(operation.prepared.expiresAt)) throw new ApnError("APN_REPREPARE_REQUIRED", "The frozen direct-rail approval expired.");
    const current = await this.policies.account(operation.profile, operation.account.rail);
    if (canonicalJson(current) !== canonicalJson(operation.account)) throw new ApnError("APN_PROFILE_DRIFT", "The direct-rail account changed.");
    const policy = await this.policies.authorize(current, operation.prepared.asset.alias, operation.prepared.maximumFeeAtomic);
    if (policy.policyHash !== operation.policyHash) throw new ApnError("APN_PROFILE_DRIFT", "The chain policy changed after preparation.");
    if (operation.allowlist !== undefined) await this.allowlist.confirm(railAllowlistSubject(operation), operation.allowlist);
    await adapter.revalidate(current, operation.prepared, operation.send ?? null);
  }
  private async firstLocalSubmit(operation: RailOperationRecord, adapter: DirectRailPort, effect: RailSignedEffect): Promise<RailOperationRecord> {
    try { await this.revalidate(operation, adapter); }
    catch {
      return await this.move(operation, "failed_before_effect", "never_submitted_frozen_effect_no_longer_valid", "durable_pre_effect");
    }
    return await this.submit(operation, adapter, effect);
  }
  private async submit(operation: RailOperationRecord, adapter: DirectRailPort, effect: RailSignedEffect | null,
    allowlistLease?: DirectAssetUsageLease): Promise<RailOperationRecord> {
    // This durable write is outside the catch: no invocation follows a failed write.
    operation = await this.move(operation, "submitting", "submission_intent_persisted", "effect_outcome_unknown", undefined, undefined, allowlistLease);
    let transactionId: string;
    try {
      const result = await adapter.submit(binding(operation), effect);
      transactionId = result.transactionId; validateRailTransactionId(transactionId, operation.account.rail);
      if (operation.transactionId !== null && transactionId !== operation.transactionId) throw new Error("effect mismatch");
    } catch {
      return await this.move(operation, "unknown_finality", "submission_outcome_unknown", "effect_outcome_unknown");
    }
    operation = await this.move(operation, "submitted_pending", "submission_identifier_bound", "submission_acknowledged", { transactionId });
    return await this.inspect(operation, adapter);
  }
  private async inspect(operation: RailOperationRecord, adapter: DirectRailPort): Promise<RailOperationRecord> {
    if (operation.transactionId === null) return operation;
    const result = await this.inspectEvidence(operation, adapter);
    if (result === null) return operation;
    if (!("evidence" in result)) return operation;
    const next = transitionRail(operation, { state: result.status, at: this.context.clock.now().toISOString(),
      reason: result.status === "completed" ? "exact_finalized_transfer_verified" : "exact_finalized_revert_verified",
      proofClass: operation.account.rail === "solana" ? "solana_finalized_transaction_effect" : "tron_solidified_transaction_effect", evidence: result.evidence });
    await this.records.persist(next); return await this.followUsage(next);
  }
  private async inspectEvidence(operation: RailOperationRecord, adapter: DirectRailPort): Promise<RailInspection | null> {
    if (operation.transactionId === null) return null;
    try {
      if (await adapter.assertNetwork() !== operation.prepared.networkIdentity) return null;
      return await adapter.inspect(operation.account, operation.prepared, operation.transactionId, operation.rawPayloadHash ?? undefined, operation.send ?? null);
    } catch { return null; }
  }
  private assertEffect(operation: RailOperationRecord, effect: RailSignedEffect): void {
    validateRailTransactionId(effect.transactionId, operation.account.rail);
    if (effect.operationId !== operation.operationId || effect.fingerprint !== operation.fingerprint || sha256(effect.rawPayload) !== effect.rawPayloadHash ||
      (operation.transactionId !== null && effect.transactionId !== operation.transactionId) ||
      (operation.rawPayloadHash !== null && effect.rawPayloadHash !== operation.rawPayloadHash)) corrupt();
  }
  private async move(operation: RailOperationRecord, state: RailState, reason: string, proofClass: string,
    effect: { readonly transactionId: string; readonly rawPayloadHash?: string } | undefined = undefined,
    send: RailSendBinding | undefined = undefined, allowlistLease: DirectAssetUsageLease | undefined = undefined): Promise<RailOperationRecord> {
    const next = transitionRail(operation, { state, at: this.context.clock.now().toISOString(), reason, proofClass, ...effect,
      ...(send === undefined ? {} : { send }), ...(allowlistLease === undefined ? {} : { allowlistLease }) });
    await this.records.persist(next); return await this.followUsage(next);
  }
  /** After the foreground decision and every pre-send check, before signing or a provider send. Refusals end the operation. */
  private async reserveUsage(operation: RailOperationRecord): Promise<DirectAssetUsageLease> {
    try {
      if (operation.allowlist === undefined) {
        refuse("allowlist_binding_missing", "This transfer was prepared before the owner allowlist gate; prepare a new transfer.");
      }
      return await this.allowlist.reserve(railAllowlistSubject(operation), operation.allowlist);
    } catch (error) {
      await this.move(operation, "failed_before_effect", "allowlist_refused_at_approval", "durable_pre_effect");
      throw error;
    }
  }
  /** The journal owns the effect state; the shared usage ledger follows it forward, idempotently. */
  private async followUsage(operation: RailOperationRecord): Promise<RailOperationRecord> {
    if (operation.allowlist !== undefined) {
      await this.allowlist.follow(railAllowlistSubject(operation), railUsageTarget(operation.state), operation.transitions.at(-1)!.transitionHash);
    }
    return operation;
  }
}
function binding(operation: RailOperationRecord): RailEffectBinding { return { account: operation.account, operationId: operation.operationId, fingerprint: operation.fingerprint, prepared: operation.prepared, send: operation.send ?? null }; }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail effect or operation binding is invalid."); }
