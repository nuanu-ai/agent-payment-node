import { ApnError } from "./errors.js";
import { publicRailOperation, transitionRail } from "./rail-operation-model.js";
import type { RailOperationService } from "./rail-operation-service.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import type { OperationRecord } from "./model.js";
import { OperationService } from "./operation-service.js";
import { ProviderDirectState } from "./provider-direct-state.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalOperationId, publicOperation } from "./transfer-policy.js";
import type { GaslessService } from "./gasless/service.js";
import type { MetaMaskGaslessService } from "./metamask-gasless/service.js";
import { abandonFacilitatorGasless, abandonLocalGasless, abandonMetaMaskGasless } from "./operation-abandon-gasless.js";
import type { FacilitatorGaslessService } from "./facilitator-gasless/service.js";

export class OperationAbandonService {
  private readonly operations: OperationService;
  private readonly durable: ProviderDirectState;

  constructor(private readonly context: RuntimeContext, private readonly rails: RailOperationService,
    private readonly gasless: GaslessService, private readonly metaMaskGasless: MetaMaskGaslessService,
    private readonly facilitatorGasless?: FacilitatorGaslessService) {
    this.operations = new OperationService(context.state);
    this.durable = new ProviderDirectState(context);
  }

  async abandon(operationIdInput: string): Promise<unknown> {
    const operationId = canonicalOperationId(operationIdInput);
    await this.context.ready();
    const found = await this.operations.required(operationId);
    if (found.kind === "rail_transfer") return await this.abandonRail(found.record.profileHash, operationId);
    const base = { context: this.context, operations: this.operations };
    if (found.kind === "gasless_transfer") return await abandonLocalGasless({ ...base, gasless: this.gasless }, operationId);
    if (found.kind === "metamask_gasless_transfer") return await abandonMetaMaskGasless({ ...base, metaMaskGasless: this.metaMaskGasless }, operationId);
    if (found.kind === "facilitator_gasless_transfer" && this.facilitatorGasless !== undefined) {
      return await abandonFacilitatorGasless({ ...base, facilitatorGasless: this.facilitatorGasless }, operationId);
    }
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
        chainLabel: "Base (8453)",
        assetLabel: "canonical Base USDC",
        unit: "USDC",
        outcomeNote: "Financial outcome: UNKNOWN. The provider may already have sent this transfer.",
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

  private async abandonRail(profileHash: string, operationId: string): Promise<unknown> {
    return await this.context.state.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
      const selected = await this.operations.required(operationId);
      if (selected.kind !== "rail_transfer" || selected.record.profileHash !== profileHash) return ineligibleRail();
      const operation = selected.record;
      if (operation.state === "abandoned_unknown" && operation.terminal) return publicRailOperation(operation);
      const adapter = this.rails.policies.adapter(operation.account.rail, operation.account.provider);
      if (operation.terminal || operation.account.provider !== "local" || operation.transactionId === null ||
        !["unknown_finality", "submitted_pending"].includes(operation.state) || adapter.assertValidityExpired === undefined) ineligibleRail();
      await adapter.assertValidityExpired(operation.account, operation.prepared, operation.transactionId);
      const { asset } = operation.prepared;
      await this.context.requireOperationAbandonApproval().approve({
        operationId: operation.operationId, fingerprint: operation.fingerprint, profile: operation.profile, providerId: operation.account.provider,
        walletAddress: operation.prepared.sender, recipient: operation.prepared.recipient, amountAtomic: operation.prepared.amountAtomic,
        amountDecimal: railDecimal(operation.prepared.amountAtomic, asset.decimals),
        chainLabel: operation.account.rail === "solana" ? "Solana mainnet" : "TRON mainnet", assetLabel: `${asset.symbol} (${asset.identifier})`, unit: asset.symbol,
        outcomeNote: "Financial outcome: UNKNOWN. The validity window has passed and the configured RPC history shows no transaction, but that history can be incomplete.",
      });
      const abandoned = transitionRail(operation, { state: "abandoned_unknown", at: this.context.clock.now().toISOString(),
        reason: "owner_acknowledged_expired_unresolved_effect", proofClass: "owner_acknowledgement_only" });
      await this.rails.records.persist(abandoned);
      return publicRailOperation(abandoned);
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
function ineligibleRail(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "Only a local Solana or TRON transfer with an unknown outcome and a bound transaction can be abandoned after its validity window.");
}

function railDecimal(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, "0"); const fraction = padded.slice(-decimals).replace(/0+$/u, "");
  return fraction === "" ? padded.slice(0, -decimals) : `${padded.slice(0, -decimals)}.${fraction}`;
}
