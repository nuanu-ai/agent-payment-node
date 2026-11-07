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
    residualObservation(op: BridgeOperationRecord): Promise<{
        ok: true;
        value: {
            amountAtomic: string;
            block: import("./model.js").BridgeBlock;
            rpcOrigin: string;
        };
        observationTelemetry: readonly import("./operation-model.js").BridgeObservationTelemetry[];
        error?: never;
    } | {
        ok: false;
        error: unknown;
        observationTelemetry: readonly import("./operation-model.js").BridgeObservationTelemetry[];
        value?: never;
    }>;
    private residualFrom;
    /**
     * The end a destination proof decides: a composite's trace outcome, else a correlated delivery. A new proof (in
     * `carried`) is saved in the same terminal transition as its end, which the journal always admits; a proof saved on its
     * own earlier settles the same way. Only an undecided trace keeps a proof without an end.
     */
    private settleProof;
    /**
     * Proven delivery needs no residual read: the allowance was exactly the principal (or the native constant zero) and the
     * proven source Transfer consumed exactly that amount, so the residual at the safe bridge block is zero.
     */
    private finish;
    /** The residual is read first, so a new proof and this end are still one save. */
    private finishDestinationFailure;
    private destinationCandidate;
    private waiting;
}
export declare function replaceEffect(op: BridgeOperationRecord, effect: BridgeEffect): readonly BridgeEffect[];
export {};
