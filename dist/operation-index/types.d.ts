/**
 * The operation index is a derived, rebuildable cache over the family journals (which stay the only source of truth).
 * It stores only what lookups and the one-operation-per-account guard need; deleting `operation-index/` is always safe.
 */
export declare const OPERATION_FAMILIES: readonly ["direct_transfer", "x402_fetch", "rail_transfer", "bridge_route", "gasless_transfer", "metamask_gasless_transfer", "smart_account_gasless_transfer", "facilitator_gasless_transfer", "circle_route", "merchant_x402", "permit2_production", "relay_unsigned", "sei_gaszip", "mega_gaszip", "swap", "uniswap_token", "stargate_native", "stargate_token", "gasless_usdt", "oneclick_source", "circle_source", "circle_approval", "metamask_native", "x402_solana", "permit2_allowance"];
export type OperationFamily = typeof OPERATION_FAMILIES[number];
/**
 * A claim key is one of: an account `evm:<chainId>:<lowercase account>`, `solana:<genesis>:<address>`,
 * `tron:<genesis>:<address>` (the existing conflict-domain keys); `profile:<profileHash>` (held by every open entry,
 * wanted only by profile-wide admissions); `provider:<providerId>:<accountBindingHash>` and
 * `provider-payer:<providerId>:<lowercase payer>`; or a quarantine key (`unreadable:<profileHash>`,
 * `unreadable-family:<family>`, `unreadable-provider`) held by an unreadable record whose accounts are unknown.
 * An exclusive claim conflicts with any claim on the same key; shared claims coexist only with shared claims.
 */
export interface OperationClaim {
    readonly key: string;
    readonly shared?: true;
}
export type OperationIndexState = "admitted" | "active" | "terminal" | "unreadable" | "released";
export type UnreadableReason = "record_invalid" | "record_not_json" | "duplicate_operation_id";
export declare const OPERATION_INDEX_ENTRY_SCHEMA = "apn.operation-index-entry.v1";
export interface OperationIndexEntry {
    readonly schemaVersion: typeof OPERATION_INDEX_ENTRY_SCHEMA;
    readonly operationId: string;
    readonly family: OperationFamily;
    /** Null only for an unreadable record whose path and bytes name no profile. */
    readonly profileHash: string | null;
    readonly idempotencyHash: string | null;
    readonly requestHash: string | null;
    /** Relative to the state root, e.g. `operations/<profileHash>/<operationId>.json`. */
    readonly recordPath: string;
    /** Sorted by key; empty once terminal or released. */
    readonly claims: readonly OperationClaim[];
    readonly state: OperationIndexState;
    /** ISO time of an `admit` without a record yet (its lease); null for every entry derived from a record. */
    readonly admittedAt: string | null;
    readonly unreadableReason?: UnreadableReason;
}
export interface PrepareIdentity {
    readonly family: OperationFamily;
    readonly profileHash: string;
    readonly operationId: string;
    /** Null for a family whose operation ID is itself derived from its profile and key, so replay is by ID alone. */
    readonly idempotencyHash: string | null;
    readonly requestHash: string | null;
}
/**
 * Family coexistence the generic rule cannot express, evaluated on the blocker's loaded record by `adapter.admits`:
 * R8 native Arbitrum beside a Circle source whose burn is final (for this exact account), and another Circle route
 * queueing a source nonce after the blocker's canonical burn.
 */
export type WantedTag = {
    readonly kind: "native_beside_settled_circle";
    readonly account: string;
} | {
    readonly kind: "circle_source_after_burn";
};
export interface WantedClaims {
    /** The admitting family; null when the caller does not state it, which then wants every family quarantine. */
    readonly family: OperationFamily | null;
    /** The admitting profile; null for provider-account checks that span profiles. */
    readonly profileHash: string | null;
    readonly claims: readonly OperationClaim[];
    /** Held by an admission besides `claims` but never wanted, such as a second profile the operation signs for. */
    readonly holds?: readonly OperationClaim[];
    /** Wanted besides `claims` but never held, such as that second profile's quarantine. */
    readonly waits?: readonly OperationClaim[];
    readonly tag?: WantedTag;
    /** The caller's own saved operation, whose claims never block itself. */
    readonly except?: string;
}
export declare const profileClaim: (profileHash: string) => OperationClaim;
export declare const unreadableProfileClaim: (profileHash: string) => OperationClaim;
export declare const unreadableFamilyClaim: (family: OperationFamily) => OperationClaim;
/** Held by an unreadable direct or x402 record that may have been a provider operation. */
export declare const UNREADABLE_PROVIDER_CLAIM: OperationClaim;
export declare function providerClaims(providerId: string, accountBindingHash: string, payer: string): readonly OperationClaim[];
/** Deduplicated (an exclusive claim wins over a shared one on the same key) and sorted by key. */
export declare function normalizeClaims(claims: readonly OperationClaim[]): readonly OperationClaim[];
/** The held claims that collide with the wanted ones under the exclusive/shared rule. */
export declare function collidingClaims(held: readonly OperationClaim[], wanted: readonly OperationClaim[]): readonly OperationClaim[];
