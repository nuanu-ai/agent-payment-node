import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { ClockPort } from "../../ports.js";
import { type SolanaRpcPort } from "../../solana/rpc.js";
import { type SwapOperationRecord } from "../model.js";
import type { SwapProtocolRegistry } from "../protocol-registry.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../runtime.js";
import type { GuardedSwapService } from "../service.js";
import type { OrcaLocalOwnerAdmission } from "./admission.js";
import { type OrcaExecutionBindingStore, type OrcaExecutionFreshness, type OrcaLocalSigner, type OrcaSingleSender } from "./effects.js";
import { type OrcaKeylessMaterial } from "./material.js";
import type { OrcaProgramPinVerifier } from "./pins.js";
import type { OrcaReceiptObserver } from "./receipt.js";
/**
 * Pre-signing guard, run after the owner approved: program pins unchanged, the pool re-read at a fresh slot with the
 * same tick arrays and a local output still at or above the minimum, a fresh blockhash, the exact bytes rebuilt and
 * validated, the chain fee within the approved fee, funds sufficient, and the exact signed-to-be bytes simulated.
 */
export declare class OrcaExecutionGuard {
    private readonly rpc;
    private readonly clock;
    private readonly verifyPins;
    constructor(rpc: SolanaRpcPort, clock: ClockPort, verifyPins: OrcaProgramPinVerifier);
    inspect(operationValue: SwapOperationRecord, materialValue: OrcaKeylessMaterial): Promise<OrcaExecutionFreshness>;
}
export interface OrcaExecutionDriverDependencies {
    readonly core: GuardedSwapService;
    readonly protocolRegistry: SwapProtocolRegistry;
    readonly admission: Pick<OrcaLocalOwnerAdmission, "assert" | "localAccount">;
    readonly guard: Pick<OrcaExecutionGuard, "inspect">;
    readonly bindings: Pick<OrcaExecutionBindingStore, "save" | "load">;
    readonly signer: Pick<OrcaLocalSigner, "sign">;
    readonly sender: Pick<OrcaSingleSender, "sendOnce">;
    readonly observer: Pick<OrcaReceiptObserver, "observeOutcome">;
    readonly effects: Pick<ChainWalletStoragePort, "effect">;
    readonly clock: ClockPort;
}
/**
 * GuardedSwapExecutionDriver for the approved Orca reservation. Before the marker every refusal releases the
 * reservation with a bound proof. The marker, the execution binding and the sealed signed bytes are durable before
 * the single send; every later outcome, and every status call, only observes the exact signature.
 */
export declare class OrcaSolanaExecutionDriver implements GuardedSwapExecutionDriver {
    private readonly d;
    constructor(d: OrcaExecutionDriverDependencies);
    execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord>;
    observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord>;
    private observeExact;
    private releaseUnsent;
}
