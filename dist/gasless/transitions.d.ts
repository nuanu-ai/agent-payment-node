import { type GaslessMutable, type GaslessOperationRecord } from "./operation-model.js";
import type { GaslessIntent } from "./model.js";
export declare function newGaslessOperation(input: {
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly intent: GaslessIntent;
}): GaslessOperationRecord;
export declare function transitionGasless(op: GaslessOperationRecord, patch: Partial<GaslessMutable>, at: string): GaslessOperationRecord;
export declare function gaslessAtTransition(op: GaslessOperationRecord, index: number): GaslessOperationRecord;
