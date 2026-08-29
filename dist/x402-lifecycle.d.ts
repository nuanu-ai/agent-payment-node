import { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";
import { type PaidHttpResult } from "./x402-http.js";
import { type X402Attempt, type X402OperationRecord, type X402State, type X402TerminalState } from "./x402-state-integrity.js";
export declare class X402Lifecycle {
    protected readonly context: RuntimeContext;
    protected readonly operations: OperationService;
    constructor(context: RuntimeContext);
    protected beginPaidAttempt(operation: X402OperationRecord, purpose: "payment" | "result_recovery"): Promise<X402OperationRecord>;
    protected finishPaidAttempt(operation: X402OperationRecord, phase: "observed" | "ambiguous", observation?: X402Attempt["observation"], state?: "settlement_pending" | "effect_unknown" | "seller_result_recovery_pending", additions?: Partial<Pick<X402OperationRecord, "settlementResponseObservation" | "transactionHint">>): Promise<X402OperationRecord>;
    protected markInterruptedPaidAttempt(operation: X402OperationRecord, state: "effect_unknown" | "seller_result_recovery_pending"): Promise<X402OperationRecord>;
    protected persistAndLinkResult(operation: X402OperationRecord, result: NonNullable<PaidHttpResult["result"]>, createdAt: string): Promise<X402OperationRecord>;
    protected recoverOrphanResult(operation: X402OperationRecord): Promise<X402OperationRecord>;
    protected finishReconciledEvidence(operation: X402OperationRecord): Promise<X402OperationRecord>;
    protected recoverOrphanReceipt(operation: X402OperationRecord): Promise<X402OperationRecord | null>;
    protected commitTerminal(operation: X402OperationRecord, terminalState: X402TerminalState): Promise<X402OperationRecord>;
    protected commitTerminalOperation(operation: X402OperationRecord, terminalState: X402TerminalState, receiptIntegrityHash: string, at: string): Promise<X402OperationRecord>;
    protected transition(operation: X402OperationRecord, state: X402State, additions?: Partial<Pick<X402OperationRecord, "signatureHash" | "paymentPayloadHash" | "paymentHeaderHash" | "attempts" | "settlementResponseObservation" | "transactionHint" | "authorizationUsedScan" | "settlementEvidence" | "unusedExpiryEvidence" | "resultLink" | "receiptLink">>): Promise<X402OperationRecord>;
}
