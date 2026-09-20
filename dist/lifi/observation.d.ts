import { type BridgeEffect, type BridgeMutable, type BridgeOperationRecord } from "./operation-model.js";
import type { BridgeRpcPort, LifiProviderPort } from "./ports.js";
export type BridgeSave = (op: BridgeOperationRecord, patch: Partial<BridgeMutable>) => Promise<BridgeOperationRecord>;
export declare class BridgeObservation {
    private readonly source;
    private readonly destination;
    private readonly provider;
    private readonly save;
    constructor(source: BridgeRpcPort, destination: BridgeRpcPort, provider: LifiProviderPort, save: BridgeSave);
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
    private scan;
    private waiting;
    private historicalDeployment;
}
export declare function replaceEffect(op: BridgeOperationRecord, effect: BridgeEffect): readonly BridgeEffect[];
