import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { type Permit2ProductionRecord, type Permit2ProductionRepository } from "./production-repository.js";
export type Permit2SigningMode = "reserved" | "exposed";
export type Permit2MetadataMode = Permit2SigningMode | "dispatch";
/** What a later step expects to find saved: the record's integrity hash, the lease digest and the wallet binding. */
export interface Permit2SavedIdentity {
    readonly recordHash: string;
    readonly leaseDigest: string;
    readonly walletHash: string;
}
export declare function permit2SavedIdentity(record: Permit2ProductionRecord, lease: AssetUsageReservation): Permit2SavedIdentity;
/** Only an owned exact self lease is excluded; no caller record or daily usage is accepted. */
export declare function signingOwnerFence(state: StateStore, records: Permit2ProductionRepository, id: string, mode: Permit2SigningMode, clock: () => Date, expected?: Permit2SavedIdentity): Promise<{
    record: Permit2ProductionRecord;
    lease: AssetUsageReservation;
}>;
/** Shared strict self-lease predicates only; callers must obtain the actual locked ledger snapshot. */
export declare function checkedSigningLease(record: Permit2ProductionRecord, lease: AssetUsageReservation | null, mode: Permit2MetadataMode, expected?: Permit2SavedIdentity): AssetUsageReservation;
export declare function assertSigningLifecycle(record: Permit2ProductionRecord, mode: Permit2MetadataMode): void;
