import type { OperationService } from "../operation-service.js";
import type { ClockPort } from "../ports.js";
import type { StateStore } from "../state.js";
import { type SmartAccountGaslessRequest } from "./model.js";
import { type SmartAccountGaslessOperationRecord } from "./operation-model.js";
import type { SmartAccountGaslessMaterialPort, SmartAccountGaslessProviderPort, SmartAccountGaslessRepositoryPort, SmartAccountGaslessRpcFactory } from "./ports.js";
export interface SmartAccountGaslessPreparationOptions {
    readonly state: StateStore;
    readonly records: SmartAccountGaslessRepositoryPort;
    readonly operations: OperationService;
    readonly material: SmartAccountGaslessMaterialPort;
    readonly provider: SmartAccountGaslessProviderPort;
    readonly rpcFor: SmartAccountGaslessRpcFactory;
    readonly clock: ClockPort;
}
export declare class SmartAccountGaslessPreparation {
    private readonly o;
    constructor(o: SmartAccountGaslessPreparationOptions);
    prepare(input: {
        readonly profile: string;
        readonly request: SmartAccountGaslessRequest;
        readonly idempotencyKey: string;
    }): Promise<SmartAccountGaslessOperationRecord>;
}
