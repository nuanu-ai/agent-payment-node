import { SecureStateStore } from "../../secure-state-store.js";
import type { AssetUsageState } from "../../asset-usage-ledger.js";
import { type UniswapTokenRoute } from "./token-route.js";
export declare const UNISWAP_TOKEN_OPERATION_SCHEMA_V1: "apn.uniswap-token-operation.v1";
export declare const UNISWAP_TOKEN_OPERATION_SCHEMA: "apn.uniswap-token-operation.v2";
export declare const UNISWAP_TOKEN_RECEIPT_SCHEMA: "apn.uniswap-token-receipt.v1";
export type UniswapTokenPhase = "prepared" | "approved" | "approval_submission_started" | "approval_submitted" | "approval_unknown_finality" | "approval_observed" | "submission_started" | "submitted" | "unknown_finality" | "observed" | "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned" | "abandoned_unknown";
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
export interface UniswapTokenExpiredApprovalEvidence {
    readonly schemaVersion: "apn.uniswap-token-expired-approval-evidence.v1";
    readonly kind: "expired_approval_no_swap";
    readonly approvalTransactionHash: string;
    readonly observedAllowanceAtomic: string;
    readonly observedAt: string;
    readonly source?: never;
}
/** The residual allowance was observed zero after an effect of this swap landed (or was retired): nothing is left to clean. */
export interface UniswapTokenZeroAllowanceEvidence {
    readonly schemaVersion: "apn.uniswap-token-zero-allowance-evidence.v1";
    readonly kind: "zero_allowance_after_effect";
    readonly observedAllowanceAtomic: "0";
    readonly observedAt: string;
    readonly source?: never;
}
/**
 * An attempt that can no longer land, kept when its slot is freed (R4): never landed (at the finalized tag the account's
 * nonce passed the attempt's nonce and the node knows neither its transaction nor a receipt) or, for a cleanup, landed
 * without zeroing the allowance (reverted, or another approval followed in its block). A freed cleanup slot is re-armed
 * under a new round with fresh owner consent; approval and swap slots are never signed again.
 */
export interface UniswapTokenRetiredEffect {
    readonly kind: "approval" | "swap" | "cleanup";
    readonly attempt: UniswapTokenAttempt;
    readonly reason: "never_landed" | "reverted" | "landed_allowance_nonzero";
    readonly finalizedNonceAtomic: string | null;
    readonly observedAt: string;
}
/** The owner's own cleanup fee caps replaced the frozen ones at a fresh, consented fee quote (this cleanup only). */
export interface UniswapTokenCleanupFeeQuote {
    readonly schemaVersion: "apn.uniswap-token-cleanup-fee-quote.v1";
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly baseFeePerGasWei: string;
    readonly priorityFeePerGasWei: string;
    readonly previousCleanupGas: TokenGasEnvelope;
    readonly previousMaximumNativeDebitWei: string;
    readonly quotedAt: string;
}
/**
 * Why a cleaned swap's principal hold was released although an approval of it landed (R4 exit 2): no swap of it was ever
 * signed (no swap marker is left; a marker is dropped only when custody showed no signed bytes for it), or the hashless
 * swap marker's nonce is consumed in the finalized chain by this operation's own landed cleanup, so no swap of it can
 * ever land. Spent gas and every attempt stay in the record. An owner-abandoned swap (QA 0.5.54, 867244e9…) keeps its
 * hashless marker and names it: custody, opened under the account lock, held no signed bytes for it and freed its nonce.
 */
export type UniswapTokenPrincipalRelease = {
    readonly schemaVersion: "apn.uniswap-token-principal-release.v1";
    readonly kind: "swap_never_signed";
    readonly swapNonce?: string;
    readonly swapMarkerHash?: string;
    readonly chainProof?: UniswapTokenSwapNonceProof;
    readonly observedAt: string;
} | {
    readonly schemaVersion: "apn.uniswap-token-principal-release.v1";
    readonly kind: "swap_nonce_consumed_by_cleanup";
    readonly swapNonce: string;
    readonly cleanupTransactionHash: string;
    readonly cleanupBlockNumber: string;
    readonly cleanupBlockHash: string;
    readonly finalizedBlockNumber: string;
    readonly finalizedNonce: string;
    readonly chainProof?: UniswapTokenSwapNonceProof;
    readonly observedAt: string;
};
/**
 * Custody's "no signed bytes" is local state; this is the finalized chain's word that no swap with a marker's nonce can land
 * (0.5.56 on): each nonce is held by a landed cleanup of this operation at a finalized block, or the account's nonce at a
 * finalized block past the route's deadline is at or below it (a swap included later reverts on that deadline). A release
 * recorded before the proof existed carries none.
 */
