import { type SmartAccountGaslessOperationRecord, type SmartAccountGaslessPublicOperation, type SmartAccountGaslessReceipt } from "./operation-model.js";
export declare function publicSmartAccountGaslessOperation(operation: SmartAccountGaslessOperationRecord): SmartAccountGaslessPublicOperation;
export declare function smartAccountGaslessReceipt(operation: SmartAccountGaslessOperationRecord): SmartAccountGaslessReceipt;
/** A stale sidecar is repairable only if it is an exact derivative of an authenticated history prefix. */
export declare function validateSmartAccountGaslessReceipt(value: unknown, operation: SmartAccountGaslessOperationRecord): SmartAccountGaslessReceipt;
