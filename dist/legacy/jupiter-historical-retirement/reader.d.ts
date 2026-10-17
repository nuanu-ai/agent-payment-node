import { SecureStateStore } from "../../secure-state-store.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { type HistoricalRetirementRecord } from "./record.js";
/**
 * Read-only usage projection of `jupiter-historical-retirements/` records, kept so a state that holds one still loads
 * its SOL usage bucket. The writer was removed after 0.5.44; nothing in APN creates these records any more.
 */
export declare class JupiterHistoricalRetirementReader extends SecureStateStore {
    initialize(): Promise<void>;
    protected ensureDirectory(): Promise<void>;
    forBucket(identity: AssetUsageIdentity, rows: readonly AssetUsageReservation[]): Promise<readonly HistoricalRetirementRecord[]>;
    private readBucketEntries;
    protected writeJson(): Promise<void>;
    /** Narrow authenticated read of the original reservation row a record binds; never returns row bytes. */
    originalReservationRawHash(identity: AssetUsageIdentity, id: string): Promise<string>;
}
/** Pin local identity at commit and compare it on every later read; never hardcode host inode values. */
export declare function historicalRetirementRootSnapshot(root: string): Promise<string>;
