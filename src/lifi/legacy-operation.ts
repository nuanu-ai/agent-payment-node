import type { BridgeOperationRecord } from "./operation-model.js";
import { validateLegacyBridgeOperation } from "./operation-validation.js";

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

export function isLegacyBridgeOperation(op: StoredBridgeOperationRecord): op is LegacyBridgeOperationRecord {
  return op.schemaVersion === "apn.bridge-operation.legacy-view.v1";
}

export function adaptLegacyBridgeOperation(value: unknown): LegacyBridgeOperationRecord {
  const raw = validateLegacyBridgeOperation(value);
  const destination = raw.destinationProof as unknown as Record<string, unknown> | null;
  return {
    schemaVersion: "apn.bridge-operation.legacy-view.v1",
    durableSchemaVersion: "apn.bridge-operation.v1",
    profileHash: raw.profileHash,
    operationId: raw.operationId,
    idempotencyHash: raw.idempotencyHash,
    requestHash: raw.requestHash,
    fingerprint: raw.fingerprint,
    state: raw.state,
    terminal: raw.terminal,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    intent: raw.intent,
    raw,
    compatibility: {
      resumable: false,
      allowlistBinding: "legacy_unknown",
      usageLease: "legacy_unknown",
      nativeBalanceProof: destination !== null && Object.hasOwn(destination, "nativeBalance") ? "recorded" : "legacy_unknown",
      nativeTransferProof: "legacy_unknown",
    },
  };
}
