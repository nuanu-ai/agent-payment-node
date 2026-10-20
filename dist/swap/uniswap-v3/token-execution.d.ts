import type { NeverLandsCheck } from "../../evm-finalized-proof.js";
import type { UniswapTokenAttempt, UniswapTokenOperation } from "./token-operation.js";
import { type TokenNonceConsumption } from "./token-principal.js";
import type { TokenUsageBinding } from "./token-usage.js";
import { UniswapTokenJournal } from "./token-operation.js";
export type TokenEffectKind = "approval" | "swap" | "cleanup";
export interface TokenSealedEffect {
    readonly transactionHash: string;
    readonly envelopeHash: string;
}
export interface TokenEffectObservation {
    readonly status: "pending" | "success" | "reverted";
    readonly transactionHash: string;
    readonly gasDebitWei: string;
    readonly allowanceAtomic: string;
    readonly inputDebitAtomic?: string;
    readonly outputCreditAtomic?: string;
}
/** The owner's own caps for one cleanup (re-quote) and the fresh fee quote they are checked against. */
export interface TokenCleanupFees {
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
}
export interface TokenFeeQuote {
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly baseFeePerGasWei: string;
    readonly priorityFeePerGasWei: string;
}
export interface UniswapTokenExecutionPorts {
    now(): Date;
    foregroundApprove(operation: UniswapTokenOperation): Promise<void>;
    foregroundCleanup(operation: UniswapTokenOperation): Promise<void>;
    withAccountLock<T>(operation: UniswapTokenOperation, work: () => Promise<T>): Promise<T>;
    allocateNonce(operation: UniswapTokenOperation, kind: TokenEffectKind): Promise<string>;
    /** The allowance at the latest block; with `landed`, read at a head one node shows including that landed transaction (refused otherwise). */
    currentAllowance(operation: UniswapTokenOperation, landed?: string): Promise<string>;
    /** True when custody holds no signed bytes for the effect and its reservation is free; false when a signed effect committed it (now or earlier). */
    releaseNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<boolean>;
    commitNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    /** The signing guard: every pre-sign check of the effect at one fresh block (for a swap, its full revalidation). */
    guard(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    /** Holds the command's one send slot, so no read can spend it; taken before any attempt marker is written. */
    reserveSendCapacity?(): void;
    reserveUsage(operation: UniswapTokenOperation): Promise<TokenUsageBinding>;
    currentUsage(operation: UniswapTokenOperation): Promise<TokenUsageBinding>;
    followUsage(operation: UniswapTokenOperation, target: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" | "released_unsubmitted"): Promise<TokenUsageBinding>;
    /** R4 exit 2: at the finalized tag the account's nonce passed the attempt's nonce and the node knows neither its transaction nor a receipt. */
    neverLands?(operation: UniswapTokenOperation, kind: TokenEffectKind, attempt: UniswapTokenAttempt): Promise<NeverLandsCheck>;
    seal(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect>;
    probeSealed(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect | null>;
    recoverSealed?(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect | null>;
    send(operation: UniswapTokenOperation, kind: TokenEffectKind): Promise<"accepted" | "ambiguous">;
    observe(operation: UniswapTokenOperation, kind: TokenEffectKind, transactionHash: string): Promise<TokenEffectObservation | null>;
    /** Current Ethereum base and priority fee (the reads the signing guard prices the same caps with). */
    cleanupFeeQuote?(operation: UniswapTokenOperation): Promise<TokenFeeQuote>;
    /** The finalized chain's proof that a landed cleanup of this operation took the hashless swap marker's nonce; null: not proven. */
    swapNonceConsumed?(operation: UniswapTokenOperation, cleanup: UniswapTokenAttempt): Promise<TokenNonceConsumption | null>;
}
export interface UniswapTokenCommandRuntime {
    inventory(): unknown;
    quote(request: Extract<import("../../commands.js").CommandRequest, {
        readonly command: "swap.uniswap-token.quote";
    }>): Promise<unknown>;
    prepare(request: Extract<import("../../commands.js").CommandRequest, {
        readonly command: "swap.uniswap-token.prepare";
    }>): Promise<UniswapTokenOperation>;
    approve(id: string): Promise<UniswapTokenOperation>;
    execute(id: string): Promise<UniswapTokenOperation>;
    status(id: string): Promise<UniswapTokenOperation>;
    cleanup(id: string, fees?: TokenCleanupFees): Promise<UniswapTokenOperation>;
    /** The live allowance a swap the earlier expired-approval exit cleaned with its approval standing still has; null for any other record. */
    residualAllowance?(operation: UniswapTokenOperation): Promise<string | null>;
}
export declare class UniswapTokenExecution {
    private readonly journal;
    private readonly ports;
    /** Effects broadcast by this invocation: their nonce cannot be finalized past yet, so no never-lands read is spent on them. */
    private readonly sentNow;
    constructor(journal: UniswapTokenJournal, ports: UniswapTokenExecutionPorts);
    approve(id: string): Promise<UniswapTokenOperation>;
    execute(id: string): Promise<UniswapTokenOperation>;
    private advanceApproval;
    status(id: string): Promise<UniswapTokenOperation>;
    cleanup(id: string, fees?: TokenCleanupFees): Promise<UniswapTokenOperation>;
    private start;
    private continueStart;
    private finishStart;
    private submit;
    private observeApproval;
    private retireExpiredApproval;
    private observeSwap;
    private observeCleanup;
    /**
     * R4 for a bound attempt the observer cannot find: once the finalized nonce passed it and the node knows neither its
     * transaction nor a receipt, it can never land. An approval that never landed leaves the swap with no effect (cleaned
     * when the allowance is still zero); a swap that never landed releases its hold as unsubmitted and keeps the approval
     * for the owner's cleanup; a cleanup that never landed is re-armed for a fresh, consented one. Nothing is re-signed here.
     */
    private retireIfNeverLanded;
    /** The cleanup slot is freed for a new round; a landed cleanup's gas is counted and the cap grows by one more cleanup. */
    private rearmCleanup;
    private retired;
    private cleaned;
    /**
     * A cleaned swap still holding its principal although no swap of it can land (R4 exit 2): no swap marker is left (never
     * signed), or its hashless marker's nonce is consumed in the finalized chain by its own landed cleanup. The proof is saved
     * first, then the hold is released; gas, attempts and history stay. Without such proof the hold stays (owner abandon).
     */
    private settlePrincipal;
    /**
     * A started attempt with no hash and no public sealed effect (a refusal or crash between its marker and signing): the
     * forward command opens custody under the account lock. Custody holding no signed bytes frees the nonce and proves the
     * attempt never signed (R4 exit 2), so its marker is dropped and the operation is where it was before the attempt (execute
     * then only closes an expired route; cleanup goes on to its consented cleanup). Signed bytes found are journaled with their
     * nonce committed, and recovery only observes them. Nothing is signed or sent here.
     */
    private resumeUnsigned;
    private cleanupRequired;
    private retireExpiredPrepared;
    private syncUsage;
    private assertNoEffect;
    /**
     * "No residual allowance" (the cleaned decision): a zero latest read, confirmed once an approval landed at a head one node
     * shows including it, pinned by hash, since a node behind the approval reads the zero from before it. A nonzero read needs
     * no pin: the cleanup it leads to is re-read by the signing guard at its own block. Only a zero costs the second read.
     */
    private zeroAllowance;
    private feeQuote;
    private required;
    private persist;
}
/** The record for one consented cleanup re-quote; refused when the caps miss the quote or a cleanup marker holds the slot. */
export declare function requotedCleanup(op: UniswapTokenOperation, fees: TokenCleanupFees, quote: TokenFeeQuote, now: Date): UniswapTokenOperation;
