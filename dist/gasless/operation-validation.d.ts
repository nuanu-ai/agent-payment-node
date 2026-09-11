import { type GaslessOperationRecord } from "./operation-model.js";
export declare function gaslessCorrupt(): never;
export declare function validateGaslessOperation(value: unknown): GaslessOperationRecord;
export declare function validateGaslessContinuity(previous: GaslessOperationRecord, next: GaslessOperationRecord): void;
