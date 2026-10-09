import type { Cleanup85NativeReservationBody } from "./circle-cleanup85-native-ledger-authority.js";
import type { AssetUsageReservation } from "./asset-usage-ledger.js";
export interface Cleanup85NativeReservationMarker {
    readonly version: "apn.cleanup85-native-reservation.v1";
    readonly operationId: string;
    readonly fingerprint: string;
    readonly requestBinding: string;
    readonly envelopeHash: string;
    readonly signedMaximumDebitAtomic: string;
    readonly reservedAtomic: "2000000000000";
    readonly policyDigest: string;
    readonly activationDigest: string;
}
/** Data projection of the opaque verified body, never an authority creator. */
export declare function cleanup85NativeReservationMarker(b: Cleanup85NativeReservationBody): Cleanup85NativeReservationMarker;
export declare function sameCleanup85NativeMarker(value: unknown, b: Cleanup85NativeReservationBody): boolean;
/** Stored public accounting data only. The root-owned opaque getter authorizes all ledger writes. */
export declare function validateCleanup85NativeUsage(value: Record<string, unknown>): void;
/** One public permanent slot and one operation only; never a profile/global scan. */
export declare function assertCleanup85GenericCapacityRelease(root: string, row: AssetUsageReservation): Promise<void>;
