import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import type { StateStore } from "./state.js";
import type { OperationRecord } from "./model.js";
import { type Cleanup85NativeLineage } from "./circle-cleanup85-unsigned-retirement.js";
/** Only the source-owned private resolver can select the one immutable lineage. */
export declare function cleanup85NativeLineage(state: StateStore, request: Cleanup85CancellationRequest): Promise<Cleanup85NativeLineage>;
export declare function cleanup85NativeSlotKind(lineage: Cleanup85NativeLineage): "slot" | "successor-slot";
export declare function cleanup85NativeRequestHash(request: Cleanup85CancellationRequest, lineage: Cleanup85NativeLineage): string;
export declare function cleanup85NativeSlotBody(o: OperationRecord, lineage: Cleanup85NativeLineage): {
    version: string;
    parentOperationId: "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
    oldCleanupMaterialHash: "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
    requestBinding: string;
    operationId: string;
    fingerprint: string;
} | {
    version: string;
    originalOperationId: string;
    retirementProofHash: string;
    parentOperationId: "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
    oldCleanupMaterialHash: "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
    requestBinding: string;
    operationId: string;
    fingerprint: string;
};
/** Pure comparison is not a grant; callers first resolve private durable lineage. */
export declare function assertCleanup85NativeLineageOperation(state: StateStore, o: OperationRecord, lineage: Cleanup85NativeLineage): void;
