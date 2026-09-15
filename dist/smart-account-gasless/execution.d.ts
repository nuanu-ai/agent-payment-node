import type { ClockPort } from "../ports.js";
import type { StateStore } from "../state.js";
import type { SmartAccountGaslessMutable } from "./model.js";
import type { SmartAccountGaslessOperationRecord } from "./operation-model.js";
import type { SmartAccountGaslessApprovalPort, SmartAccountGaslessMaterialPort, SmartAccountGaslessProviderPort, SmartAccountGaslessRpcFactory, SmartAccountGaslessRpcPort } from "./ports.js";
import { type SmartAccountGaslessFailure } from "./reasons.js";
export type SmartAccountGaslessSave = (op: SmartAccountGaslessOperationRecord, patch: Partial<SmartAccountGaslessMutable>, at: string) => Promise<SmartAccountGaslessOperationRecord>;
export interface SmartAccountGaslessStep {
    readonly operation: SmartAccountGaslessOperationRecord;
    readonly warning?: SmartAccountGaslessFailure;
}
export declare class SmartAccountGaslessExecution {
    private readonly state;
    private readonly rpcFor;
    private readonly material;
    private readonly provider;
    private readonly save;
    private readonly clock;
    constructor(state: StateStore, rpcFor: SmartAccountGaslessRpcFactory, material: SmartAccountGaslessMaterialPort, provider: SmartAccountGaslessProviderPort, clock: ClockPort, save: SmartAccountGaslessSave);
    /** Observation through an owner-named RPC after exposure; approval, verification and settlement keep the frozen endpoint. */
    observeWith(op: SmartAccountGaslessOperationRecord, observer: SmartAccountGaslessObserver): Promise<SmartAccountGaslessStep>;
    approve(op: SmartAccountGaslessOperationRecord, approval: SmartAccountGaslessApprovalPort): Promise<SmartAccountGaslessStep>;
    run(input: SmartAccountGaslessOperationRecord): Promise<SmartAccountGaslessStep>;
    private checkSeal;
    private rpc;
    private guard;
    private observe;
    private decide;
    private halt;
}
/** An owner-named observation RPC with the environment variable that named it. */
export interface SmartAccountGaslessObserver {
    readonly rpc: SmartAccountGaslessRpcPort;
    readonly environmentName: string;
}
