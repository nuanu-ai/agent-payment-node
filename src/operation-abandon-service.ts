import { ApnError } from "./errors.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import type { OperationRecord } from "./model.js";
import { OperationService } from "./operation-service.js";
import { ProviderDirectState } from "./provider-direct-state.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalOperationId, publicOperation } from "./transfer-policy.js";

export class OperationAbandonService {
  private readonly operations: OperationService;
  private readonly durable: ProviderDirectState;

  constructor(private readonly context: RuntimeContext) {
    this.operations = new OperationService(context.state);
    this.durable = new ProviderDirectState(context);
  }

  async abandon(operationIdInput: string): Promise<unknown> {
    const operationId = canonicalOperationId(operationIdInput);
    await this.context.ready();
    const found = await this.operations.required(operationId);
    if (found.kind !== "direct_transfer") return ineligible();
    const profileHash = found.record.profileHash;
    return await this.context.state.withLocks([
      `profile:${profileHash}`,
      `operation:${operationId}`,
    ], async () => {
      const selected = await this.operations.required(operationId);
      if (selected.kind !== "direct_transfer" || selected.record.profileHash !== profileHash) return ineligible();
      assertProviderAbandonFamily(selected.record);
      if (selected.record.state === "abandoned_unknown" && selected.record.terminal) {
        return publicOperation(selected.record);
      }
      assertEligible(selected.record);
      let operation = await this.durable.recoverOrphanTerminal(selected.record);
      if (operation.state === "abandoned_unknown" && operation.terminal) return publicOperation(operation);
      assertEligible(operation);
      const binding = operation.providerDirect!;
      await this.context.requireOperationAbandonApproval().approve({
        operationId: operation.operationId,
        fingerprint: operation.fingerprint,
        profile: operation.profile,
        providerId: binding.providerId,
        walletAddress: operation.walletAddress,
        recipient: operation.recipient,
        amountAtomic: operation.amountAtomic,
        amountDecimal: operation.amountDecimal,
      });
      operation = await this.durable.transition(
        operation,
        "abandoned_unknown",
        true,
        "owner_acknowledged_unresolved_effect",
        "owner_acknowledgement_only",
      );
      return publicOperation(operation);
    });
  }
}

function assertProviderAbandonFamily(operation: OperationRecord): void {
  if (
    operation.providerDirect?.executionMode !== "provider_atomic_send" ||
    operation.providerDirect.coinbaseGasless !== undefined ||
    operation.chainId !== CHAIN_ID || operation.token !== BASE_USDC
  ) ineligible();
}

function assertEligible(operation: OperationRecord): void {
  if (
    operation.terminal || operation.state !== "ambiguous_effect" ||
    operation.transactionHash !== undefined || operation.providerEffect !== undefined
  ) ineligible();
}

function ineligible(): never {
  throw new ApnError(
    "APN_OPERATION_BLOCKED",
    "Only an eligible ambiguous provider-atomic direct operation can be abandoned; Coinbase gasless guards have no manual release.",
  );
}
