import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { requireSwapProtocol, validateSwapProtocolRegistry } from "../protocol-registry.js";
import { GuardedSwapService } from "../service.js";
import { validateSwapOperation } from "../model.js";
import { validateEnergyBounds } from "./transaction.js";
import { validateSunSwapExecutionBinding } from "./signer.js";
/** Dormant until all authority, policy, signer, sender and observer ports are explicitly injected. */
export class SunSwapGuardedExecutor {
    dependencies;
    binding;
    constructor(dependencies, binding) {
        this.dependencies = dependencies;
        this.binding = binding;
    }
    async execute(operationValue, commandNow) {
        let now = commandNow;
        let operation = validateSwapOperation(operationValue);
        this.validateDependencies(operation);
        if (operation.state === "finalized" || operation.state === "failed_before_effect")
            return operation;
        if (operation.submissionMarker !== null)
            return await this.observeOnly(operation, now);
        if (operation.state !== "awaiting_approval" && operation.state !== "reserved")
            blocked("SunSwap is not ready for owner approval or signing.");
        if (!executionWindowLive(this.binding, now)) {
            if (operation.state === "reserved") {
                return await this.dependencies.service.failBeforeEffect(operation, now, domainHash("apn.sunswap-tron-pre-effect-failure.v1", canonicalJson({ operationId: operation.operationId,
                    txID: this.binding.transaction.txID, reason: "expired_signing_window" })));
            }
            blocked("The frozen SunSwap TAPOS, expiration or router deadline is not live for signing.");
        }
        if (operation.state === "awaiting_approval") {
            const admissionInput = ownerInput(operation, this.binding);
            const admission = await this.dependencies.ownerAdmission.admit(admissionInput);
            if (!isPlainRecord(admission) || !exactKeys(admission, ["admitted", "accountIdentityHash"]) || admission.admitted !== true ||
                admission.accountIdentityHash !== this.binding.account.identityHash)
                blocked("The exact local TRON owner is not admitted for SunSwap execution.");
            const approvalInput = foregroundInput(operation, this.binding);
            const answer = await this.dependencies.approval.approve(approvalInput);
            now = this.dependencies.clock.now();
            validateSunSwapForegroundApproval(answer, approvalInput, operation.updatedAt, now);
            if (!executionWindowLive(this.binding, now))
                blocked("The frozen SunSwap signing window closed during foreground approval.");
            operation = await this.dependencies.service.reserve(operation, this.dependencies.policy, now);
        }
        operation = await this.dependencies.service.markSubmitting(operation, now);
        const marker = operation.submissionMarker;
        if (marker === null)
            stateCorrupt();
        let signed;
        try {
            signed = await this.dependencies.signer.sign(operation);
        }
        catch {
            operation = await this.dependencies.service.recordPossibleSend(operation, "unknown_finality", now);
            return operation;
        }
        let sent;
        try {
            sent = await this.dependencies.sender.sendOnce(signed.signedMaterialHandle, marker.markerHash);
            if (sent.transactionHash !== this.binding.transaction.txID)
                throw new ApnError("APN_RPC_AMBIGUOUS", "SunSwap broadcast returned a different transaction identity.");
        }
        catch {
            operation = await this.dependencies.service.recordPossibleSend(operation, "unknown_finality", now);
            return operation;
        }
        operation = await this.dependencies.service.recordPossibleSend(operation, "submitted", now);
        return await this.observeOnly(operation, now);
    }
    async resume(operationValue, now) {
        const operation = validateSwapOperation(operationValue);
        this.validateDependencies(operation);
        if (operation.submissionMarker === null)
            blocked("SunSwap has not crossed the durable submission boundary.");
        return await this.observeOnly(operation, now);
    }
    async observeOnly(operation, now) {
        if (operation.state === "submitting") {
            operation = await this.dependencies.service.recordPossibleSend(operation, "unknown_finality", now);
        }
        let receipt;
        try {
            receipt = await this.dependencies.observer.observe(operation);
        }
        catch {
            if (operation.state === "submitted")
                return await this.dependencies.service.recordPossibleSend(operation, "unknown_finality", now);
            return operation;
        }
        if (receipt === null) {
            if (operation.state === "submitted")
                return await this.dependencies.service.recordPossibleSend(operation, "unknown_finality", now);
            return operation;
        }
        return await this.dependencies.service.finalize(operation, now, receipt);
    }
    validateDependencies(operation) {
        validateSunSwapExecutionBinding(operation, this.binding);
        const registry = validateSwapProtocolRegistry(this.dependencies.protocolRegistry);
        if (registry.registryDigest !== operation.protocolRegistryDigest || registry.registryVersion !== operation.protocolRegistryVersion) {
            blocked("The injected SunSwap protocol registry does not match the prepared operation.");
        }
        requireSwapProtocol(registry, operation.mechanismDigest);
        const cap = this.dependencies.resourceFeeCap;
        if (!isPlainRecord(cap) || !exactKeys(cap, ["maximumEnergy", "energyPriceSun", "maximumFeeLimitSun"]) ||
            cap.maximumEnergy !== this.binding.intent.maximumEnergy || cap.energyPriceSun !== this.binding.intent.energyPriceSun ||
            cap.maximumFeeLimitSun !== this.binding.intent.maximumFeeLimitSun)
            blocked("The injected SunSwap resource fee cap drifted from the signed transaction.");
        validateEnergyBounds({ ...cap, feeLimitSun: this.binding.intent.feeLimitSun });
    }
}
export function sealSunSwapForegroundApproval(input, approvedAt) {
    if (!(approvedAt instanceof Date) || !Number.isFinite(approvedAt.getTime()))
        invalid();
    const at = approvedAt.toISOString();
    return { ...input, approvedAt: at, approvalHash: domainHash("apn.sunswap-tron-foreground-approval.v1", canonicalJson({ ...input, approvedAt: at })) };
}
export function validateSunSwapForegroundApproval(value, expected, earliestAt, now) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        invalid();
    if (typeof earliestAt !== "string" || !Number.isFinite(Date.parse(earliestAt)) || new Date(earliestAt).toISOString() !== earliestAt)
        invalid();
    if (!isPlainRecord(value) || !exactKeys(value, [...Object.keys(expected), "approvedAt", "approvalHash"]) ||
        canonicalJson(Object.fromEntries(Object.keys(expected).map((key) => [key, value[key]]))) !== canonicalJson(expected) ||
        typeof value.approvedAt !== "string" || !Number.isFinite(Date.parse(value.approvedAt)) ||
        new Date(value.approvedAt).toISOString() !== value.approvedAt || value.approvedAt < earliestAt || value.approvedAt > now.toISOString() ||
        typeof value.approvalHash !== "string" || value.approvalHash !== domainHash("apn.sunswap-tron-foreground-approval.v1", canonicalJson({ ...expected, approvedAt: value.approvedAt })))
        blocked("SunSwap foreground approval does not bind the exact frozen economics and deadline.");
    return value;
}
function foregroundInput(operation, binding) {
    return { operationId: operation.operationId, profile: operation.quote.profile, account: operation.quote.account,
        recipient: operation.quote.recipient, inputAmountAtomic: operation.quote.inputAmountAtomic,
        expectedOutputAtomic: operation.quote.expectedOutputAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
        slippageBps: operation.quote.slippageBps, maximumEnergy: binding.intent.maximumEnergy,
        energyPriceSun: binding.intent.energyPriceSun, feeLimitSun: binding.intent.feeLimitSun,
        deadlineSeconds: binding.intent.deadlineSeconds, quoteHash: operation.quote.quoteHash,
        simulationRequestHash: operation.quote.simulation.requestHash, simulationResultHash: operation.quote.simulation.resultHash,
        policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest };
}
function ownerInput(operation, binding) {
    return { profile: operation.quote.profile, account: operation.quote.account, accountIdentityHash: binding.account.identityHash,
        operationId: operation.operationId, ownerProfileHash: operation.ownerProfileHash, chain: operation.quote.sourceAsset.chain };
}
function executionWindowLive(binding, now) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        invalid();
    const instant = BigInt(now.getTime());
    return BigInt(binding.intent.timestampMs) <= instant && BigInt(binding.intent.expirationMs) > instant &&
        BigInt(binding.intent.deadlineSeconds) * 1000n > instant;
}
function invalid() { throw new ApnError("APN_INVALID_INPUT", "SunSwap foreground approval time is invalid."); }
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function stateCorrupt() { throw new ApnError("APN_STATE_CORRUPT", "SunSwap durable submission marker disappeared."); }
//# sourceMappingURL=execution.js.map