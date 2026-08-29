import type { AuthorizationUsedScan, SettlementEvidence, SettlementResponseObservation, TransactionHint, UnusedExpiryEvidence, X402Attempt, X402HttpObservation } from "./x402-state-model.js";
export declare function validateAttempts(value: unknown, operation: Record<string, unknown>): readonly X402Attempt[];
export declare function validateHttpObservation(value: unknown, attemptNumber: string, purpose: unknown, operation: Record<string, unknown>): X402HttpObservation;
export declare function validateSettlementResponseObservation(value: unknown, operation: Record<string, unknown>, attempts: readonly X402Attempt[]): SettlementResponseObservation;
export declare function validateNormalizedSettlement(value: unknown, classification: SettlementResponseObservation["classification"], operation: Record<string, unknown>): void;
export declare function validateTransactionHint(value: unknown): TransactionHint;
export declare function validateAuthorizationUsedScan(value: unknown, operation: Record<string, unknown>): AuthorizationUsedScan;
export declare function validateSettlementEvidence(value: unknown, operation?: Record<string, unknown>): SettlementEvidence;
export declare function validateUnusedExpiryEvidence(value: unknown, operation?: Record<string, unknown>): UnusedExpiryEvidence;
