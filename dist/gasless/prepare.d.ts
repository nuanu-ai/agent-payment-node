import type { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import type { GaslessRequest } from "./model.js";
import type { GaslessOperationRecord } from "./operation-model.js";
import type { GaslessOperationRepository } from "./operation-repository.js";
import type { GaslessRpcFactory } from "./ports.js";
export interface GaslessPreparationOptions {
    readonly state: StateStore;
    readonly records: GaslessOperationRepository;
    readonly operations: OperationService;
    readonly rpcFor: GaslessRpcFactory;
    readonly now: () => number;
}
export declare class GaslessPreparation {
    private readonly o;
    constructor(o: GaslessPreparationOptions);
    prepare(input: {
        readonly profile: string;
        readonly request: GaslessRequest;
        readonly idempotencyKey: string;
    }): Promise<GaslessOperationRecord>;
}