export interface UniswapTokenSwapNonceProof {
    readonly swapNonces: readonly string[];
    readonly cleanups: readonly {
        readonly swapNonce: string;
        readonly cleanupTransactionHash: string;
        readonly cleanupBlockNumber: string;
        readonly cleanupBlockHash: string;
        readonly finalizedBlockNumber: string;
        readonly finalizedNonce: string;
    }[];
    readonly unused: {
        readonly fromNonce: string;
        readonly finalizedNonce: string;
        readonly finalizedBlockNumber: string;
        readonly finalizedBlockHash: string;
        readonly finalizedBlockTimestamp: string;
    } | null;
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
    /** The quote's Ethereum block, read before anything of the swap was signed (R4 exit 2 needs a node indexing it); absent on older records. */
    readonly quoteBlock?: {
        readonly number: string;
        readonly hash: string;
    };
    readonly accumulatedNativeDebitWei: string;
    readonly usageReservationId: string | null;
    readonly usageState: AssetUsageState | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly approvalAttempt: UniswapTokenAttempt | null;
    readonly swapAttempt: UniswapTokenAttempt | null;
    readonly cleanupAttempt: UniswapTokenAttempt | null;
    readonly cleanupReason: string | null;
    readonly cleanupEvidence?: UniswapTokenCleanupEvidence | UniswapTokenExpiredApprovalEvidence | UniswapTokenZeroAllowanceEvidence | null;
    readonly preSignFailure?: UniswapTokenFailureDiagnostic | null;
    /** Present only once the owner re-quoted the cleanup fee caps. */
    readonly cleanupFeeQuote?: UniswapTokenCleanupFeeQuote;
    /** Present only once an attempt was retired (v2 records without it read as before). */
    readonly retiredEffects?: readonly UniswapTokenRetiredEffect[];
    /** Present only once a cleaned swap's principal hold was released on proof that no swap of it can land. */
    readonly principalRelease?: UniswapTokenPrincipalRelease;
    /** Swap markers dropped because custody showed no signed bytes for them (0.5.56 on): their nonces a release must prove on chain. */
    readonly freedSwapMarkers?: readonly UniswapTokenAttempt[];
    readonly receipt: UniswapTokenReceipt | null;
    readonly previousIntegrityHash: string | null;
    readonly integrityHash: string;
}
export declare function newUniswapTokenOperation(input: Omit<UniswapTokenOperation, "schemaVersion" | "phase" | "createdAt" | "updatedAt" | "accumulatedNativeDebitWei" | "usageReservationId" | "usageState" | "approvalAttempt" | "swapAttempt" | "cleanupAttempt" | "cleanupReason" | "cleanupEvidence" | "preSignFailure" | "receipt" | "previousIntegrityHash" | "integrityHash"> & {
    readonly now: Date;
}): UniswapTokenOperation;
export declare function validateUniswapTokenOperation(value: unknown): UniswapTokenOperation;
/** Every phase of a Uniswap token swap; `observed` and `cleaned` are its outcomes (nothing of it signs, sends or lands after them). */
export declare const UNISWAP_TOKEN_TERMINAL_PHASES: readonly UniswapTokenPhase[];
export declare const UNISWAP_TOKEN_PHASES: readonly UniswapTokenPhase[];
/** The round of an effect slot: how many attempts of that kind were retired before it. Round 0 keeps the original keys. */
export declare function tokenEffectRound(op: Pick<UniswapTokenOperation, "retiredEffects">, kind: "approval" | "swap" | "cleanup"): number;
export declare class UniswapTokenJournal extends SecureStateStore {
    save(value: UniswapTokenOperation): Promise<UniswapTokenOperation>;
    load(id: string): Promise<UniswapTokenOperation | null>;
    /** Lock-free read without creating the state root (the operation index's reader). */
    read(id: string): Promise<UniswapTokenOperation | null>;
    private path;
}
export declare function transitionUniswapToken(opValue: UniswapTokenOperation, phase: UniswapTokenPhase, patch: Partial<UniswapTokenOperation>, now: Date): UniswapTokenOperation;
export declare function tokenAttempt(op: UniswapTokenOperation, kind: "approval" | "swap" | "cleanup", nonce: string, now: Date): UniswapTokenAttempt;
/** The nonces of the swap markers custody freed and of `kept` (a hashless marker the record still holds), ascending and distinct. */
export declare function swapMarkerNonces(op: Pick<UniswapTokenOperation, "freedSwapMarkers">, kept: UniswapTokenAttempt | null): readonly string[];
/** A cleanup of this operation that landed (current, or retired after landing) and so consumed its nonce. */
export declare function landedTokenCleanups(op: Pick<UniswapTokenOperation, "cleanupAttempt" | "retiredEffects">): readonly UniswapTokenAttempt[];
export {};
