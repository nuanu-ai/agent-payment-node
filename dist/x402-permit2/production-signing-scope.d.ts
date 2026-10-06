import { StateStore } from "../state.js";
import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import { type Permit2MetadataMode } from "./production-signing-owner.js";
import { type Permit2ProductionRecord, type Permit2ProductionRepository } from "./production-repository.js";
export interface Permit2MetadataLockScope {
    readonly kind: "permit2-metadata-lock-scope";
}
/** An actual metadata lock callback only. No key, approval, signature or transport authority. */
export declare class Permit2MetadataLockOwner {
    #private;
    constructor(state: StateStore, records: Permit2ProductionRepository);
    within<T>(id: string, mode: Permit2MetadataMode, clock: () => Date, action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T>;
    assert(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode): void;
    assertTime(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, at: Date): void;
    onExit(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, close: () => void): () => void;
    owner(scope: Permit2MetadataLockScope, id: string, mode: Permit2MetadataMode, clock: () => Date, expected?: {
        readonly record: Permit2ProductionRecord;
        readonly lease: AssetUsageReservation;
    }): Promise<{
        record: Permit2ProductionRecord;
        lease: AssetUsageReservation;
    }>;
}
