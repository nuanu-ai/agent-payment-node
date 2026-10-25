import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry } from "../asset-policy-registry.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { validateSwapProtocolRegistry } from "./protocol-registry.js";
import { admittedSwapProtocol, swapAdmissionMechanisms } from "./route-admission.js";
import { createSwapQuote } from "./quote.js";
import { newSwapOperation, SWAP_TERMINAL_STATES, validateSwapOperation, validateSwapReceiptProof } from "./model.js";
import { SwapOperationRepository } from "./repository.js";
import { isOrcaStableGuardedMechanismDigest } from "../legacy/orca-stable/mechanism.js";
import { swapUnlandedProofHash, validateSwapUnlandedProof } from "./unlanded.js";
import { isIdempotencyKey } from "../idempotency-key-contract.js";
export class GuardedSwapService {
    operations;
    usage;
    constructor(operations, usage) {
        this.operations = operations;
        this.usage = usage;
    }
    async prepare(input) {
        if (!isPlainRecord(input) || !exactKeys(input, ["quote", "assetPolicy", "protocolRegistry", "idempotencyKey", "approvalCapAtomic", "now",
            ...(input.laneMechanismDigest === undefined ? [] : ["laneMechanismDigest"])])) {
            invalid("Swap preparation input is invalid.");
        }
        const quote = createSwapQuote(input.quote), at = instant(input.now), policy = validateAssetPolicyRegistry(input.assetPolicy);
        if (at < quote.effectiveAt || at >= quote.expiresAt)
            invalid("Swap quote is expired or not yet effective.");
        const admission = evaluateAssetPolicy(policy, { chain: quote.sourceAsset.chain,
            asset: quote.sourceAsset.kind === "native" ? { kind: "native", identifier: null } :
                { kind: "token", identifier: quote.sourceAsset.identifier }, rail: "swap", amountAtomic: quote.inputAmountAtomic,
            dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at });
        const destinationAdmission = evaluateAssetPolicy(policy, { chain: quote.destinationAsset.chain,
            asset: quote.destinationAsset.kind === "native" ? { kind: "native", identifier: null } :
                { kind: "token", identifier: quote.destinationAsset.identifier }, rail: "swap", amountAtomic: quote.minimumOutputAtomic,
            dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at });
        // Both assets must admit the installed lane's route (protocol, router, pools); its internal version is APN's own.
        const protocolRegistry = validateSwapProtocolRegistry(input.protocolRegistry);
        const mechanismDigest = admittedSwapProtocol(protocolRegistry, quote.sourceAsset.chain, admission.asset, destinationAdmission.asset, input.laneMechanismDigest).mechanismDigest;
        const idempotencyHash = swapIdempotencyHash(input.idempotencyKey);
        const operationId = preparedSwapOperationId(quote.profile, input.idempotencyKey);
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
        if (isOrcaStableGuardedMechanismDigest(operation.mechanismDigest))
            blocked("The guarded stable Orca route has no submission capability.");
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
    /** A finalized reverted receipt proves the input never left; only gas was spent. The principal lease is released. */
    async failConfirmedRevert(operation, now, revertProof) {
        operation = validateSwapOperation(operation);
        if (operation.state !== "submitted" && operation.state !== "unknown_finality")
            blocked("Swap is not awaiting finality.");
        const at = instant(now);
        const proof = validateSwapReceiptProof(revertProof, operation.quote.sourceAsset.chain, operation.submissionMarker.markedAt, at);
        if (!proof.finalized)
            invalid("Confirmed swap revert proof must be finalized.");
        const lease = await this.usage.transition({ ...usageIdentity(operation), reservationId: operation.usageLease.reservationId,
            policyDigest: operation.policyDigest, state: "failed_confirmed_revert", now, outcomeDigest: proof.receiptHash });
        return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "failed_confirmed_revert", { usageLease: lease, receiptProof: proof, failureProofHash: proof.receiptHash }, now);
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
    /**
     * The chain proved the marked effect can never land: its lifetime, deadline or expiration passed at finality with no
     * inclusion. The principal lease is released and the operation is terminal. Nothing is re-signed or resent.
     */
    async expireUnlanded(operation, now, proof) {
        operation = validateSwapOperation(operation);
        if (!["submitting", "submitted", "unknown_finality"].includes(operation.state) || operation.submissionMarker === null ||
            operation.receiptProof !== null || operation.usageLease === null)
            blocked("Swap has no unlanded effect to expire.");
        instant(now);
        const proofHash = swapUnlandedProofHash(operation, validateSwapUnlandedProof(proof, operation.quote.sourceAsset.chain));
        if (operation.state !== "unknown_finality")
            operation = await this.recordPossibleSend(operation, "unknown_finality", now);
        const lease = await this.usage.transition({ ...usageIdentity(operation), reservationId: operation.usageLease.reservationId,
            policyDigest: operation.policyDigest, state: "released_unsubmitted", now, outcomeDigest: proofHash });
        return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "expired_unlanded", { usageLease: lease, failureProofHash: proofHash }, now);
    }
    /**
     * Owner exit when no chain proof is possible: the marked swap's outcome stays unknown, so its input stays charged as
     * spent (the lease finalizes) and the operation is terminal. Nothing is signed or sent.
     */
    async abandonUnknown(operation, now, acknowledgementDigest) {
        operation = validateSwapOperation(operation);
        if (!["submitting", "submitted", "unknown_finality"].includes(operation.state) || operation.submissionMarker === null ||
            operation.receiptProof !== null || operation.usageLease === null)
            blocked("Swap has no unknown effect to abandon.");
        instant(now);
        if (operation.state !== "unknown_finality")
            operation = await this.recordPossibleSend(operation, "unknown_finality", now);
        const lease = await this.usage.transition({ ...usageIdentity(operation), reservationId: operation.usageLease.reservationId,
            policyDigest: operation.policyDigest, state: "finalized", now, outcomeDigest: acknowledgementDigest });
        return await this.operations.transition(operation.ownerProfileHash, operation.operationId, operation.integrityHash, "abandoned_unknown", { usageLease: lease, failureProofHash: acknowledgementDigest }, now);
    }
    resumeDirective(operation) {
        operation = validateSwapOperation(operation);
        if (SWAP_TERMINAL_STATES.includes(operation.state))
            return "terminal";
        return operation.submissionMarker === null ? "prepare_or_approve" : "observe_only";
    }
}
function usageIdentity(operation) {
    return { account: operation.quote.account, chain: operation.quote.sourceAsset.chain,
        asset: operation.quote.sourceAsset.kind === "native" ? { kind: "native", identifier: null } :
            { kind: "token", identifier: operation.quote.sourceAsset.identifier } };
}
export function swapIdempotencyHash(value) { if (!isIdempotencyKey(value, 200))
    invalid("Swap idempotency key is invalid."); return sha256(`swap-idempotency\0${value}`); }
export function preparedSwapOperationId(profile, idempotencyKey) {
    const profileHash = domainHash("apn.swap-quote.v1", `profile\0${profile}`);
    return domainHash("apn.swap-operation-id.v1", canonicalJson({ profileHash, idempotencyHash: swapIdempotencyHash(idempotencyKey) }));
}
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
        // The policy digest equals the one that selected operation.mechanismDigest at preparation, so the same route admission
        // still holds; the runtime re-checks the exact lane route against its installed registry before consent and sending.
        if (admission.policyDigest !== operation.policyDigest || admission.registryVersion !== operation.policyVersion ||
            swapAdmissionMechanisms(admission.asset).length === 0) {
            blocked("Swap policy or mechanism binding changed after preparation.");
        }
    }
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
//# sourceMappingURL=service.js.map