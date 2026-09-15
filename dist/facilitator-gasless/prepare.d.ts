import type { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import type { FacilitatorPort } from "./facilitator.js";
import { type FacilitatorOperationRecord, type FacilitatorRequest } from "./operation-model.js";
import type { FacilitatorGaslessRepositoryPort } from "./operation-repository.js";
import type { FacilitatorRpcPort } from "./rpc.js";
export interface FacilitatorPreparationOptions {
    readonly state: StateStore;
    readonly records: FacilitatorGaslessRepositoryPort;
    readonly operations: OperationService;
    readonly rpc: () => FacilitatorRpcPort;
    readonly facilitator: FacilitatorPort;
    readonly now: () => number;
}
export declare function facilitatorRequest(value: unknown): FacilitatorRequest;
/** Freezes one exact Avalanche USDC transfer; nothing is signed and no payment material leaves APN here. */
export declare class FacilitatorPreparation {
    private readonly o;
    constructor(o: FacilitatorPreparationOptions);
    prepare(input: {
        readonly profile: string;
        readonly request: unknown;
        readonly idempotencyKey: string;
    }): Promise<FacilitatorOperationRecord>;
}
