import { type AuthorizationUsedScan, type SettlementEvidence, type SettlementResponseObservation, type TransactionHint, type UnusedExpiryEvidence, type X402Attempt, type X402OperationRecord, type X402Transition } from "./x402-state-model.js";
export { legalNextState, validateStateTuple } from "./x402-state-shape.js";
export declare function validateX402OperationUnsafe(value: unknown): X402OperationRecord;
export declare function validateTransitions(values: readonly X402Transition[]): void;
export declare function validateStateSummary(operation: Record<string, unknown>, evidence: {
    readonly signatureCount: number;
    readonly attempts: readonly X402Attempt[];
    readonly settlementResponseObservation: SettlementResponseObservation | undefined;
    readonly transactionHint: TransactionHint | undefined;
    readonly authorizationUsedScan: AuthorizationUsedScan | undefined;
    readonly settlementEvidence: SettlementEvidence | undefined;
    readonly unusedExpiryEvidence: UnusedExpiryEvidence | undefined;
}): void;
