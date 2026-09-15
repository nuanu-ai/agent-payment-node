import type { ClockPort } from "../ports.js";
import type { StateStore } from "../state.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import { type MetaMaskGaslessObserver, type MetaMaskGaslessSave, type MetaMaskGaslessStep } from "./observation.js";
import type { MetaMaskGaslessApprovalPort, MetaMaskGaslessProviderPort, MetaMaskGaslessRpcFactory } from "./ports.js";
export declare class MetaMaskGaslessExecution {
    private readonly state;
    private readonly rpcFor;
    private readonly provider;
    private readonly save;
    private readonly clock;
    private readonly observation;
    constructor(state: StateStore, rpcFor: MetaMaskGaslessRpcFactory, provider: MetaMaskGaslessProviderPort, clock: ClockPort, save: MetaMaskGaslessSave);
    /** Observation through an owner-named RPC; approval and dispatch keep the frozen endpoint. */
    observeWith(op: MetaMaskGaslessOperationRecord, observer: MetaMaskGaslessObserver): Promise<MetaMaskGaslessStep>;
    approve(op: MetaMaskGaslessOperationRecord, approval: MetaMaskGaslessApprovalPort): Promise<MetaMaskGaslessStep>;
    run(op: MetaMaskGaslessOperationRecord): Promise<MetaMaskGaslessStep>;
    private guard;
    private halt;
}
