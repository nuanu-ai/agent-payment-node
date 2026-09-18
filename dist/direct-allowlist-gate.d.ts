import { type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import { type CandidateAsset, type CandidateFamily } from "./allowlist-inventory.js";
import { type AssetUsageIdentity } from "./asset-usage-ledger.js";
import { type DirectAssetUsageLease } from "./direct-asset-usage.js";
import type { ClockPort } from "./ports.js";
export declare const DIRECT_ALLOWLIST_SCHEMA: "apn.direct-allowlist.v1";
/** Frozen at prepare: the exact owner policy revision that admitted the transfer. */
export interface DirectAllowlistBinding {
    readonly schemaVersion: typeof DIRECT_ALLOWLIST_SCHEMA;
    readonly policyDigest: string;
    readonly policyRevision: number;
}
export interface DirectAllowlistSubject extends AssetUsageIdentity {
    readonly profile: string;
    readonly operationId: string;
    readonly family: CandidateFamily;
    readonly amountAtomic: string;
}
export type DirectAllowlistRefusal = "allowlist_network_unlisted" | "allowlist_asset_unlisted" | "allowlist_decimals_mismatch" | "allowlist_network_not_enabled" | "allowlist_policy_required" | "allowlist_policy_expired" | "allowlist_policy_not_effective" | "allowlist_policy_changed" | "allowlist_account_mismatch" | "allowlist_direct_not_admitted" | "allowlist_per_transfer_cap_exceeded" | "allowlist_daily_cap_exceeded" | "allowlist_binding_missing";
/** Where the owning journal says the effect is. The ledger follows it forward and never moves backward. */
export type DirectUsageTarget = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert";
/** The frozen-list row for a direct transfer. Pure: it runs before any RPC, custody or signing call. */
export declare function requireListedDirectAsset(chain: string, asset: AssetUsageIdentity["asset"]): CandidateAsset;
/** The reservation idempotency key is derived from the operation, so a replayed approval can never reserve twice. */
export declare function directUsageKey(operationId: string): string;
export declare class DirectAllowlistGate {
    private readonly context;
    private readonly ledger;
    private readonly adapter;
    constructor(context: {
        readonly state: {
            readonly root: string;
        };
        readonly clock: ClockPort;
    });
    /** Prepare: the active owner policy must admit this exact transfer now, including the asset's shared usage today. */
    admit(subject: DirectAllowlistSubject): Promise<DirectAllowlistBinding>;
    /**
     * Approval: after the foreground decision and before any signature. The same policy revision must still be active.
     * A reservation left by an interrupted approval is replayed, never duplicated.
     */
    reserve(subject: DirectAllowlistSubject, bindingValue: unknown): Promise<DirectAssetUsageLease>;
    /** The prepared policy revision must still be the active one, for the same owner account. Reads no ledger state. */
    confirm(subject: DirectAllowlistSubject, bindingValue: unknown): Promise<ActiveAssetPolicy>;
    /** Move the ledger forward to the journal's state. Idempotent, so every resume can repair a lagging ledger. */
    follow(subject: DirectAllowlistSubject, target: DirectUsageTarget, evidenceHash: string): Promise<void>;
    private existing;
    private active;
}
export declare function validateDirectAllowlistBinding(value: unknown): DirectAllowlistBinding;
/** The journal keeps the lease exactly as reserved; it must name this operation's exact identity, amount and policy. */
export declare function validateDirectAllowlistLease(value: unknown, binding: DirectAllowlistBinding, subject: DirectAllowlistSubject): DirectAssetUsageLease;
export declare function publicDirectAllowlist(binding: DirectAllowlistBinding, lease: DirectAssetUsageLease | undefined): unknown;
export declare function refuse(reason: DirectAllowlistRefusal, message: string, details?: Readonly<Record<string, string | readonly string[]>>): never;
