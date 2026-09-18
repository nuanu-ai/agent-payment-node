import type { Hex } from "viem";
import type { ClockPort } from "../../../ports.js";
import { type SwapOperationRecord } from "../../model.js";
import type { SwapProtocolRegistry } from "../../protocol-registry.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../../runtime.js";
import type { GuardedSwapService } from "../../service.js";
import type { UniswapExecutionBindingStore } from "./binding-store.js";
import type { UniswapObservedOutcome } from "./observer.js";
import type { UniswapEffectStorePort, UniswapExecutionBinding, UniswapExecutionGuardPort, UniswapExecutionSignerPort, UniswapOwnerAdmissionPort, UniswapSingleSendPort } from "./types.js";
export interface UniswapOutcomeObserverPort {
    observeOutcome(operation: SwapOperationRecord, binding: UniswapExecutionBinding, transactionHash: Hex): Promise<UniswapObservedOutcome | null>;
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
    private observeExact;
    private releaseUnsent;
}
