import type { SmartAccountGaslessIntent, SmartAccountGaslessMutable } from "./model.js";
import { type SmartAccountGaslessOperationIdentity, type SmartAccountGaslessOperationRecord } from "./operation-model.js";
export declare function validateSmartAccountGaslessOperation(value: unknown): SmartAccountGaslessOperationRecord;
export declare function validateSmartAccountGaslessContinuity(previous: SmartAccountGaslessOperationRecord, next: SmartAccountGaslessOperationRecord): void;
export declare function newSmartAccountGaslessOperation(identityInput: SmartAccountGaslessOperationIdentity, intent: SmartAccountGaslessIntent): SmartAccountGaslessOperationRecord;
export declare function advanceSmartAccountGaslessOperation(operation: SmartAccountGaslessOperationRecord, patch: Partial<SmartAccountGaslessMutable>, atInput: string): SmartAccountGaslessOperationRecord;
export declare function smartAccountGaslessAtTransition(operation: SmartAccountGaslessOperationRecord, index: number): SmartAccountGaslessOperationRecord;
/** Reserve two proof-bearing terminal events without letting a transient read erase a live guard. */
export declare function assertSmartAccountGaslessCapacity(operation: SmartAccountGaslessOperationRecord): void;
