import { SecureStateStore } from "../../secure-state-store.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { type HistoricalRetirementRecord } from "./historical-retirement-record.js";
/** Existing-owned public records only. No initialize/create/commit/mint method is provided. */
export declare class JupiterHistoricalRetirementReader extends SecureStateStore {
    initialize(): Promise<void>;
    protected ensureDirectory(): Promise<void>;
    forBucket(identity: AssetUsageIdentity, rows: readonly AssetUsageReservation[]): Promise<readonly HistoricalRetirementRecord[]>;
    protected writeJson(): Promise<void>;
    private originalRowRawHash;
}
/** Pin local identity at commit and compare it on every later read; never hardcode host inode values. */
export declare function historicalRetirementRootSnapshot(root: string): Promise<string>;
