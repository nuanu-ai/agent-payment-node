import { type CircleOperationV1 } from "./operation-model.js";
import type { Cleanup86Intent } from "./cleanup86-store.js";
import type { Cleanup86FirstDispatchPurpose } from "./cleanup86-first-dispatch-purpose.js";
import type { Cleanup86FileIdentity, Cleanup86Snapshot } from "./cleanup86-snapshot.js";
export interface Cleanup86FirstDispatchAnchor {
    readonly version: "apn.circle-cleanup86-first-dispatch-anchor.v1";
    readonly purpose: Cleanup86FirstDispatchPurpose;
    readonly originalParent: CircleOperationV1;
    readonly originalSnapshotHash: string;
    readonly originalArtifacts: Readonly<Record<string, Cleanup86FileIdentity>>;
    readonly anchorHash: string;
}
export interface Cleanup86FirstDispatchHistory {
    readonly version: "apn.circle-cleanup86-first-dispatch-history.v1";
    readonly anchorHash: string;
    readonly intentHash: string;
    readonly transactionHash: string;
    readonly materialHash: string;
    readonly phase: "authorized" | "submission_started" | "unknown";
    readonly sequence: number;
    readonly previousHash: string | null;
    readonly historyHash: string;
}
export declare function validateCleanup86FirstDispatchAnchor(v: unknown, i: Cleanup86Intent): Cleanup86FirstDispatchAnchor;
export declare function validateCleanup86FirstDispatchHistory(v: unknown, a: Cleanup86FirstDispatchAnchor): Cleanup86FirstDispatchHistory;
/** Observer/storage authentication only; persisted authorization is never a live capability. */
export declare function assertCleanup86FirstDispatchRecords(s: Cleanup86Snapshot, root: string, op: CircleOperationV1, i: Cleanup86Intent): void;
