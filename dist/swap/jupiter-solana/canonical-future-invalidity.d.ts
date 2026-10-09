import type { SolanaRpcPort } from "../../solana/rpc.js";
/**
 * This module emits only a read-only future-invalidity witness. It is not settlement or financial authority.
 * Solana's Transactions and Constants references list MAX_PROCESSING_AGE=150, while the confirmation
 * cookbook describes 151 recent hashes and an additional processing-boundary nuance. We therefore
 * require H+152 only as a conservative safety bound; this field does not claim an exact protocol expiry height.
 * https://solana.com/docs/core/transactions
 * https://solana.com/docs/core/constants-reference
 * https://solana.com/uk/developers/cookbook/transactions/confirmation
 */
export declare const JUPITER_NON_DURABLE_MAX_PROCESSING_AGE: 150;
export declare const JUPITER_FUTURE_INVALIDITY_MAX_READS_PER_PROVIDER: 72;
export declare const JUPITER_FUTURE_INVALIDITY_MAX_WINDOW_SLOTS: 65;
declare const SCHEMA: "apn.jupiter-canonical-future-invalidity.v1";
export type JupiterFutureInvalidityReadMethod = "getGenesisHash" | "getBlocks" | "getBlock" | "getSlot" | "getBlockHeight" | "isBlockhashValid" | "getSignatureStatuses";
/** Narrow, read-only port. Production callers must bind exactly two independent configured RPCs. */
export interface JupiterFutureInvalidityReadPort {
    readonly originHash: string;
    read(method: JupiterFutureInvalidityReadMethod, params: readonly unknown[], signal: AbortSignal): Promise<unknown>;
    /** Logical getBlock reads may be multiplexed through the existing bounded JSON-RPC batch gateway. */
    readBlockBatch?(reads: readonly {
        readonly method: "getBlock";
        readonly params: readonly unknown[];
    }[], signal: AbortSignal): Promise<readonly unknown[]>;
}
export type JupiterFutureInvalidityExtendedMethod = "getBlocks" | "getSlot" | "isBlockhashValid";
/** Reuse the existing typed read gateway for common calls; keep the three extra RPCs on a narrow internal read port. */
export declare function adaptJupiterFutureInvalidityReadPort(rpc: Pick<SolanaRpcPort, "originHash" | "call" | "batch">): JupiterFutureInvalidityReadPort;
export interface JupiterFutureInvalidityOriginalLifetime {
    readonly contextSlot: string;
    readonly blockhash: string;
    /** Authenticated quote context may provide this additional conservative bound. */
    readonly lastValidBlockHeight?: string | null;
}
export interface JupiterFutureInvalidityInput {
    /** Caller must supply authenticated in-memory operation material; parsing here does not establish signer authority. */
    readonly signedTransactionBase64: string;
    /** Must be the matching original authenticated quote RPC lifetime context. */
    readonly originalQuoteRpcLifetime: JupiterFutureInvalidityOriginalLifetime;
    /** Full ALT account-key order from authenticated material; omit to refuse an ALT first program. */
    readonly resolvedLookupAddresses?: {
        readonly loadedWritable: readonly string[];
        readonly loadedReadonly: readonly string[];
    };
}
export type JupiterFutureInvalidityReason = "invalid_input" | "invalid_signed_wire" | "unsupported_message_version" | "unsigned_wire" | "unresolved_alt_program" | "durable_nonce" | "ambiguous_nonce_instruction" | "quote_lifetime_mismatch" | "rpc_identity_invalid" | "rpc_proof_failed" | "read_budget_exhausted" | "deadline_exceeded" | "caller_aborted" | "wrong_genesis" | "empty_or_missing_history" | "archive_data_missing" | "birth_not_found" | "duplicate_birth_match" | "finalized_history_mismatch" | "malformed_rpc_result" | "reanchor_failed" | "processing_age_not_exceeded" | "quote_lifetime_not_exceeded" | "blockhash_still_valid" | "signature_status_reported";
export interface JupiterFutureInvalidityInconclusive {
    readonly schemaVersion: typeof SCHEMA;
    readonly scope: "blockhash_future_invalidity_only";
    readonly outcome: "inconclusive";
    readonly reason: JupiterFutureInvalidityReason;
    readonly inputHash: string;
    readonly resultHash: string;
}
export interface JupiterFutureInvalidityWitness {
    readonly schemaVersion: typeof SCHEMA;
    readonly scope: "blockhash_future_invalidity_only";
    readonly outcome: "future_invalidity_witness";
    readonly inputHash: string;
    readonly transactionHash: string;
    readonly messageHash: string;
    readonly signatureHash: string;
    readonly blockhash: string;
    readonly quoteContextSlot: string;
    readonly searchedStartSlot: string;
    readonly birth: {
        readonly slot: string;
        readonly blockHeight: string;
        readonly blockhash: string;
    };
    readonly finalizedAnchor: {
        readonly slot: string;
        readonly blockHeight: string;
        readonly blockhash: string;
    };
    readonly processingAge: {
        readonly documentedMaximumProcessingAge: typeof JUPITER_NON_DURABLE_MAX_PROCESSING_AGE;
        readonly requiredConservativeFinalizedHeight: string;
    };
    readonly quoteLastValidBlockHeight: string | null;
    readonly providers: readonly {
        readonly originHash: string;
        readonly finalizedSlot: string;
        readonly finalizedBlockHeight: string;
        readonly isBlockhashValid: false;
        /** Null status is only "not reported"; it is never a historical absence claim. */
        readonly signatureStatusObservation: "not_reported";
        readonly readCount: number;
    }[];
    readonly resultHash: string;
}
export type JupiterFutureInvalidityResult = JupiterFutureInvalidityInconclusive | JupiterFutureInvalidityWitness;
export interface JupiterFutureInvalidityOptions {
    readonly signal?: AbortSignal;
    readonly deadlineMs?: number;
    readonly monotonicNow?: () => number;
}
/**
 * Require a positive, exact finalized birth block, independent-provider agreement and a common
 * finalized reanchor. A null historical status is recorded only as "not reported".
 */
export declare function verifyJupiterCanonicalFutureInvalidity(input: JupiterFutureInvalidityInput, providers: readonly JupiterFutureInvalidityReadPort[], options?: JupiterFutureInvalidityOptions): Promise<JupiterFutureInvalidityResult>;
export {};
