import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry } from "../asset-policy-registry.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { swapMechanismDigest } from "./pin.js";
import { requireSwapProtocol, validateSwapProtocolRegistry } from "./protocol-registry.js";
import { createSwapQuote } from "./quote.js";
import { newSwapOperation, validateSwapOperation, validateSwapReceiptProof } from "./model.js";
import { SwapOperationRepository } from "./repository.js";
export class GuardedSwapService {
    operations;
    usage;
    constructor(operations, usage) {
        this.operations = operations;
        this.usage = usage;
    }
    async prepare(input) {
        if (!isPlainRecord(input) || !exactKeys(input, ["quote", "assetPolicy", "protocolRegistry", "idempotencyKey", "approvalCapAtomic", "now"])) {
            invalid("Swap preparation input is invalid.");
        }
        const quote = createSwapQuote(input.quote), at = instant(input.now), policy = validateAssetPolicyRegistry(input.assetPolicy);
        if (at < quote.effectiveAt || at >= quote.expiresAt)
            invalid("Swap quote is expired or not yet effective.");
        const admission = evaluateAssetPolicy(policy, { chain: quote.sourceAsset.chain,
            asset: quote.sourceAsset.kind === "native" ? { kind: "native", identifier: null } :
                { kind: "token", identifier: quote.sourceAsset.identifier }, rail: "swap", amountAtomic: quote.inputAmountAtomic,
            dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at });
        const pin = admission.asset.mechanismPins?.swap;
        if (pin === undefined || pin.chain !== quote.sourceAsset.chain)
            blocked("Source asset lacks the exact swap mechanism admission.");
        const mechanismDigest = swapMechanismDigest(pin);
        const destinationAdmission = evaluateAssetPolicy(policy, { chain: quote.destinationAsset.chain,
            asset: quote.destinationAsset.kind === "native" ? { kind: "native", identifier: null } :
                { kind: "token", identifier: quote.destinationAsset.identifier }, rail: "swap", amountAtomic: quote.minimumOutputAtomic,
            dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at });
        const destinationPin = destinationAdmission.asset.mechanismPins?.swap;
        if (destinationPin === undefined || swapMechanismDigest(destinationPin) !== mechanismDigest) {
            blocked("Destination asset lacks the same exact swap mechanism admission.");
        }
        const protocolRegistry = validateSwapProtocolRegistry(input.protocolRegistry);
        requireSwapProtocol(protocolRegistry, mechanismDigest);
        const idempotencyHash = idempotency(input.idempotencyKey);
        const operationId = domainHash("apn.swap-operation-id.v1", canonicalJson({ profileHash: quote.profileHash, idempotencyHash }));
        let operation = await this.operations.create(newSwapOperation({ operationId, idempotencyHash, quote,
            policyDigest: admission.policyDigest, policyVersion: admission.registryVersion, mechanismDigest,
            protocolRegistryDigest: protocolRegistry.registryDigest, protocolRegistryVersion: protocolRegistry.registryVersion,
            approvalCapAtomic: input.approvalCapAtomic, now: input.now }));
        if (operation.state === "quoted")
            operation = await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "prepared", {}, input.now);
        if (operation.state === "prepared")
            operation = await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "awaiting_approval", {}, input.now);
        return operation;
    }
    async reserve(operation, policy, now) {
        operation = validateSwapOperation(operation);
        if (operation.state !== "awaiting_approval")
            blocked("Swap is not awaiting approval.");
        const at = assertLiveQuote(operation, now), registry = validateAssetPolicyRegistry(policy);
        if (registry.policyDigest !== operation.policyDigest || registry.registryVersion !== operation.policyVersion) {
            blocked("Swap asset policy does not match the prepared operation.");
        }
        assertPolicyBindings(operation, registry, at);
        const lease = await this.usage.reserve({ account: operation.quote.account, chain: operation.quote.sourceAsset.chain,
            asset: operation.quote.sourceAsset.kind === "native" ? { kind: "native", identifier: null } :
                { kind: "token", identifier: operation.quote.sourceAsset.identifier }, registry: policy, rail: "swap",
            amountAtomic: operation.quote.inputAmountAtomic, idempotencyKey: `swap-${operation.idempotencyHash}`, now });
        return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "reserved", { usageLease: lease }, now);
    }
    async markSubmitting(operation, now) {
        operation = validateSwapOperation(operation);
        if (operation.state !== "reserved")
            blocked("Swap is not reserved for submission.");
        const markedAt = assertLiveQuote(operation, now), markerBody = { operationId: operation.operationId, operationIntegrityHash: operation.integrityHash,
            unsignedTransactionPayloadHash: operation.quote.unsignedTransactionPayloadHash, markedAt };
        return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "submitting", {
            submissionMarker: { markerHash: domainHash("apn.swap-submission-marker.v1", canonicalJson(markerBody)), markedAt,
                operationIntegrityHash: operation.integrityHash,
                unsignedTransactionPayloadHash: operation.quote.unsignedTransactionPayloadHash },
        }, now);
    }
    async recordPossibleSend(operation, state, now, receiptProof) {
        operation = validateSwapOperation(operation);
        if (state !== "submitted" && state !== "unknown_finality")
            invalid("Swap possible-send state is invalid.");
        if (operation.state !== "submitting" && operation.state !== "submitted")
            blocked("Swap has no persisted submission boundary.");
        const at = instant(now);
        const receipt = receiptProof === undefined ? undefined : validateSwapReceiptProof(receiptProof, operation.quote.sourceAsset.chain, operation.submissionMarker.markedAt, at);
        const lease = await this.usage.transition({ ...usageIdentity(operation), reservationId: operation.usageLease.reservationId,
            policyDigest: operation.policyDigest, state, now });
        return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, state, { usageLease: lease, ...(receipt === undefined ? {} : { receiptProof: receipt }) }, now);
    }
    async finalize(operation, now, receiptProof) {
        operation = validateSwapOperation(operation);
        if (operation.state !== "submitted" && operation.state !== "unknown_finality")
            blocked("Swap is not awaiting finality.");
        const at = instant(now);
        const receipt = validateSwapReceiptProof(receiptProof, operation.quote.sourceAsset.chain, operation.submissionMarker.markedAt, at);
        if (!receipt.finalized)
            invalid("Final swap receipt proof must be finalized.");
        const lease = await this.usage.transition({ ...usageIdentity(operation), reservationId: operation.usageLease.reservationId,
            policyDigest: operation.policyDigest, state: "finalized", now, outcomeDigest: receipt.receiptHash });
        return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "finalized", { usageLease: lease, receiptProof: receipt }, now);
    }
    async failBeforeEffect(operation, now, failureProofHash) {
        operation = validateSwapOperation(operation);
        if (!["quoted", "prepared", "awaiting_approval", "reserved"].includes(operation.state))
            blocked("Swap crossed the possible-send boundary.");
        let lease;
        if (operation.usageLease !== null)
            lease = await this.usage.transition({ ...usageIdentity(operation),
                reservationId: operation.usageLease.reservationId, policyDigest: operation.policyDigest,
                state: "failed_before_effect", now, outcomeDigest: failureProofHash });
        return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "failed_before_effect", { failureProofHash, ...(lease === undefined ? {} : { usageLease: lease }) }, now);
    }
    resumeDirective(operation) {
        operation = validateSwapOperation(operation);
        if (["finalized", "failed_before_effect"].includes(operation.state))
            return "terminal";
        return operation.submissionMarker === null ? "prepare_or_approve" : "observe_only";
    }
}
function usageIdentity(operation) {
    return { account: operation.quote.account, chain: operation.quote.sourceAsset.chain,
        asset: operation.quote.sourceAsset.kind === "native" ? { kind: "native", identifier: null } :
            { kind: "token", identifier: operation.quote.sourceAsset.identifier } };
}
function idempotency(value) { if (typeof value !== "string" || value.length < 8 || value.length > 256 || /[^\x21-\x7e]/u.test(value))
    invalid("Swap idempotency key is invalid."); return sha256(`swap-idempotency\0${value}`); }
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    invalid("Swap time is invalid."); return value.toISOString(); }
function assertLiveQuote(operation, now) {
    const at = instant(now);
    if (at < operation.quote.effectiveAt || at >= operation.quote.expiresAt)
        blocked("Swap quote is expired or not yet effective.");
    return at;
}
function assertPolicyBindings(operation, policy, at) {
    for (const [asset, amount] of [[operation.quote.sourceAsset, operation.quote.inputAmountAtomic],
        [operation.quote.destinationAsset, operation.quote.minimumOutputAtomic]]) {
        const admission = evaluateAssetPolicy(policy, { chain: asset.chain,
            asset: asset.kind === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: asset.identifier },
            rail: "swap", amountAtomic: amount, dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at });
        const pin = admission.asset.mechanismPins?.swap;
        if (admission.policyDigest !== operation.policyDigest || admission.registryVersion !== operation.policyVersion ||
            pin === undefined || swapMechanismDigest(pin) !== operation.mechanismDigest) {
            blocked("Swap policy or mechanism binding changed after preparation.");
        }
    }
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
//# sourceMappingURL=service.js.map