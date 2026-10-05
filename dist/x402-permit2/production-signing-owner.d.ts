import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { type Permit2ProductionRecord, type Permit2ProductionRepository } from "./production-repository.js";
export type Permit2SigningMode = "reserved" | "exposed";
/** Only an owned exact self lease is excluded; no caller record or daily usage is accepted. */
export declare function signingOwnerFence(state: StateStore, records: Permit2ProductionRepository, id: string, mode: Permit2SigningMode, clock: () => Date, expected?: {
    readonly record: Permit2ProductionRecord;
    readonly lease: AssetUsageReservation;
}): Promise<{
    record: Permit2ProductionRecord;
    lease: AssetUsageReservation;
}>;
export declare function assertSigningLifecycle(record: Permit2ProductionRecord, mode: Permit2SigningMode): void;
