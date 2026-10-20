import type { Hex } from "viem";
import type { ClockPort } from "../../../ports.js";
import { type SwapOperationRecord, type SwapReceiptEconomics } from "../../model.js";
import type { SwapProtocolRegistry } from "../../protocol-registry.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../../runtime.js";
import type { GuardedSwapService } from "../../service.js";
import type { SwapUnlandedProof } from "../../unlanded.js";
import type { UniswapExecutionBindingStore } from "./binding-store.js";
import type { UniswapObservedOutcome } from "./observer.js";
import type { UniswapEffectStorePort, UniswapExecutionBinding, UniswapExecutionGuardPort, UniswapExecutionSignerPort, UniswapOwnerAdmissionPort, UniswapSingleSendPort } from "./types.js";
export interface UniswapOutcomeObserverPort {
    observeOutcome(operation: SwapOperationRecord, binding: UniswapExecutionBinding, transactionHash: Hex): Promise<UniswapObservedOutcome | null>;
    proveUnlanded(deadlineSeconds: number, loadTransactionHash: () => Promise<string | null>): Promise<SwapUnlandedProof | null>;
    receiptEconomics?(operation: SwapOperationRecord): Promise<SwapReceiptEconomics>;
}
export interface UniswapExecutionDriverDependencies {
    readonly core: GuardedSwapService;
    readonly protocolRegistry: SwapProtocolRegistry;
    readonly admission: UniswapOwnerAdmissionPort;
    readonly guard: UniswapExecutionGuardPort;
    readonly bindings: Pick<UniswapExecutionBindingStore, "save" | "load">;
    readonly signer: UniswapExecutionSignerPort;
    readonly sender: UniswapSingleSendPort;
    readonly observer: UniswapOutcomeObserverPort;
    readonly effects: UniswapEffectStorePort;
    readonly clock: ClockPort;
}
/**
 * GuardedSwapExecutionDriver for the approved Uniswap reservation. Before the marker every refusal releases the
 * reservation with a bound proof. The marker, then the execution binding, are durable before signing; the sender
 * attempts once; every later outcome, and every status call, only observes the exact signed transaction.
 */
export declare class UniswapEthereumExecutionDriver implements GuardedSwapExecutionDriver {
    private readonly d;
    constructor(d: UniswapExecutionDriverDependencies);
    execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord>;
    observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord>;
    /** A swap finalized before its economics were recorded: one read of its own receipt (observe only). */
    receiptEconomics(input: GuardedSwapObservationInput): Promise<SwapReceiptEconomics>;
    /** The router deadline is the quote expiry; the signed hash, when one was ever sealed, is read after the finalized block. */
    proveUnlanded(input: GuardedSwapObservationInput): Promise<SwapUnlandedProof | null>;
    /**
     * Right after the single send an observation failure must not hide the recorded send, so it returns the operation. A status
     * or resume call surfaces the failure instead: the state stays durable and the caller sees why it did not advance.
     */
    private observeExact;
    private releaseUnsent;
}
