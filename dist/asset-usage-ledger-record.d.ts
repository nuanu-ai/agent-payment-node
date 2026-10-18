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
/**
 * The day's usage at `now`: every open hold, and every spend whose effect is stamped on now's UTC day or later. A stamp
 * after the clock (the clock moved back below the bucket's newest stamp) still counts: a read never drops a record
 * because its stamp is in the future (R9).
 */
export declare function sumUsage(records: readonly AssetUsageReservation[], now: Date): string;
export declare function assertReplay(record: AssetUsageReservation, policyDigest: string, registryVersion: string, rail: AssetPolicyRail, amount: string, idempotencyHash: string): void;
/**
 * A ledger write's stamp: the clock, but never earlier than the newest stamp stored in its bucket. When the clock moves
 * back (NTP correction, manual change) a write is neither refused nor stamped before a record it follows, so a payment
 * can never be backdated out of a later day's cap (R9).
 */
export declare function bucketStamp(records: readonly AssetUsageReservation[], now: Date): string;
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
