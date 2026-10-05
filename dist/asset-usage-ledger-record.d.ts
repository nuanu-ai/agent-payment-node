import { ApnError } from "./errors.js";
import type { AssetPolicyRail } from "./asset-policy-registry.js";
import type { AssetUsageIdentity, AssetUsageReservation, AssetUsageState } from "./asset-usage-ledger.js";
export declare const ASSET_USAGE_RESERVATION_SCHEMA: "apn.asset-usage-reservation.v1";
/** Existing chain-policy convention: [00:00:00.000Z, next 00:00:00.000Z). */
export declare const ASSET_USAGE_WINDOW: "utc-calendar-day";
type ReservationBody = Omit<AssetUsageReservation, "reservationDigest">;
/** The reservation id that `reserve` creates or replays for this exact identity and idempotency key. */
export declare function assetUsageReservationId(identityValue: AssetUsageIdentity, idempotencyKey: string): string;
export declare function validateAssetUsageReservation(value: unknown): AssetUsageReservation;
export declare function expectedStates(value: readonly AssetUsageState[]): readonly AssetUsageState[];
export declare function reservationIdFor(identity: AssetUsageIdentity, idempotencyHash: string): string;
export declare function seal(body: ReservationBody): AssetUsageReservation;
export declare function sumUsage(records: readonly AssetUsageReservation[], now: Date): string;
export declare function assertReplay(record: AssetUsageReservation, policyDigest: string, registryVersion: string, rail: AssetPolicyRail, amount: string, idempotencyHash: string): void;
export declare function assertBucketWindow(records: readonly AssetUsageReservation[], at: string): void;
export declare function assertTransition(from: AssetUsageState, to: Exclude<AssetUsageState, "reserved">): void;
export declare function validateIdentity(value: AssetUsageIdentity, stored?: boolean): AssetUsageIdentity;
export declare function exactIdentity(value: AssetUsageIdentity): AssetUsageIdentity;
export declare function exactAsset(value: {
    readonly kind: "native" | "token";
    readonly identifier: string | null;
}): AssetUsageIdentity["asset"];
export declare function withoutDigest(value: AssetUsageReservation): ReservationBody;
export declare function canonicalAccount(chain: string, value: unknown, stored: boolean): string;
export declare function idempotency(value: unknown): string;
export declare function atomic(value: unknown, positive: boolean, stored: boolean): bigint;
export declare function instant(value: Date): string;
export declare function digest(value: unknown, label: string, stored?: boolean): string;
export declare function invalid(message: string): never;
export declare function blocked(message: string): ApnError;
export declare function corrupt(message: string): never;
export {};
