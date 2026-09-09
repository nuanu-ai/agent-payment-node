import type { ClockPort } from "../ports.js";
import type { StateStore } from "../state.js";
import type { MetaMaskGaslessOperationRecord } from "./operation-model.js";
import { type MetaMaskGaslessSave, type MetaMaskGaslessStep } from "./observation.js";
import type { MetaMaskGaslessApprovalPort, MetaMaskGaslessProviderPort, MetaMaskGaslessRpcFactory } from "./ports.js";
export declare class MetaMaskGaslessExecution {
    private readonly state;
    private readonly rpcFor;
    private readonly provider;
    private readonly save;
    private readonly clock;
    private readonly observation;
    constructor(state: StateStore, rpcFor: MetaMaskGaslessRpcFactory, provider: MetaMaskGaslessProviderPort, clock: ClockPort, save: MetaMaskGaslessSave);
    approve(op: MetaMaskGaslessOperationRecord, approval: MetaMaskGaslessApprovalPort): Promise<MetaMaskGaslessStep>;
    run(op: MetaMaskGaslessOperationRecord): Promise<MetaMaskGaslessStep>;
    private guard;
    private halt;
}
