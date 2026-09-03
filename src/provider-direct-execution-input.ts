import type { OperationRecord, ProviderDirectBinding } from "./model.js";
import type { ProviderDirectExecutionInput } from "./provider-ports.js";
import type { RuntimeContext } from "./runtime.js";

export function providerDirectExecutionInput(
  context: RuntimeContext,
  operation: OperationRecord,
  binding: ProviderDirectBinding,
): ProviderDirectExecutionInput {
  return {
    operationId: operation.operationId,
    profileHash: operation.profileHash,
    profileRevision: binding.profileRevision,
    sender: operation.walletAddress,
    recipient: operation.recipient,
    amountAtomic: operation.amountAtomic,
    amountDecimal: operation.amountDecimal,
    rpcUrl: context.requireRpcUrl(),
    preparedAt: operation.preparedAt,
    expiresAt: operation.expiresAt,
    requestHash: operation.requestHash,
    fingerprint: operation.fingerprint,
    binding,
  };
}
