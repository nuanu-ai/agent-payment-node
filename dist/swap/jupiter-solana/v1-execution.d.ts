import type { ClockPort } from "../../ports.js";
import { SolanaRpc, type SolanaMethod, type SolanaBatchRead } from "../../solana/rpc.js";
import type { SwapOperationRecord } from "../model.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../runtime.js";
import type { GuardedSwapService } from "../service.js";
import type { JupiterV1OwnerAdmission } from "./v1-admission.js";
import { type JupiterV1ExecutionBindingStore, JupiterV1LocalSigner } from "./v1-effects.js";
import { type SavedJupiterV1MaterialStore } from "./v1-material.js";
/** The public sender reloads durable ownership and consumes its fsynced create-only claim under the operation lock. */
export declare class JupiterV1SingleSender {
    private readonly core;
    private readonly materials;
    private readonly bindings;
    private readonly native;
    private readonly rpc;
    private readonly clock;
    constructor(core: GuardedSwapService, materials: SavedJupiterV1MaterialStore, bindings: JupiterV1ExecutionBindingStore, native: JupiterV1LocalSigner, rpc: SolanaRpc, clock: ClockPort);
    sendOnce(operationId: string): Promise<SwapOperationRecord>;
}
export interface JupiterV1ExecutionDependencies {
    readonly core: GuardedSwapService;
    readonly materials: SavedJupiterV1MaterialStore;
    readonly bindings: JupiterV1ExecutionBindingStore;
    readonly admission: JupiterV1OwnerAdmission;
    readonly native: JupiterV1LocalSigner;
    readonly sender: JupiterV1SingleSender;
    readonly rpc: SolanaRpc;
    readonly clock: ClockPort;
}
export declare class JupiterV1ExecutionDriver implements GuardedSwapExecutionDriver {
    private readonly d;
    constructor(d: JupiterV1ExecutionDependencies);
    execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord>;
    observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord>;
}
/** Owns the actual bounded Solana rail transport; no new URL, fallback or financial callback is accepted. */
export declare class JupiterV1BudgetedRpc extends SolanaRpc {
    private readonly base;
    private readonly stage;
    readonly originHash: string;
    readonly budget: SolanaRpc["budget"];
    private readonly journal;
    private readonly stageKey;
    private calls;
    private priorQuoteCalls;
    constructor(base: SolanaRpc, root: string, stage: "quote" | "prepare" | "execute" | "observe", operationId?: string);
    get hasPersistentPacer(): boolean;
    get maximumAccountsPerRead(): 16 | 8;
    bindOperation(quoteHash: string): Promise<void>;
    bindQuote(quoteHash: string): Promise<void>;
    chargeOfficialRead(): Promise<void>;
    private charge;
    call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
    batch(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]>;
    sendTransactionAtStart(params: readonly unknown[], beforeStart: () => void | Promise<void>): Promise<unknown>;
}
