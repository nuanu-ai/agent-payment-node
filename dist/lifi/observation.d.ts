import { type BridgeEffect, type BridgeMutable, type BridgeOperationRecord } from "./operation-model.js";
import type { BridgeRpcPort, LifiProviderPort } from "./ports.js";
export type BridgeSave = (op: BridgeOperationRecord, patch: Partial<BridgeMutable>) => Promise<BridgeOperationRecord>;
type LazyRpc = BridgeRpcPort | (() => BridgeRpcPort);
export declare class BridgeObservation {
    private readonly sourcePort;
    private readonly destinationPort;
    private readonly provider;
    private readonly save;
    private readonly residualPort;
    constructor(sourcePort: LazyRpc, destinationPort: LazyRpc, provider: LifiProviderPort, save: BridgeSave, residualPort?: LazyRpc);
    private source;
    private destination;
    private residualSource;
    sources(op: BridgeOperationRecord): Promise<{
        operation: BridgeOperationRecord;
        reliable: boolean;
    }>;
    destinationProof(op: BridgeOperationRecord): Promise<BridgeOperationRecord>;
    residual(op: BridgeOperationRecord): Promise<{
        amountAtomic: string;
        block: import("./model.js").BridgeBlock;
        rpcOrigin: string;
    }>;
    private finish;
    private finishDestinationFailure;
    private destinationCandidate;
    private waiting;
    private historicalDeployment;
}
export declare function replaceEffect(op: BridgeOperationRecord, effect: BridgeEffect): readonly BridgeEffect[];
export {};
