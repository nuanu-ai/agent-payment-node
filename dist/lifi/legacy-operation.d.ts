import type { BridgeOperationRecord } from "./operation-model.js";
/** In-memory, read-only adapter for journals emitted before the allowlist upgrade. */
export interface LegacyBridgeOperationRecord {
    readonly schemaVersion: "apn.bridge-operation.legacy-view.v1";
    readonly durableSchemaVersion: "apn.bridge-operation.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly state: BridgeOperationRecord["state"];
    readonly terminal: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly intent: BridgeOperationRecord["intent"];
    readonly raw: BridgeOperationRecord;
    readonly compatibility: {
        readonly resumable: false;
        readonly allowlistBinding: "legacy_unknown";
        readonly usageLease: "legacy_unknown";
        readonly nativeBalanceProof: "recorded" | "legacy_unknown";
        readonly nativeTransferProof: "legacy_unknown";
    };
}
export type StoredBridgeOperationRecord = BridgeOperationRecord | LegacyBridgeOperationRecord;
export declare function isLegacyBridgeOperation(op: StoredBridgeOperationRecord): op is LegacyBridgeOperationRecord;
export declare function adaptLegacyBridgeOperation(value: unknown): LegacyBridgeOperationRecord;
