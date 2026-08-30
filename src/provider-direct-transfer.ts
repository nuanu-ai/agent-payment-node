import { hashObject, sha256 } from "./canonical.js";
import type { CommandRequest } from "./commands.js";
import { APPROVAL_WINDOW_MS, BASE_USDC, CHAIN_ID, STATE_VERSION, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { formatAtomic, parseDecimal } from "./money.js";
import type { OperationRecord, ProviderDirectBinding } from "./model.js";
import { OperationService } from "./operation-service.js";
import type { ProviderAdapterBundle, ProviderProfileRepositoryPort } from "./provider-ports.js";
import {
  capabilityHash,
  LOCAL_PROVIDER_ID,
  markProviderProfileDrift,
  type ProviderProfileRecord,
} from "./provider-profile.js";
import { providerDirectReceipt, recoverProviderTerminalOperation } from "./provider-direct-receipt.js";
import type { RpcReceipt } from "./ports.js";
import type { RuntimeContext } from "./runtime.js";
import { appendTransition, sealOperation } from "./state.js";
import {
  canonicalAddress,
  canonicalIdempotencyKey,
  canonicalOperationId,
  hasExactTransfer,
  publicOperation,
  publicReceipt,
} from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";

const DIRECT_POLICY = {
  identity: "apn.direct.foreground-approval.v1",
  verdict: "foreground_approval_required",
  foregroundApprovalRequired: true,
} as const;

export class ProviderDirectTransferService {
  private readonly operations: OperationService;

  constructor(private readonly context: RuntimeContext) {
    this.operations = new OperationService(context.state);
  }

  async canHandle(profileInput: string): Promise<boolean> {
    if (this.context.profileRepository === undefined) return false;
    await this.context.ready();
    const profile = canonicalProfile(profileInput);
    const stored = await this.context.requireProfileRepository().load(this.context.state.profileHash(profile));
    return stored !== null && stored.provider_id !== LOCAL_PROVIDER_ID;
  }

  async prepare(request: Extract<CommandRequest, { command: "transfer.prepare" }>): Promise<unknown> {
    const profile = canonicalProfile(request.profile);
    const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey);
    const recipient = canonicalAddress(request.recipient);
    const amount = parseDecimal(request.amount, USDC_DECIMALS, { positive: true });
    const amountDecimal = formatAtomic(amount.atomic, USDC_DECIMALS);
    await this.context.ready();
    const state = this.context.state;
    const profileHash = state.profileHash(profile);
    const operationId = state.operationId(profile, idempotencyKey);
    const idempotencyHash = state.idempotencyHash(idempotencyKey);
    const rpcBindingHash = sha256(`direct-rpc\0${this.context.requireRpcUrl()}`);
    return await state.withLocks([
      `profile:${profileHash}`,
      `operation:${operationId}`,
      `operation:idempotency:${idempotencyHash}`,
    ], async () => {
      const bound = await this.requiredProviderProfile(profileHash);
      const materialRequest = {
        method: "pay.transfer",
        profile,
        providerId: bound.provider_id,
        profileRevision: bound.revision,
        capabilityHash: bound.capability_hash,
        accountBindingHash: bound.account_binding_hash,
        walletAddress: bound.public_address,
        chainId: CHAIN_ID,
        token: BASE_USDC,
        decimals: USDC_DECIMALS,
        recipient,
        amountAtomic: amount.atomic,
        amountDecimal,
        policy: DIRECT_POLICY,
        rpcBindingHash,
      };
      const requestHash = hashObject(materialRequest);
      const existing = await this.operations.resolvePrepare({
        kind: "direct_transfer",
        profileHash,
        operationId,
        idempotencyHash,
        requestHash,
      });
      if (existing !== null) return publicOperation(existing.record as OperationRecord);
      await this.operations.assertProfileAvailable(profileHash);
      const rpcIdentity = await this.context.requireRpc().assertBaseChain();
      const preparedAt = new Date(Math.floor(this.context.clock.now().getTime() / 1000) * 1000);
      const expiresAt = new Date(preparedAt.getTime() + APPROVAL_WINDOW_MS);
      const providerDirect: ProviderDirectBinding = {
        schemaVersion: "apn.provider-direct.v1",
        providerId: bound.provider_id,
        profileRevision: bound.revision,
        capabilityHash: bound.capability_hash,
        accountBindingHash: bound.account_binding_hash,
        executionMode: "provider_atomic_send",
        executionOwner: "provider",
        retryOwner: "apn_outer_no_replay_journal",
        rpcBindingHash,
        rpcOriginHash: sha256(`direct-rpc-origin\0${rpcIdentity.rpcOrigin}`),
        policy: DIRECT_POLICY,
      };
      const fingerprint = hashObject({ ...materialRequest, operationId, idempotencyHash, providerDirect });
      const initial = {
        at: preparedAt.toISOString(),
        state: "awaiting_approval" as const,
        terminal: false,
        reason: "prepared_provider_atomic_send",
        proofClass: "durable_provider_intent",
      };
      const operation = sealOperation({
        schemaVersion: STATE_VERSION,
        operationId,
        idempotencyHash,
        profile,
        profileHash,
        requestHash,
        fingerprint,
        walletAddress: bound.public_address,
        recipient,
        amountAtomic: amount.atomic,
        amountDecimal,
        chainId: CHAIN_ID,
        token: BASE_USDC,
        providerDirect,
        preparedAt: preparedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        state: initial.state,
        terminal: initial.terminal,
        reason: initial.reason,
        proofClass: initial.proofClass,
        transitions: appendTransition([], initial),
      });
      await this.persist(operation);
      return publicOperation(operation);
    });
  }

  async approve(operationIdInput: string): Promise<unknown> {
    const operationId = canonicalOperationId(operationIdInput);
    await this.context.ready();
    const found = await this.requiredOperation(operationId);
    return await this.context.state.withLocks([
      `profile:${found.profileHash}`,
      `operation:${operationId}`,
    ], async () => {
      let operation = await this.requiredOperation(operationId);
      operation = await this.recoverOrphanTerminal(operation);
      if (operation.terminal || operation.state !== "awaiting_approval") return publicOperation(operation);
      if (this.context.clock.now().getTime() >= Date.parse(operation.expiresAt)) {
        await this.failBeforeEffect(operation, "approval_window_expired");
      }
      const binding = requiredBinding(operation);
      await this.assertFrozenPreconditions(operation, binding);
      await this.context.requireTransferApproval().approve({
        profile: operation.profile,
        operationId: operation.operationId,
        fingerprint: operation.fingerprint,
        walletAddress: operation.walletAddress,
        recipient: operation.recipient,
        amountAtomic: operation.amountAtomic,
        amountDecimal: operation.amountDecimal,
        expiresAt: operation.expiresAt,
        providerId: binding.providerId,
        policyIdentity: binding.policy.identity,
      });
      const adapter = this.requiredAdapter(binding);
      try {
        adapter.direct?.assertCompatibleIntent?.({
          amountAtomic: operation.amountAtomic,
          amountDecimal: operation.amountDecimal,
          recipient: operation.recipient,
        });
      } catch (error) {
        await this.transition(
          operation, "failed_before_effect", true, "provider_amount_encoding_incompatible", "provider_pre_effect_compatibility_failure",
        );
        throw error;
      }
      await this.reobserveProvider(operation, binding, adapter);
      operation = await this.transition(operation, "started", false, "provider_effect_started", "durable_provider_no_replay");
      let result: Awaited<ReturnType<NonNullable<typeof adapter.direct.execute>>>;
      try {
        result = await adapter.direct.execute({
          amountDecimal: operation.amountDecimal,
          recipient: operation.recipient,
        });
      } catch {
        return publicOperation(await this.transition(
          operation, "ambiguous_effect", false, "provider_invocation_outcome_unknown", "provider_effect_no_replay",
        ));
      }
      if (result.disposition === "not_started") {
        return publicOperation(await this.transition(
          operation, "failed_before_effect", true, result.reason, "provider_child_not_created",
        ));
      }
      if (result.disposition === "ambiguous") {
        return publicOperation(await this.transition(
          operation, "ambiguous_effect", false, result.reason, "provider_effect_no_replay",
        ));
      }
      operation = await this.transition(
        operation,
        "provider_acknowledged",
        false,
        "provider_transaction_identity_acknowledged",
        "provider_transaction_hash_only",
        { transactionHash: result.transactionHash },
      );
      return publicOperation(await this.inspectReceipt(operation));
    });
  }

  async resume(operationIdInput: string): Promise<unknown> {
    const operationId = canonicalOperationId(operationIdInput);
    await this.context.ready();
    const found = await this.requiredOperation(operationId);
    return await this.context.state.withLocks([`profile:${found.profileHash}`, `operation:${operationId}`], async () => {
      let operation = await this.requiredOperation(operationId);
      operation = await this.recoverOrphanTerminal(operation);
      if (operation.terminal) return publicOperation(operation);
      if (operation.state === "awaiting_approval") {
        throw new ApnError("APN_OPERATION_BLOCKED", "Operation still requires transfer approve.");
      }
      if (operation.state === "started" && operation.transactionHash === undefined) {
        operation = await this.transition(
          operation, "ambiguous_effect", false, "provider_result_missing_after_restart", "provider_effect_no_replay",
        );
      }
      if (operation.transactionHash === undefined) return publicOperation(operation);
      return publicOperation(await this.inspectReceipt(operation));
    });
  }

  async receipt(operationIdInput: string): Promise<unknown> {
    await this.context.ready();
    const operationId = canonicalOperationId(operationIdInput);
    const found = await this.requiredOperation(operationId);
    return await this.context.state.withLocks([
      `profile:${found.profileHash}`,
      `operation:${operationId}`,
    ], async () => {
      let operation = await this.requiredOperation(operationId);
      operation = await this.recoverOrphanTerminal(operation);
      let receipt = await this.context.state.loadReceipt(operation.profileHash, operation.operationId);
      if (receipt === null || receipt.operationIntegrityHash !== operation.integrityHash) {
        if (operation.terminal) {
          throw new ApnError("APN_STATE_CORRUPT", "Terminal operation has no authoritative receipt.");
        }
        receipt = providerDirectReceipt(operation);
        await this.context.state.writeReceipt(operation.profileHash, receipt);
      }
      return publicReceipt(receipt);
    });
  }

  private async assertFrozenPreconditions(operation: OperationRecord, binding: ProviderDirectBinding): Promise<void> {
    if (
      binding.policy.identity !== DIRECT_POLICY.identity || binding.policy.verdict !== DIRECT_POLICY.verdict ||
      binding.policy.foregroundApprovalRequired !== true ||
      sha256(`direct-rpc\0${this.context.requireRpcUrl()}`) !== binding.rpcBindingHash
    ) await this.failBeforeEffect(operation, "frozen_policy_or_rpc_binding_changed");
    const rpcIdentity = await this.context.requireRpc().assertBaseChain();
    if (sha256(`direct-rpc-origin\0${rpcIdentity.rpcOrigin}`) !== binding.rpcOriginHash) {
      await this.failBeforeEffect(operation, "rpc_origin_changed");
    }
    const current = await this.context.requireProfileRepository().load(operation.profileHash);
    if (
      current === null || current.drift.state !== "bound" || current.capability_snapshot.direct.available !== true ||
      current.capability_snapshot.direct.mode !== "provider_atomic_send" ||
      !sameFrozenProfile(current, operation, binding)
    ) await this.failBeforeEffect(operation, "provider_profile_changed");
  }

  private requiredAdapter(binding: ProviderDirectBinding): ProviderAdapterBundle & {
    readonly direct: Required<Pick<NonNullable<ProviderAdapterBundle["direct"]>, "execute">> & NonNullable<ProviderAdapterBundle["direct"]>;
  } {
    const adapter = this.context.requireProviderRegistry().resolve(binding.providerId);
    if (
      adapter.direct?.mode !== "provider_atomic_send" || adapter.direct.execute === undefined ||
      capabilityHash(adapter.capabilities) !== binding.capabilityHash ||
      adapter.capabilities.direct.available !== true || adapter.capabilities.direct.mode !== binding.executionMode ||
      adapter.capabilities.evidence.available !== true || adapter.capabilities.evidence.owner !== "apn"
    ) throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The bound provider direct effect is unavailable.");
    return adapter as ReturnType<ProviderDirectTransferService["requiredAdapter"]>;
  }

  private async reobserveProvider(
    operation: OperationRecord,
    binding: ProviderDirectBinding,
    adapter: ProviderAdapterBundle,
  ): Promise<void> {
    await adapter.lifecycle.probeStatus();
    const observed = await adapter.reads.observeBalance();
    await adapter.reads.crossCheckAddress(observed.address);
    if (
      observed.address.toLowerCase() !== operation.walletAddress.toLowerCase() ||
      observed.account_binding_hash !== binding.accountBindingHash
    ) {
      const repository = this.context.requireProfileRepository();
      const profile = await repository.load(operation.profileHash);
      if (profile === null) throw new ApnError("APN_STATE_CORRUPT", "Provider profile disappeared during sender recheck.");
      const rebindHandoff = `apn wallet connect --profile ${operation.profile} --provider ${binding.providerId} --expected-revision ${binding.profileRevision}`;
      await repository.save(markProviderProfileDrift(profile, {
        address: observed.address,
        accountBindingHash: observed.account_binding_hash,
        capabilityHash: capabilityHash(adapter.capabilities),
        observedAt: observed.observed_at,
        trustClass: adapter.trust_class,
      }));
      await this.failBeforeEffect(operation, "provider_sender_changed", new ApnError(
        "APN_PROFILE_DRIFT",
        "Provider sender changed before effect; explicit foreground rebind is required.",
        { cli_handoff: rebindHandoff, current_revision: String(binding.profileRevision) },
      ));
    }
  }

  private async inspectReceipt(operation: OperationRecord): Promise<OperationRecord> {
    if (operation.transactionHash === undefined) return operation;
    if (operation.terminal || ![
      "provider_acknowledged", "evidence_pending", "ambiguous_effect",
    ].includes(operation.state)) return operation;
    const binding = requiredBinding(operation);
    let receipt: RpcReceipt | null;
    try {
      if (sha256(`direct-rpc\0${this.context.requireRpcUrl()}`) !== binding.rpcBindingHash) {
        throw new Error("rpc binding drift");
      }
      const rpc = this.context.requireRpc();
      const identity = await rpc.assertBaseChain();
      if (sha256(`direct-rpc-origin\0${identity.rpcOrigin}`) !== binding.rpcOriginHash) throw new Error("rpc origin drift");
      receipt = await rpc.getReceipt(operation.transactionHash);
    } catch {
      return await this.receiptPending(operation, "receipt_evidence_unavailable");
    }
    if (receipt === null) return await this.receiptPending(operation, "receipt_evidence_pending");
    if (
      receipt.rpcOrigin.length === 0 ||
      sha256(`direct-rpc-origin\0${receipt.rpcOrigin}`) !== binding.rpcOriginHash ||
      receipt.transactionHash.toLowerCase() !== operation.transactionHash.toLowerCase()
    ) return await this.receiptAmbiguous(operation, "receipt_identity_mismatch");
    if (receipt.status === "reverted") return await this.transition(
      operation, "failed_confirmed_revert", true, "confirmed_receipt_revert", "confirmed_receipt", {}, receipt,
    );
    if (!hasExactTransfer(receipt, operation)) {
      return await this.receiptAmbiguous(operation, "successful_receipt_missing_exact_transfer", receipt);
    }
    return await this.transition(
      operation, "completed", true, "confirmed_exact_usdc_transfer", "confirmed_receipt_and_exact_transfer_log", {}, receipt,
    );
  }

  private async receiptPending(operation: OperationRecord, reason: string): Promise<OperationRecord> {
    if (operation.state === "evidence_pending" || operation.state === "ambiguous_effect") return operation;
    return await this.transition(
      operation, "evidence_pending", false, reason, "provider_transaction_hash_only",
    );
  }

  private async receiptAmbiguous(
    operation: OperationRecord,
    reason: string,
    receipt?: RpcReceipt,
  ): Promise<OperationRecord> {
    if (operation.state === "ambiguous_effect") return operation;
    return await this.transition(
      operation, "ambiguous_effect", false, reason, "provider_effect_no_replay", {}, receipt,
    );
  }

  private async requiredProviderProfile(profileHash: string): Promise<ProviderProfileRecord> {
    const profile = await (this.context.requireProfileRepository() as ProviderProfileRepositoryPort).load(profileHash);
    if (
      profile === null || profile.drift.state !== "bound" || profile.capability_snapshot.direct.available !== true ||
      profile.capability_snapshot.direct.mode !== "provider_atomic_send" ||
      profile.capability_snapshot.direct.execution_owner !== "provider" ||
      profile.capability_snapshot.direct.retry_owner !== "apn_outer_no_replay_journal"
    ) throw new ApnError("APN_PROFILE_DRIFT", "The provider profile is not bound for direct payment effects.");
    return profile;
  }

  private async requiredOperation(operationId: string): Promise<OperationRecord> {
    const operation = await this.context.state.findOperation(operationId);
    if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
    requiredBinding(operation);
    return operation;
  }

  private async recoverOrphanTerminal(operation: OperationRecord): Promise<OperationRecord> {
    const receipt = await this.context.state.loadReceipt(operation.profileHash, operation.operationId);
    const recovered = recoverProviderTerminalOperation(operation, receipt);
    if (recovered === null) return operation;
    await this.context.state.writeOperation(recovered);
    return recovered;
  }

  private async failBeforeEffect(operation: OperationRecord, reason: string, failure?: ApnError): Promise<never> {
    await this.transition(operation, "failed_before_effect", true, reason, "durable_pre_effect_failure");
    throw failure ?? new ApnError(
      "APN_REPREPARE_REQUIRED",
      "Frozen transfer inputs changed before approval; prepare a new operation.",
    );
  }

  private async transition(
    operation: OperationRecord,
    state: OperationRecord["state"],
    terminal: boolean,
    reason: string,
    proofClass: string,
    extra: Partial<Pick<OperationRecord, "transactionHash">> = {},
    rpcReceipt?: RpcReceipt,
  ): Promise<OperationRecord> {
    const at = this.context.clock.now().toISOString();
    const transitions = appendTransition(operation.transitions, { at, state, terminal, reason, proofClass });
    const { integrityHash: _previousIntegrityHash, ...base } = operation;
    const updated = sealOperation({ ...base, ...extra, state, terminal, reason, proofClass, transitions });
    await this.persist(updated, rpcReceipt);
    return updated;
  }

  private async persist(operation: OperationRecord, rpcReceipt?: RpcReceipt): Promise<void> {
    const receipt = providerDirectReceipt(operation, rpcReceipt);
    if (operation.terminal) {
      await this.context.state.writeReceipt(operation.profileHash, receipt);
      await this.context.state.writeOperation(operation);
      return;
    }
    await this.context.state.writeOperation(operation);
    await this.context.state.writeReceipt(operation.profileHash, receipt);
  }
}

function requiredBinding(operation: OperationRecord): ProviderDirectBinding {
  if (operation.providerDirect === undefined) throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not provider-atomic.");
  return operation.providerDirect;
}

function sameFrozenProfile(
  profile: ProviderProfileRecord,
  operation: OperationRecord,
  binding: ProviderDirectBinding,
): boolean {
  return profile.provider_id === binding.providerId && profile.revision === binding.profileRevision &&
    profile.capability_hash === binding.capabilityHash && profile.account_binding_hash === binding.accountBindingHash &&
    profile.public_address.toLowerCase() === operation.walletAddress.toLowerCase();
}
