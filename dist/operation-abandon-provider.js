import { ApnError } from "./errors.js";
import { publicProviderX402Operation } from "./provider-x402-model.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import { ProviderX402Service } from "./provider-x402-service.js";
import { providerX402TerminalReceipt, transitionProviderX402Operation } from "./provider-x402-state.js";
import { publicSmartAccountGaslessOperation } from "./smart-account-gasless/receipt.js";
import { saFailure } from "./smart-account-gasless/reasons.js";
import { SmartAccountGaslessService } from "./smart-account-gasless/service.js";
import { advanceSmartAccountGaslessOperation } from "./smart-account-gasless/transitions.js";
const UNRESOLVED_X402 = ["ambiguous_effect", "settlement_pending"];
/**
 * Owner release (R4) of a provider paid request whose settlement stayed unprovable after its evidence window:
 * evidence that is not unique, mismatched or unavailable. It never pays, sends or calls the provider again.
 */
export async function abandonProviderX402(context, operations, operationId) {
    const repository = context.providerX402Repository ?? new ProviderX402Repository(context.state.root);
    const initial = await providerX402Record(operations, operationId);
    if (initial.state === "abandoned_unknown" && initial.terminal)
        return publicProviderX402Operation(initial);
    assertEligible(context, initial);
    // One last ordinary observation: evidence that has become provable closes the operation instead.
    await new ProviderX402Service(context).resume(operationId).catch(() => undefined);
    return await context.state.withLocks([`profile:${initial.profileHash}`,
        `provider-account:${initial.provider.providerId}:${initial.provider.accountBindingHash}`,
        `operation:${operationId}`, `operation:evidence:${operationId}`], async () => {
        const op = await repository.loadOperation(initial.profileHash, operationId);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        if (op.terminal)
            return publicProviderX402Operation(op);
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
const EXPOSED_SA = ["exposure_pending", "verified_pending", "dispatch_pending", "submitted_pending", "unknown_finality"];
/**
 * Owner release (R4) of an exposed Smart Account gasless transfer that stayed unproven after its child delegation
 * expired on chain (for example several candidate redemptions). The expired child can no longer be redeemed.
 */
export async function abandonSmartAccountGasless(context, operations, operationId) {
    const initial = await smartAccountRecord(operations, operationId);
    if (initial.state === "abandoned_unknown" && initial.terminal)
        return publicSmartAccountGaslessOperation(initial);
    assertSmartAccountExpired(context, initial);
    const service = new SmartAccountGaslessService(context);
    // One last ordinary observation: a completion or an unused proof closes the operation instead.
    await service.resume(operationId).catch(() => undefined);
    return await context.state.withLocks([`profile:${initial.profileHash}`, `operation:${operationId}`], async () => {
        const op = await smartAccountRecord(operations, operationId);
        if (op.terminal)
            return publicSmartAccountGaslessOperation(op);
        assertSmartAccountExpired(context, op);
        const i = op.intent;
        await context.requireOperationAbandonApproval().approve({ operationId, fingerprint: op.fingerprint, profile: i.profile,
            providerId: "metamask-smart-account", walletAddress: i.binding.ownerAddress, recipient: i.request.recipient,
            amountAtomic: i.request.grossAtomic, amountDecimal: usdc(i.request.grossAtomic), chainLabel: "Base (8453)",
            assetLabel: `USDC (${i.token})`, unit: "USDC",
            outcomeNote: "Financial outcome: UNKNOWN. The child delegation has expired on chain, but APN could not prove whether it was redeemed before then." });
        const next = advanceSmartAccountGaslessOperation(op, { state: "abandoned_unknown", failure: saFailure("sa_gasless_owner_abandoned") }, context.clock.now().toISOString());
        await service.records.persist(next);
        return publicSmartAccountGaslessOperation(next);
    });
}
async function smartAccountRecord(operations, operationId) {
    const found = await operations.required(operationId);
    if (found.kind !== "smart_account_gasless_transfer")
        ineligible();
    return found.record;
}
function assertSmartAccountExpired(context, op) {
    if (op.terminal || !EXPOSED_SA.includes(op.state) || op.settlement !== null ||
        context.clock.now().getTime() < Date.parse(op.intent.expiresAt)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Only an exposed Smart Account gasless transfer with an unproven outcome can be abandoned, and only after its child delegation expired.");
    }
}
async function providerX402Record(operations, operationId) {
    const found = await operations.required(operationId);
    if (found.kind !== "x402_fetch" || found.strategy !== "provider_atomic")
        ineligible();
    return found.record;
}
function assertEligible(context, op) {
    if (op.terminal || !UNRESOLVED_X402.includes(op.state) || op.settlementEvidence !== undefined ||
        op.evidenceDeadlineAt === undefined || context.clock.now().getTime() < Date.parse(op.evidenceDeadlineAt))
        ineligible();
}
function usdc(value) {
    const padded = value.padStart(7, "0"), fraction = padded.slice(-6).replace(/0+$/u, "");
    return fraction === "" ? padded.slice(0, -6) : `${padded.slice(0, -6)}.${fraction}`;
}
function ineligible() {
    throw new ApnError("APN_OPERATION_BLOCKED", "Only a provider x402 payment with an unproven settlement can be abandoned, and only after its evidence window has passed.");
}
//# sourceMappingURL=operation-abandon-provider.js.map