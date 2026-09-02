import { sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { OperationRecord, ProviderDirectBinding } from "./model.js";
import { providerDirectReceipt } from "./provider-direct-receipt.js";
import {
  canonicalProviderRecoveryToken,
  createProviderEffectReference,
} from "./provider-direct-recovery.js";
import type { RuntimeContext } from "./runtime.js";
import { appendTransition, sealOperation } from "./state.js";
import { canonicalOperationId, publicOperation } from "./transfer-policy.js";

const RECOVERABLE_REASONS = new Set([
  "provider_response_malformed",
  "provider_invocation_outcome_unknown",
  "provider_result_missing_after_restart",
  "provider_exit_unclassified",
]);

export class ProviderDirectRequestRecoveryService {
  constructor(private readonly context: RuntimeContext) {}

  async recover(operationIdInput: string, providerRequestIdInput: string): Promise<unknown> {
    const operationId = canonicalOperationId(operationIdInput);
    const recoveryToken = canonicalProviderRecoveryToken(providerRequestIdInput);
    await this.context.ready();
    const found = await this.requiredOperation(operationId);
    const providerId = requiredBinding(found).providerId;
    const referenceLock = sha256(`provider-request\0${providerId}\0${recoveryToken}`);
    return await this.context.state.withLocks([
      `profile:${found.profileHash}`,
      `operation:${operationId}`,
      `operation:provider-request:${referenceLock}`,
    ], async () => {
      const operation = await this.requiredOperation(operationId);
      const existing = operation.providerEffect;
      if (existing !== undefined) {
        if (existing.recoveryToken !== recoveryToken) {
          throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Provider request ID conflicts with the durable operation binding.");
        }
        return publicOperation(operation);
      }
      if (
        operation.terminal || operation.state !== "ambiguous_effect" || operation.transactionHash !== undefined ||
        !RECOVERABLE_REASONS.has(operation.reason)
      ) throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not eligible for provider-request recovery.");
      const duplicate = (await this.context.state.listAllOperations()).find((candidate) =>
        candidate.operationId !== operationId &&
        candidate.providerDirect?.providerId === providerId &&
        candidate.providerEffect?.recoveryToken === recoveryToken
      );
      if (duplicate !== undefined) {
        throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Provider request ID is already bound to another operation.");
      }
      return publicOperation(await this.persistRecoveredReference(operation, recoveryToken));
    });
  }

  private async requiredOperation(operationId: string): Promise<OperationRecord> {
    const operation = await this.context.state.findOperation(operationId);
    if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
    requiredBinding(operation);
    return operation;
  }

  private async persistRecoveredReference(operation: OperationRecord, recoveryToken: string): Promise<OperationRecord> {
    const transition = {
      at: this.context.clock.now().toISOString(),
      state: "provider_pending" as const,
      terminal: false,
      reason: "provider_request_reference_recovered",
      proofClass: "provider_request_reference",
    };
    const { integrityHash: _previousIntegrityHash, ...base } = operation;
    const updated = sealOperation({
      ...base,
      providerEffect: createProviderEffectReference(recoveryToken, "RECOVERED"),
      state: transition.state,
      terminal: transition.terminal,
      reason: transition.reason,
      proofClass: transition.proofClass,
      transitions: appendTransition(operation.transitions, transition),
    });
    await this.context.state.writeOperation(updated);
    await this.context.state.writeReceipt(updated.profileHash, providerDirectReceipt(updated));
    return updated;
  }
}

function requiredBinding(operation: OperationRecord): ProviderDirectBinding {
  if (operation.providerDirect === undefined) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not a provider-atomic direct transfer.");
  }
  return operation.providerDirect;
}
