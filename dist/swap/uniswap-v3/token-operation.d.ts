import { SecureStateStore } from "../../secure-state-store.js";
import type { AssetUsageState } from "../../asset-usage-ledger.js";
import { type UniswapTokenRoute } from "./token-route.js";
export declare const UNISWAP_TOKEN_OPERATION_SCHEMA_V1: "apn.uniswap-token-operation.v1";
export declare const UNISWAP_TOKEN_OPERATION_SCHEMA: "apn.uniswap-token-operation.v2";
export declare const UNISWAP_TOKEN_RECEIPT_SCHEMA: "apn.uniswap-token-receipt.v1";
export type UniswapTokenPhase = "prepared" | "approved" | "approval_submission_started" | "approval_submitted" | "approval_unknown_finality" | "approval_observed" | "submission_started" | "submitted" | "unknown_finality" | "observed" | "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned";
export interface TokenGasEnvelope {
    readonly gasLimit: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
}
export interface UniswapTokenAttempt {
    readonly markerHash: string;
    readonly markedAt: string;
    readonly nonce: string;
    readonly transactionHash: string | null;
    readonly attempts: 1;
}
export interface UniswapTokenReceipt {
    readonly schemaVersion: typeof UNISWAP_TOKEN_RECEIPT_SCHEMA;
    readonly operationId: string;
    readonly approvalGasWei: string;
    readonly swapGasWei: string;
    readonly cleanupGasWei: string;
    readonly nativeDebitWei: string;
    readonly inputDebitAtomic: string;
    readonly outputCreditAtomic: string;
    readonly residualAllowanceAtomic: "0";
    readonly transactionHash: string;
    readonly observedAt: string;
    readonly receiptHash: string;
}
export interface UniswapTokenCleanupEvidence {
    readonly schemaVersion: "apn.uniswap-token-cleanup-evidence.v1";
    readonly kind: "zero_allowance_no_effect";
    readonly source: "current_allowance" | "legacy_usage_reconciliation";
    readonly observedAllowanceAtomic: "0";
    readonly observedAt: string;
}
export interface UniswapTokenFailureDiagnostic {
    readonly code: string | null;
    readonly reason: string | null;
    readonly rpcMethod: string | null;
    readonly endpointRole: string | null;
    readonly phase: UniswapTokenPhase;
}
type FailureDiagnosticField = "code" | "reason" | "rpcMethod" | "endpointRole";
export declare function sanitizeUniswapTokenFailureField(field: FailureDiagnosticField, value: unknown): string | null;
export interface UniswapTokenOperation {
    readonly schemaVersion: typeof UNISWAP_TOKEN_OPERATION_SCHEMA | typeof UNISWAP_TOKEN_OPERATION_SCHEMA_V1;
    readonly operationId: string;
    readonly profile: string;
    readonly account: string;
    readonly phase: UniswapTokenPhase;
    readonly route: UniswapTokenRoute;
    readonly approvalCapAtomic: string;
    readonly allowanceAtPrepare: string;
    readonly approvalGas: TokenGasEnvelope;
    readonly swapGas: TokenGasEnvelope;
    readonly cleanupGas: TokenGasEnvelope;
    readonly maximumNativeDebitWei: string;
    readonly policyDigest: string;
    readonly mechanismDigest: string;
    readonly accumulatedNativeDebitWei: string;
    readonly usageReservationId: string | null;
    readonly usageState: AssetUsageState | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly approvalAttempt: UniswapTokenAttempt | null;
    readonly swapAttempt: UniswapTokenAttempt | null;
    readonly cleanupAttempt: UniswapTokenAttempt | null;
    readonly cleanupReason: string | null;
    readonly cleanupEvidence?: UniswapTokenCleanupEvidence | null;
    readonly preSignFailure?: UniswapTokenFailureDiagnostic | null;
    readonly receipt: UniswapTokenReceipt | null;
    readonly previousIntegrityHash: string | null;
    readonly integrityHash: string;
}
export declare function newUniswapTokenOperation(input: Omit<UniswapTokenOperation, "schemaVersion" | "phase" | "createdAt" | "updatedAt" | "accumulatedNativeDebitWei" | "usageReservationId" | "usageState" | "approvalAttempt" | "swapAttempt" | "cleanupAttempt" | "cleanupReason" | "cleanupEvidence" | "preSignFailure" | "receipt" | "previousIntegrityHash" | "integrityHash"> & {
    readonly now: Date;
}): UniswapTokenOperation;
export declare function validateUniswapTokenOperation(value: unknown): UniswapTokenOperation;
export declare class UniswapTokenJournal extends SecureStateStore {
    save(value: UniswapTokenOperation): Promise<UniswapTokenOperation>;
    load(id: string): Promise<UniswapTokenOperation | null>;
    private path;
}
export declare function transitionUniswapToken(opValue: UniswapTokenOperation, phase: UniswapTokenPhase, patch: Partial<UniswapTokenOperation>, now: Date): UniswapTokenOperation;
export declare function tokenAttempt(op: UniswapTokenOperation, kind: "approval" | "swap" | "cleanup", nonce: string, now: Date): UniswapTokenAttempt;
export {};
