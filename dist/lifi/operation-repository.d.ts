import { SecureStateStore } from "../secure-state-store.js";
import { type BridgeOperationRecord } from "./operation-model.js";
import { type BridgeReceipt } from "./receipt.js";
import { type LegacyBridgeOperationRecord, type StoredBridgeOperationRecord } from "./legacy-operation.js";
import type { BridgeDeploymentMigrationAudit } from "./deployment-migration.js";
import type { BaseDeploymentMigrationAudit } from "./base-deployment-migration.js";
export declare class BridgeOperationRepository extends SecureStateStore {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<BridgeOperationRecord | null>;
    loadStoredOperation(profileHash: string, operationId: string): Promise<StoredBridgeOperationRecord | null>;
    findStoredOperation(operationId: string): Promise<StoredBridgeOperationRecord | null>;
    listStoredOperations(profileHash: string): Promise<readonly StoredBridgeOperationRecord[]>;
    listAllStoredOperations(): Promise<readonly StoredBridgeOperationRecord[]>;
    findOperation(operationId: string): Promise<BridgeOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly BridgeOperationRecord[]>;
    listAllOperations(): Promise<readonly BridgeOperationRecord[]>;
    writeOperation(op: BridgeOperationRecord): Promise<void>;
    /** Caller holds the same profile/operation locks as every other money service. */
    persist(op: BridgeOperationRecord): Promise<void>;
    repairReceipt(op: BridgeOperationRecord): Promise<void>;
    /** Caller holds the profile and operation locks. The audit-first order makes an interrupted repair resumable. */
    migrateDeployment(previous: BridgeOperationRecord, next: BridgeOperationRecord, audit: BridgeDeploymentMigrationAudit): Promise<void>;
    /** Complete or verify the derived receipt after an audit-first migration was interrupted. */
    repairMigratedDeployment(previous: BridgeOperationRecord, op: BridgeOperationRecord, audit: BridgeDeploymentMigrationAudit): Promise<void>;
    /** One exact pre-allowlist Base journal can be promoted without relaxing normal legacy loading. */
    migrateLegacyDeployment(previous: BridgeOperationRecord, next: BridgeOperationRecord, audit: BaseDeploymentMigrationAudit): Promise<void>;
    /** Finish or verify the receipt replacement after the legacy operation was atomically replaced. */
    repairMigratedLegacyDeployment(previous: BridgeOperationRecord, op: BridgeOperationRecord, audit: BaseDeploymentMigrationAudit): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<BridgeReceipt>;
    loadLegacyReceipt(op: LegacyBridgeOperationRecord): Promise<Record<string, unknown>>;
    private path;
}
