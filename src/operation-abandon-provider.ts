import { ApnError } from "./errors.js";
import type { OperationService } from "./operation-service.js";
import { publicProviderX402Operation, type ProviderX402OperationRecord } from "./provider-x402-model.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import { ProviderX402Service } from "./provider-x402-service.js";
import { providerX402TerminalReceipt, transitionProviderX402Operation } from "./provider-x402-state.js";
import type { RuntimeContext } from "./runtime.js";

const UNRESOLVED_X402: readonly string[] = ["ambiguous_effect", "settlement_pending"];

/**
 * Owner release (R4) of a provider paid request whose settlement stayed unprovable after its evidence window:
 * evidence that is not unique, mismatched or unavailable. It never pays, sends or calls the provider again.
 */
export async function abandonProviderX402(context: RuntimeContext, operations: OperationService,
  operationId: string): Promise<unknown> {
  const repository = context.providerX402Repository ?? new ProviderX402Repository(context.state.root);
  const initial = await providerX402Record(operations, operationId);
  if (initial.state === "abandoned_unknown" && initial.terminal) return publicProviderX402Operation(initial);
  assertEligible(context, initial);
  // One last ordinary observation: evidence that has become provable closes the operation instead.
  await new ProviderX402Service(context).resume(operationId).catch(() => undefined);
  return await context.state.withLocks([`profile:${initial.profileHash}`,
    `provider-account:${initial.provider.providerId}:${initial.provider.accountBindingHash}`,
    `operation:${operationId}`, `operation:evidence:${operationId}`], async () => {
    const op = await repository.loadOperation(initial.profileHash, operationId);
    if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
    if (op.terminal) return publicProviderX402Operation(op);
    assertEligible(context, op);
    await context.requireOperationAbandonApproval().approve({ operationId, fingerprint: op.fingerprint, profile: op.profile,
      providerId: op.provider.providerId, walletAddress: op.provider.payer, recipient: op.requirement.payee,
      amountAtomic: op.requirement.amountAtomic, amountDecimal: usdc(op.requirement.amountAtomic), chainLabel: "Base (8453)",
      assetLabel: "canonical Base USDC", unit: "USDC",
      outcomeNote: "Financial outcome: UNKNOWN. The provider may have paid the seller; APN could not prove one settlement in the evidence window." });
    const at = context.clock.now().toISOString(), reason = "owner_acknowledged_unresolved_effect", proofClass = "owner_acknowledgement_only";
    await repository.writeReceipt(op.profileHash, providerX402TerminalReceipt(op, "abandoned_unknown", reason, proofClass, at));
    const next = transitionProviderX402Operation(op, "abandoned_unknown", reason, proofClass, {}, at);
    await repository.writeOperation(next);
    return publicProviderX402Operation(next);
  });
}

async function providerX402Record(operations: OperationService, operationId: string): Promise<ProviderX402OperationRecord> {
  const found = await operations.required(operationId);
  if (found.kind !== "x402_fetch" || found.strategy !== "provider_atomic") ineligible();
  return found.record as ProviderX402OperationRecord;
}

function assertEligible(context: RuntimeContext, op: ProviderX402OperationRecord): void {
  if (op.terminal || !UNRESOLVED_X402.includes(op.state) || op.settlementEvidence !== undefined ||
    op.evidenceDeadlineAt === undefined || context.clock.now().getTime() < Date.parse(op.evidenceDeadlineAt)) ineligible();
}

function usdc(value: string): string {
  const padded = value.padStart(7, "0"), fraction = padded.slice(-6).replace(/0+$/u, "");
  return fraction === "" ? padded.slice(0, -6) : `${padded.slice(0, -6)}.${fraction}`;
}

function ineligible(): never {
  throw new ApnError("APN_OPERATION_BLOCKED",
    "Only a provider x402 payment with an unproven settlement can be abandoned, and only after its evidence window has passed.");
}
