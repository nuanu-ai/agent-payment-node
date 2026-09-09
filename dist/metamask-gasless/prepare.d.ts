import type { OperationService } from "../operation-service.js";
import type { ClockPort, IdPort } from "../ports.js";
import type { StateStore } from "../state.js";
import { type MetaMaskGaslessRequest } from "./model.js";
import { type MetaMaskGaslessOperationRecord } from "./operation-model.js";
import type { MetaMaskGaslessProviderPort, MetaMaskGaslessRepositoryPort, MetaMaskGaslessRpcFactory } from "./ports.js";
export interface MetaMaskGaslessPreparationOptions {
    readonly state: StateStore;
    readonly records: MetaMaskGaslessRepositoryPort;
    readonly operations: OperationService;
    readonly rpcFor: MetaMaskGaslessRpcFactory;
    readonly provider: MetaMaskGaslessProviderPort;
    readonly clock: ClockPort;
    readonly ids: IdPort;
}
export declare class MetaMaskGaslessPreparation {
    private readonly o;
    constructor(o: MetaMaskGaslessPreparationOptions);
    prepare(input: {
        readonly profile: string;
        readonly request: MetaMaskGaslessRequest;
        readonly idempotencyKey: string;
    }): Promise<MetaMaskGaslessOperationRecord>;
}
