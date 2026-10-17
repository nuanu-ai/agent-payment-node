import type { ClockPort } from "../../ports.js";
import { type SwapOperationRecord } from "../model.js";
import type { SwapProtocolRegistry } from "../protocol-registry.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../runtime.js";
import type { GuardedSwapService } from "../service.js";
import type { SwapUnlandedProof } from "../unlanded.js";
import type { SunSwapLocalOwnerAdmission } from "./admission.js";
import { type SunSwapExecutionBindingStore } from "./execution-binding.js";
import type { SunSwapExecutionGuard } from "./guard.js";
import type { SunSwapOutcomeObserver } from "./outcome.js";
import { type SunSwapExecutionBinding } from "./signer.js";
/** Per-operation signer and single sender over the encrypted local TRON wallet (SunSwapProtectedExecutionAdapter). */
export interface SunSwapSigningPort {
    sign(operation: SwapOperationRecord, binding: SunSwapExecutionBinding): Promise<{
        readonly signedMaterialHandle: string;
    }>;
    sendOnce(operation: SwapOperationRecord, binding: SunSwapExecutionBinding, handle: string): Promise<{
        readonly transactionHash: string;
    }>;
}
export interface SunSwapTronExecutionDriverDependencies {
    readonly core: GuardedSwapService;
    readonly protocolRegistry: SwapProtocolRegistry;
    readonly admission: Pick<SunSwapLocalOwnerAdmission, "assert">;
    readonly guard: Pick<SunSwapExecutionGuard, "inspect">;
    readonly bindings: Pick<SunSwapExecutionBindingStore, "save" | "load">;
    readonly signing: SunSwapSigningPort;
    readonly observer: Pick<SunSwapOutcomeObserver, "observeOutcome" | "proveUnlanded">;
    readonly clock: ClockPort;
}
/**
 * GuardedSwapExecutionDriver for the approved SunSwap reservation. Before the marker every refusal releases the
 * reservation with a bound proof. The marker, then the execution binding, are durable before signing; the sender
 * broadcasts once; every later outcome, and every status call, only observes the exact transaction id.
 */
export declare class SunSwapTronExecutionDriver implements GuardedSwapExecutionDriver {
    private readonly d;
    constructor(d: SunSwapTronExecutionDriverDependencies);
    execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord>;
    observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord>;
    /** The transaction id and expiration are fixed in the prepared material, signed or not. */
    proveUnlanded(input: GuardedSwapObservationInput): Promise<SwapUnlandedProof | null>;
    private observeExact;
    private releaseUnsent;
}
