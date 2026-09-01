import { hashObject } from "./canonical.js";
import { ApnError } from "./errors.js";
import {} from "./provider-x402-model.js";
import { providerX402SettledWithoutResultProof } from "./provider-x402-proof.js";
import { ProviderX402Repository } from "./provider-x402-repository.js";
import { providerX402TerminalReceipt, transitionProviderX402Operation } from "./provider-x402-state.js";
import { recoveryMaterialDigest } from "./provider-x402-transaction-binding.js";
import { BaseExactTransactionEvidence } from "./provider-x402-transaction-evidence.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
export class ProviderX402TransactionRecoveryService {
    context;
    repository;
    constructor(context) {
        this.context = context;
        this.repository = context.providerX402Repository ?? new ProviderX402Repository(context.state.root);
    }
    async recover(request) {
        const operationId = canonicalOperationId(request.operationId);
        const transactionHash = canonicalTransactionHash(request.transactionHash);
        const key = canonicalIdempotencyKey(request.idempotencyKey);
        const idempotencyDigest = this.context.state.idempotencyHash(key);
        const materialDigest = recoveryMaterialDigest({ operationId, transactionHash, idempotencyDigest });
        this.context.requireRpcUrl();
        await this.context.ready();
        const found = await this.repository.findOperation(operationId);
        if (found === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        return await this.context.state.withLocks([
            `profile:${found.profileHash}`,
            `operation:${operationId}`,
            `operation:evidence:${operationId}`,
            `operation:recovery-idempotency:${idempotencyDigest}`,
            `operation:transaction:8453:${transactionHash}`,
            "operation:recovery-reservations",
        ], async () => {
            let operation = await this.requiredOperation(found.profileHash, operationId);
            this.assertCompatible(operation, transactionHash, idempotencyDigest, materialDigest);
            if (operation.terminal)
                return await this.projectCommitted(operation);
            const reservation = await this.repository.reserveTransactionRecovery({
                operationId,
                profileHash: operation.profileHash,
                transactionHash,
                idempotencyDigest,
                materialDigest,
                createdAt: this.context.clock.now().toISOString(),
            });
            if (operation.transactionRecovery === undefined) {
                const binding = sealRecoveryBinding({
                    schemaVersion: "apn.provider-x402.transaction-recovery.v1",
                    operationId,
                    chainId: "8453",
                    transactionHash,
                    evidenceMode: "exact_transaction",
                    idempotencyDigest,
                    materialDigest,
                    stage: "bound",
                    createdAt: reservation.createdAt,
                    updatedAt: reservation.createdAt,
                });
                operation = await this.persistTransition(operation, operation.state, operation.reason, operation.proofClass, {
                    transactionRecovery: binding,
                }, reservation.createdAt);
            }
            if (operation.transactionRecovery?.stage === "bound") {
                const evidence = await this.evidence().observe({
                    chainId: "8453",
                    transactionHash,
                    token: operation.requirement.token,
                    payer: operation.provider.payer,
                    payee: operation.requirement.payee,
                    amountAtomic: operation.requirement.amountAtomic,
                    rpcOriginHash: operation.rpcOriginHash,
                });
                const at = this.context.clock.now().toISOString();
                const binding = sealRecoveryBinding({
                    ...withoutIntegrity(operation.transactionRecovery),
                    stage: "evidence_validated",
                    evidenceDigest: evidence.evidenceHash,
                    updatedAt: at,
                });
                operation = await this.persistTransition(operation, "ambiguous_effect", "seller_result_missing", "x402_unknown_finality", { transactionRecovery: binding, settlementEvidence: evidence }, at);
            }
            if (operation.settlementEvidence?.schemaVersion !== "apn.provider-x402.transaction-settlement.v1") {
                throw new ApnError("APN_OPERATION_BLOCKED", "The recovery operation has no validated exact-transaction evidence.");
            }
            const proofClass = providerX402SettledWithoutResultProof(operation.settlementEvidence);
            if (proofClass !== "confirmed_exact_transaction_settlement_without_seller_result") {
                throw new ApnError("APN_STATE_CORRUPT", "Exact transaction recovery selected an invalid proof class.");
            }
            const at = this.context.clock.now().toISOString();
            const receipt = providerX402TerminalReceipt(operation, "failed_settled_without_result", "seller_result_missing", proofClass, at);
            await this.repository.writeReceipt(operation.profileHash, receipt);
            operation = await this.persistTransition(operation, "failed_settled_without_result", "seller_result_missing", proofClass, {}, at);
            return projection(operation, receipt);
        });
    }
    evidence() {
        return this.context.providerTransactionEvidence ?? new BaseExactTransactionEvidence(this.context.requireRpc());
    }
    async requiredOperation(profileHash, operationId) {
        const operation = await this.repository.loadOperation(profileHash, operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        return operation;
    }
    assertCompatible(operation, transactionHash, idempotencyDigest, materialDigest) {
        const binding = operation.transactionRecovery;
        if (binding !== undefined && (binding.transactionHash !== transactionHash || binding.idempotencyDigest !== idempotencyDigest ||
            binding.materialDigest !== materialDigest))
            throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Recovery input conflicts with the durable operation binding.");
        if (operation.terminal) {
            if (operation.state !== "failed_settled_without_result" || operation.sellerResult !== undefined ||
                operation.settlementEvidence?.schemaVersion !== "apn.provider-x402.transaction-settlement.v1" ||
                binding?.stage !== "evidence_validated")
                throw new ApnError("APN_OPERATION_BLOCKED", "Terminal operation truth contradicts exact transaction recovery.");
            return;
        }
        if (operation.state !== "ambiguous_effect" || operation.sellerResult !== undefined ||
            operation.immutableUpperBlock !== undefined ||
            (operation.settlementEvidence !== undefined && operation.settlementEvidence.schemaVersion !== "apn.provider-x402.transaction-settlement.v1") ||
            (binding === undefined && ![
                "provider_evidence_capability_gap", "provider_result_invalid",
            ].includes(operation.reason)))
            throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not eligible for exact-transaction recovery.");
    }
    async projectCommitted(operation) {
        const receipt = await this.repository.loadReceipt(operation.profileHash, operation.operationId);
        if (receipt === null)
            throw new ApnError("APN_STATE_CORRUPT", "Terminal recovery receipt is missing.");
        return projection(operation, receipt);
    }
    async persistTransition(operation, state, reason, proofClass, extra, at) {
        const updated = transitionProviderX402Operation(operation, state, reason, proofClass, extra, at);
        await this.repository.writeOperation(updated);
        return updated;
    }
}
function canonicalTransactionHash(value) {
    if (!/^0x[0-9a-fA-F]{64}$/u.test(value) || /^0x0{64}$/iu.test(value)) {
        throw new ApnError("APN_INVALID_INPUT", "Transaction hash must be one nonzero 32-byte EVM hash.");
    }
    return value.toLowerCase();
}
function sealRecoveryBinding(value) {
    return { ...value, integrityHash: hashObject(value) };
}
function withoutIntegrity(value) {
    const { integrityHash: _integrityHash, ...base } = value;
    return base;
}
function projection(operation, receipt) {
    const evidence = operation.settlementEvidence;
    if (operation.state !== "failed_settled_without_result" || operation.reason !== "seller_result_missing" ||
        operation.proofClass !== "confirmed_exact_transaction_settlement_without_seller_result" ||
        evidence?.schemaVersion !== "apn.provider-x402.transaction-settlement.v1" ||
        receipt.terminalState !== operation.state || receipt.proofClass !== operation.proofClass)
        throw new ApnError("APN_STATE_CORRUPT", "Exact transaction recovery projection is inconsistent.");
    return {
        operation: {
            operationId: operation.operationId,
            state: operation.state,
            reason: operation.reason,
            proofClass: operation.proofClass,
            transactionHash: evidence.transactionHash,
            terminal: true,
            createdAt: operation.createdAt,
            updatedAt: operation.updatedAt,
            nextActions: ["receipt.get"],
        },
        receipt: {
            operationId: receipt.operationId,
            terminalState: receipt.terminalState,
            reason: "seller_result_missing",
            proofClass: "confirmed_exact_transaction_settlement_without_seller_result",
            transactionHash: evidence.transactionHash,
            receiptIntegrity: receipt.integrityHash,
            createdAt: receipt.createdAt,
        },
    };
}
//# sourceMappingURL=provider-x402-transaction-recovery.js.map