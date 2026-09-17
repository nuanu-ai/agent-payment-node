import { canonicalJson, domainHash, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry, type AssetPolicyRegistry } from "../asset-policy-registry.js";
import { AssetUsageLedger, type AssetUsageReservation } from "../asset-usage-ledger.js";
import { swapMechanismDigest } from "./pin.js";
import { requireSwapProtocol } from "./protocol-registry.js";
import { createSwapQuote, type SwapQuoteInput } from "./quote.js";
import { newSwapOperation, type SwapOperationRecord, type SwapReceiptProof } from "./model.js";
import { SwapOperationRepository } from "./repository.js";

export class GuardedSwapService {
  constructor(readonly operations: SwapOperationRepository, readonly usage: AssetUsageLedger) {}

  async prepare(input: { readonly quote: SwapQuoteInput; readonly assetPolicy: unknown; readonly protocolRegistry: unknown;
    readonly idempotencyKey: string; readonly approvalCapAtomic: string; readonly now: Date }): Promise<SwapOperationRecord> {
    const quote = createSwapQuote(input.quote), at = instant(input.now), policy = validateAssetPolicyRegistry(input.assetPolicy);
    if (at < quote.effectiveAt || at >= quote.expiresAt) invalid("Swap quote is expired or not yet effective.");
    const admission = evaluateAssetPolicy(policy, { chain: quote.sourceAsset.chain,
      asset: quote.sourceAsset.kind === "native" ? { kind: "native", identifier: null } :
        { kind: "token", identifier: quote.sourceAsset.identifier! }, rail: "swap", amountAtomic: quote.inputAmountAtomic,
      dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at });
    const pin = admission.asset.mechanismPins?.swap;
    if (pin === undefined || pin.chain !== quote.sourceAsset.chain) blocked("Source asset lacks the exact swap mechanism admission.");
    const mechanismDigest = swapMechanismDigest(pin); requireSwapProtocol(input.protocolRegistry, mechanismDigest);
    const idempotencyHash = idempotency(input.idempotencyKey);
    const operationId = domainHash("apn.swap-operation-id.v1", canonicalJson({ profileHash: quote.profileHash, idempotencyHash }));
    let operation = await this.operations.create(newSwapOperation({ operationId, idempotencyHash, quote,
      policyDigest: admission.policyDigest, policyVersion: admission.registryVersion, mechanismDigest,
      approvalCapAtomic: input.approvalCapAtomic, now: input.now }));
    if (operation.state === "quoted") operation = await this.operations.transition(operation.ownerProfileHash, operation.operationId,
      operation.integrityHash, "prepared", {}, input.now);
    if (operation.state === "prepared") operation = await this.operations.transition(operation.ownerProfileHash, operation.operationId,
      operation.integrityHash, "awaiting_approval", {}, input.now);
    return operation;
  }

  async reserve(operation: SwapOperationRecord, policy: AssetPolicyRegistry, now: Date): Promise<SwapOperationRecord> {
    if (operation.state !== "awaiting_approval") blocked("Swap is not awaiting approval.");
    const lease = await this.usage.reserve({ account: operation.quote.account, chain: operation.quote.sourceAsset.chain,
      asset: operation.quote.sourceAsset.kind === "native" ? { kind: "native", identifier: null } :
        { kind: "token", identifier: operation.quote.sourceAsset.identifier! }, registry: policy, rail: "swap",
      amountAtomic: operation.quote.inputAmountAtomic, idempotencyKey: `swap-${operation.idempotencyHash}`, now });
    return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "reserved", { usageLease: lease }, now);
  }

  async markSubmitting(operation: SwapOperationRecord, now: Date): Promise<SwapOperationRecord> {
    if (operation.state !== "reserved") blocked("Swap is not reserved for submission.");
    const markedAt = instant(now), markerBody = { operationId: operation.operationId, operationIntegrityHash: operation.integrityHash,
      unsignedTransactionPayloadHash: operation.quote.unsignedTransactionPayloadHash, markedAt };
    return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "submitting", {
      submissionMarker: { markerHash: domainHash("apn.swap-submission-marker.v1", canonicalJson(markerBody)), markedAt,
        unsignedTransactionPayloadHash: operation.quote.unsignedTransactionPayloadHash },
    }, now);
  }

  async recordPossibleSend(operation: SwapOperationRecord, state: "submitted" | "unknown_finality",
    now: Date, receiptProof?: SwapReceiptProof): Promise<SwapOperationRecord> {
    if (operation.state !== "submitting" && operation.state !== "submitted") blocked("Swap has no persisted submission boundary.");
    const lease = await this.usage.transition({ ...usageIdentity(operation), reservationId: operation.usageLease!.reservationId,
      policyDigest: operation.policyDigest, state, now });
    return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, state,
      { usageLease: lease, ...(receiptProof === undefined ? {} : { receiptProof }) }, now);
  }

  async finalize(operation: SwapOperationRecord, now: Date, receiptProof: SwapReceiptProof): Promise<SwapOperationRecord> {
    if (operation.state !== "submitted" && operation.state !== "unknown_finality") blocked("Swap is not awaiting finality.");
    const lease = await this.usage.transition({ ...usageIdentity(operation), reservationId: operation.usageLease!.reservationId,
      policyDigest: operation.policyDigest, state: "finalized", now, outcomeDigest: receiptProof.receiptHash });
    return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "finalized",
      { usageLease: lease, receiptProof }, now);
  }

  async failBeforeEffect(operation: SwapOperationRecord, now: Date, failureProofHash: string): Promise<SwapOperationRecord> {
    if (!["quoted", "prepared", "awaiting_approval", "reserved"].includes(operation.state)) blocked("Swap crossed the possible-send boundary.");
    let lease: AssetUsageReservation | undefined;
    if (operation.usageLease !== null) lease = await this.usage.transition({ ...usageIdentity(operation),
      reservationId: operation.usageLease.reservationId, policyDigest: operation.policyDigest,
      state: "failed_before_effect", now, outcomeDigest: failureProofHash });
    return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash,
      "failed_before_effect", { failureProofHash, ...(lease === undefined ? {} : { usageLease: lease }) }, now);
  }

  resumeDirective(operation: SwapOperationRecord): "prepare_or_approve" | "observe_only" | "terminal" {
    if (["finalized", "failed_before_effect"].includes(operation.state)) return "terminal";
    return operation.submissionMarker === null ? "prepare_or_approve" : "observe_only";
  }
}

function usageIdentity(operation: SwapOperationRecord) { return { account: operation.quote.account, chain: operation.quote.sourceAsset.chain,
  asset: operation.quote.sourceAsset.kind === "native" ? { kind: "native" as const, identifier: null } :
    { kind: "token" as const, identifier: operation.quote.sourceAsset.identifier! } }; }
function idempotency(value: unknown): string { if (typeof value !== "string" || value.length < 8 || value.length > 256 || /[^\x21-\x7e]/u.test(value)) invalid("Swap idempotency key is invalid."); return sha256(`swap-idempotency\0${value}`); }
function instant(value: Date): string { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid("Swap time is invalid."); return value.toISOString(); }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
