import type { UniswapTokenOperation } from "./token-operation.js";
import { UniswapTokenJournal } from "./token-operation.js";
export type TokenEffectKind = "approval" | "swap" | "cleanup";
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
    currentNonce(account: string): Promise<string>;
    currentAllowance(operation: UniswapTokenOperation): Promise<string>;
    submit(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<string>;
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
    private observeApproval;
    private observeSwap;
    private observeCleanup;
    private cleanupRequired;
    private required;
    private persist;
}
