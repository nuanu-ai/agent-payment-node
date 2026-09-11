import { type BridgeEffect, type BridgeIntent, type BridgeMutable, type BridgeOperationRecord } from "./operation-model.js";
export declare function newBridgeOperation(input: {
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly intent: BridgeIntent;
    readonly effects: readonly BridgeEffect[];
}): BridgeOperationRecord;
export declare function transitionBridge(op: BridgeOperationRecord, patch: Partial<BridgeMutable>, at: string): BridgeOperationRecord;
export declare function bridgeAtTransition(op: BridgeOperationRecord, index: number): BridgeOperationRecord;
