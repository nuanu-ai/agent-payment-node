import type { UniswapTokenOperation } from "./token-operation.js";
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
    releaseNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    commitNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    guard(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    revalidate(operation: UniswapTokenOperation): Promise<void>;
    reserveUsage(operation: UniswapTokenOperation): Promise<TokenUsageBinding>;
    currentUsage(operation: UniswapTokenOperation): Promise<TokenUsageBinding>;
    followUsage(operation: UniswapTokenOperation, target: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert"): Promise<TokenUsageBinding>;
    seal(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect>;
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
    constructor(journal: UniswapTokenJournal, ports: UniswapTokenExecutionPorts);
    approve(id: string): Promise<UniswapTokenOperation>;
    execute(id: string): Promise<UniswapTokenOperation>;
    status(id: string): Promise<UniswapTokenOperation>;
    cleanup(id: string): Promise<UniswapTokenOperation>;
    private start;
    private continueStart;
    private finishStart;
    private observeApproval;
    private observeSwap;
    private observeCleanup;
    private cleaned;
    private cleanupRequired;
    private syncUsage;
    private required;
    private persist;
}
