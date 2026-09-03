import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import { appendX402Transition, sealX402Operation, sealX402Receipt, sealX402Result, x402OperationBindingHash, } from "./x402-state-integrity.js";
import { settlementResponseTransaction, terminalClassification } from "./x402-service-rpc.js";
export class X402Lifecycle {
    context;
    operations;
    constructor(context) {
        this.context = context;
        this.operations = new OperationService(context.state);
    }
    async beginPaidAttempt(operation, purpose) {
        if (purpose === "result_recovery" && operation.attempts.some((attempt) => attempt.purpose === "result_recovery")) {
            throw new ApnError("APN_STATE_CORRUPT", "A second x402 result recovery attempt is forbidden.");
        }
        const at = this.context.clock.now().toISOString();
        const attempt = {
            attemptNumber: (BigInt(operation.attempts.length) + 1n).toString(),
            purpose,
            phase: "pending",
            requestHeaderHash: operation.paymentHeaderHash,
            persistedAt: at,
        };
        return await this.transition(operation, purpose === "payment" ? "paid_request_pending" : "seller_result_recovery_pending", { attempts: [...operation.attempts, attempt] });
    }
    async finishPaidAttempt(operation, phase, observation, state = "effect_unknown", additions = {}) {
        const last = operation.attempts.at(-1);
        if (last?.phase !== "pending")
            throw new ApnError("APN_STATE_CORRUPT", "Paid attempt marker is missing.");
        const attempts = operation.attempts.map((attempt, index) => index === operation.attempts.length - 1
            ? { ...attempt, phase, ...(observation === undefined ? {} : { observation }) }
            : attempt);
        return await this.transition(operation, state, { attempts, ...additions });
    }
    async markInterruptedPaidAttempt(operation, state) {
        return await this.finishPaidAttempt(operation, "ambiguous", undefined, state);
    }
    async persistAndLinkResult(operation, result, createdAt) {
        const candidate = sealX402Result({
            schemaVersion: "apn.x402.result.v1",
            operationId: operation.operationId,
            mediaType: result.mediaType,
            bodyEncoding: "utf8",
            bodyText: result.bodyText,
            resultHash: result.resultHash,
            byteLength: result.byteLength,
            responseStatus: "200",
            createdAt,
        });
        const existing = await this.context.state.loadX402RecoveryResult(operation.profileHash, operation.operationId);
        const durable = existing ?? candidate;
        if (existing !== null && canonicalJson(existing) !== canonicalJson(candidate)) {
            throw new ApnError("APN_STATE_CORRUPT", "Recovered x402 result differs from the observed response.");
        }
        if (existing === null)
            await this.context.state.writeX402Result(operation.profileHash, candidate);
        return await this.transition(operation, operation.state, {
            resultLink: { resultHash: durable.resultHash, resultIntegrityHash: durable.integrityHash },
        });
    }
    async recoverOrphanResult(operation) {
        if (operation.resultLink !== undefined)
            return operation;
        const result = await this.context.state.loadX402RecoveryResult(operation.profileHash, operation.operationId);
        if (result === null)
            return operation;
        const response = operation.settlementResponseObservation;
        const attemptIndex = Number(response?.httpAttemptNumber ?? "0") - 1;
        const attempt = Number.isSafeInteger(attemptIndex) && attemptIndex >= 0
            ? operation.attempts[attemptIndex]
            : undefined;
        if (response?.classification !== "success" || attempt?.phase !== "observed" ||
            attempt.observation?.status !== "200" || attempt.observation.bodyHash !== result.resultHash ||
            attempt.observation.bodyByteLength !== result.byteLength || attempt.observation.mediaType !== result.mediaType)
            throw new ApnError("APN_STATE_CORRUPT", "Recovered x402 result lacks its designated successful response.");
        return await this.transition(operation, operation.state, {
            resultLink: { resultHash: result.resultHash, resultIntegrityHash: result.integrityHash },
        });
    }
    async finishReconciledEvidence(operation) {
        if (operation.unusedExpiryEvidence !== undefined) {
            return await this.commitTerminal(operation, "failed_expired_unused");
        }
        if (operation.settlementEvidence === undefined)
            return operation;
        if (operation.settlementResponseObservation !== undefined &&
            settlementResponseTransaction(operation.settlementResponseObservation) !== operation.settlementEvidence.transactionHash)
            return operation;
        if (operation.resultLink !== undefined)
            return await this.commitTerminal(operation, "completed");
        const recoveryAttempt = operation.attempts.find((attempt) => attempt.purpose === "result_recovery");
        if (operation.paymentIdentifier !== undefined && recoveryAttempt === undefined) {
            return operation.state === "seller_result_recovery_pending"
                ? operation
                : await this.transition(operation, "seller_result_recovery_pending");
        }
        if (operation.paymentIdentifier !== undefined && recoveryAttempt?.phase === "pending")
            return operation;
        return await this.commitTerminal(operation, "failed_settled_without_result");
    }
    async recoverOrphanReceipt(operation) {
        const receipt = await this.context.state.loadX402RecoveryReceipt(operation.profileHash, operation.operationId);
        if (receipt === null)
            return null;
        return await this.commitTerminalOperation(operation, receipt.terminalState, receipt.integrityHash, receipt.createdAt);
    }
    async commitTerminal(operation, terminalState) {
        const orphan = await this.context.state.loadX402RecoveryReceipt(operation.profileHash, operation.operationId);
        if (orphan !== null) {
            if (orphan.terminalState !== terminalState)
                throw new ApnError("APN_STATE_CORRUPT", "Orphan x402 receipt has a conflicting terminal state.");
            return await this.commitTerminalOperation(operation, terminalState, orphan.integrityHash, orphan.createdAt);
        }
        const result = operation.resultLink === undefined
            ? null
            : await this.context.state.loadX402Result(operation.profileHash, operation.operationId);
        if (operation.resultLink !== undefined && result === null)
            throw new ApnError("APN_STATE_CORRUPT", "Terminal x402 result link is dangling.");
        const at = this.context.clock.now().toISOString();
        const classification = terminalClassification(terminalState);
        const receipt = sealX402Receipt({
            schemaVersion: "apn.x402.receipt.v1",
            kind: "x402_fetch",
            operationId: operation.operationId,
            terminalState,
            reason: classification.reason,
            proofClass: classification.proofClass,
            resource: {
                origin: operation.resource.origin,
                path: operation.resource.path,
                urlHash: operation.resource.urlHash,
            },
            fingerprint: operation.fingerprint,
            offerHash: operation.selectedOffer.offerHash,
            payer: operation.wallet,
            payee: operation.payee,
            amountAtomic: operation.amountAtomic,
            network: operation.network,
            token: operation.token,
            transferMethod: operation.selectedOffer.resolved.assetTransferMethod,
            ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
            ...(operation.settlementResponseObservation === undefined ? {} : {
                settlementResponseHash: operation.settlementResponseObservation.settlementResponseHash,
            }),
            ...(operation.settlementEvidence === undefined ? {} : { settlementEvidence: operation.settlementEvidence }),
            ...(operation.unusedExpiryEvidence === undefined ? {} : { unusedExpiryEvidence: operation.unusedExpiryEvidence }),
            ...(result === null ? {} : {
                result: {
                    resultHash: result.resultHash,
                    mediaType: result.mediaType,
                    byteLength: result.byteLength,
                    resultIntegrityHash: result.integrityHash,
                },
            }),
            operationBindingHash: x402OperationBindingHash(operation),
            previousLinkHash: operation.transitions.at(-1)?.hash,
            createdAt: at,
        });
        await this.context.state.writeX402Receipt(operation.profileHash, receipt);
        return await this.commitTerminalOperation(operation, terminalState, receipt.integrityHash, at);
    }
    async commitTerminalOperation(operation, terminalState, receiptIntegrityHash, at) {
        const classification = terminalClassification(terminalState);
        const { integrityHash: _integrityHash, ...withoutIntegrity } = operation;
        const terminal = sealX402Operation({
            ...withoutIntegrity,
            receiptLink: { receiptIntegrityHash },
            state: terminalState,
            finalityClass: "terminal",
            terminal: true,
            reason: classification.reason,
            proofClass: classification.proofClass,
            nextActions: ["receipt.get"],
            updatedAt: at,
            transitions: appendX402Transition(operation.transitions, {
                at,
                state: terminalState,
                terminal: true,
                reason: classification.reason,
                proofClass: classification.proofClass,
            }),
        });
        await this.context.state.writeX402Operation(terminal);
        return terminal;
    }
    async transition(operation, state, additions = {}) {
        const at = this.context.clock.now().toISOString();
        const { integrityHash: _previousIntegrityHash, ...operationWithoutIntegrity } = operation;
        const classification = state === "authorization_material_pending" ? {
            reason: "x402_authorization_material_pending",
            proofClass: "x402_authorization_recovery",
            finalityClass: "pre_effect",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "authorized_not_sent" ? {
            reason: "x402_authorized_not_sent",
            proofClass: "x402_authorization_verified",
            finalityClass: "pre_effect",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "paid_request_pending" ? {
            reason: "x402_paid_request_pending",
            proofClass: "x402_unknown_finality",
            finalityClass: "unknown_finality",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "settlement_pending" ? {
            reason: "x402_settlement_pending",
            proofClass: "x402_unknown_finality",
            finalityClass: "unknown_finality",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "effect_unknown" ? {
            reason: "x402_effect_unknown",
            proofClass: "x402_unknown_finality",
            finalityClass: "unknown_finality",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "seller_result_recovery_pending" ? {
            reason: "x402_seller_result_recovery_pending",
            proofClass: "x402_settlement_verified_result_pending",
            finalityClass: "known_settled",
            nextActions: ["operation.resume", "operation.status"],
        } : undefined;
        if (classification === undefined)
            throw new ApnError("APN_INTERNAL", "Unsupported x402 transition requested.");
        const next = sealX402Operation({
            ...operationWithoutIntegrity,
            ...additions,
            state,
            finalityClass: classification.finalityClass,
            terminal: false,
            reason: classification.reason,
            proofClass: classification.proofClass,
            nextActions: classification.nextActions,
            updatedAt: at,
            transitions: appendX402Transition(operation.transitions, {
                at,
                state,
                terminal: false,
                reason: classification.reason,
                proofClass: classification.proofClass,
            }),
        });
        await this.context.state.writeX402Operation(next);
        return next;
    }
}
//# sourceMappingURL=x402-lifecycle.js.map