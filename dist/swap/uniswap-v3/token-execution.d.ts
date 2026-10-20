import type { NeverLandsCheck } from "../../evm-finalized-proof.js";
import type { UniswapTokenAttempt, UniswapTokenOperation } from "./token-operation.js";
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
export interface UniswapTokenExecutionPorts {
    now(): Date;
    foregroundApprove(operation: UniswapTokenOperation): Promise<void>;
    foregroundCleanup(operation: UniswapTokenOperation): Promise<void>;
    withAccountLock<T>(operation: UniswapTokenOperation, work: () => Promise<T>): Promise<T>;
    allocateNonce(operation: UniswapTokenOperation, kind: TokenEffectKind): Promise<string>;
    currentAllowance(operation: UniswapTokenOperation): Promise<string>;
    /** True when custody holds no signed bytes for the effect and its reservation is free; false when a signed effect committed it. */
    releaseNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<boolean>;
    commitNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    guard(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    reserveSendCapacity?(): void;
    revalidate(operation: UniswapTokenOperation): Promise<void>;
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
    cleanup(id: string): Promise<UniswapTokenOperation>;
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
    cleanup(id: string): Promise<UniswapTokenOperation>;
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
    private cleanupRequired;
    private retireExpiredPrepared;
    private syncUsage;
    private assertNoEffect;
    private required;
    private persist;
}
