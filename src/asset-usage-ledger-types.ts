import type { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW } from "./asset-usage-ledger-record.js";
import type { AssetPolicyRail } from "./asset-policy-registry.js";
import type { MerchantNativeActualFee } from "./x402-merchant/fee-settlement.js";
import type { Cleanup85NativeReservationMarker } from "./asset-usage-ledger-cleanup85-native.js";
import type { Cleanup85NativeActualSettlement } from "./circle-cleanup85-native-ledger-authority.js";

export type AssetUsageState =
  | "reserved"
  | "submitted"
  | "unknown_finality"
  | "finalized"
  | "failed_before_effect"
  /** Payment was never submitted and a terminal proof closes any earlier authorization exposure. */
  | "released_unsubmitted"
  /** A sent effect that is proven reverted at a finalized block releases its principal. */
  | "failed_confirmed_revert";

export interface AssetUsageIdentity {
  /** Stable canonical identity for the paying account; aliases must be resolved by the caller. */
  readonly account: string;
  readonly chain: string;
  readonly asset: Readonly<{ kind: "native"; identifier: null } | { kind: "token"; identifier: string }>;
}

export interface AssetUsageReservation extends AssetUsageIdentity {
  readonly schemaVersion: typeof ASSET_USAGE_RESERVATION_SCHEMA;
  readonly reservationId: string;
  readonly idempotencyHash: string;
  readonly policyDigest: string;
  readonly registryVersion: string;
  readonly rail: AssetPolicyRail;
  readonly amountAtomic: string;
  /** Proven asset consumption on a confirmed revert; absent on historical zero-consumption records. */
  readonly consumedAtomic?: string;
  readonly merchantNativeActualFee?: MerchantNativeActualFee;
  readonly metamaskNativeReservation?: {readonly operationId:string;readonly quoteHash:string};
  readonly metamaskNativeActualFee?: {readonly kind:"metamask_native_actual_fee";readonly operationId:string;readonly quoteHash:string;readonly receiptHash:string;readonly actualFee:string;readonly reservedFee:string};
  readonly cleanup85NativeReservation?: Cleanup85NativeReservationMarker;
  readonly cleanup85NativeActual?: Cleanup85NativeActualSettlement;
  readonly state: AssetUsageState;
  readonly reservedAt: string;
  readonly updatedAt: string;
  /** Set when a finalized effect or proven reverted consumption is charged to a UTC day. */
  readonly effectAt: string | null;
  /** Required terminal proof binding; the proof itself remains in the owning rail. */
  readonly outcomeDigest: string | null;
  readonly reservationDigest: string;
}

export interface AssetUsageReserveInput extends AssetUsageIdentity {
  readonly registry: unknown;
  readonly rail: AssetPolicyRail;
  readonly mechanism?: Readonly<{ provider: string; reference: string }>;
  readonly amountAtomic: string;
  readonly idempotencyKey: string;
  readonly now: Date;
  /** Relay-only recovery: caller has proved no journal, signing marker, custody bytes, or send risk. */
  readonly retryFailedBeforeEffect?: boolean;
}

export interface AssetUsageTransitionInput extends AssetUsageIdentity {
  readonly reservationId: string;
  readonly policyDigest: string;
  readonly state: Exclude<AssetUsageState, "reserved">;
  readonly now: Date;
  readonly outcomeDigest?: string;
  /** Exact asset consumed on a confirmed revert, such as a gasless USDC fee. */
  readonly consumedAtomic?: string;
  /** Optional compare-and-transition guard, checked atomically while the bucket lock is held. */
  readonly expectedCurrentStates?: readonly AssetUsageState[];
}

/** Permit2 production only: caller durably proved no authorization exposure before cancellation. */
export interface CancelUnsubmittedReservationInput extends AssetUsageIdentity {
  readonly chain: "eip155:43114";
  readonly asset: { readonly kind: "token"; readonly identifier: string };
  readonly idempotencyKey: `x402-permit2-production.v2:${string}`;
  readonly policyDigest: string;
  readonly registryVersion: string;
  readonly rail: "x402";
  readonly amountAtomic: string;
  readonly outcomeDigest: string;
  readonly now: Date;
}

export interface AssetUsageSnapshot {
  readonly windowPolicy: typeof ASSET_USAGE_WINDOW;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly amountAtomic: string;
}

export type ReservationBody = Omit<AssetUsageReservation, "reservationDigest">;

