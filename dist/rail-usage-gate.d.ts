import type { CandidateFamily } from "./allowlist-inventory.js";
import { type AssetPolicyRail } from "./asset-policy-registry.js";
import { type AssetUsageIdentity, type AssetUsageReservation } from "./asset-usage-ledger.js";
import type { ClockPort } from "./ports.js";
/** One money operation of any rail, as the owner's allowlist and the shared asset-usage ledger see it. */
export interface RailUsageSubject extends AssetUsageIdentity {
    /** The allowlist policy profile whose active owner policy must admit the payment. */
    readonly profile: string;
    /** The owner-account family the active policy names for `account`. */
    readonly family: CandidateFamily;
    readonly rail: Exclude<AssetPolicyRail, "direct" | "swap">;
    readonly operationId: string;
    readonly amountAtomic: string;
    /** The exact mechanism the rail executes; the policy row must pin exactly this mechanism for the rail. */
    readonly mechanism: Readonly<{
        provider: string;
        reference: string;
    }>;
}
/** Where the owning journal says the effect is. The ledger only follows it forward. */
export type RailUsageTarget = "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "released_unsubmitted" | "failed_confirmed_revert";
/** One reservation per operation and rail: a replayed approval can never reserve twice. */
export declare function railUsageKey(rail: RailUsageSubject["rail"], operationId: string): string;
/**
 * The shared cap hook for rails that do not yet bind an allowlist revision at prepare (local x402 first).
 * `reserveBeforeEffect` runs after every pre-check and before any signature or provider call: the owner's active
 * policy must admit this account, asset, rail and mechanism, and today's shared asset usage plus this amount must
 * fit the per-operation and daily caps. The owning journal then calls `follow` after each durable transition.
 */
export declare class RailUsageGate {
    private readonly context;
    private readonly ledger;
    constructor(context: {
        readonly state: {
            readonly root: string;
        };
        readonly clock: ClockPort;
    });
    reserveBeforeEffect(subject: RailUsageSubject): Promise<AssetUsageReservation>;
    /** Idempotent, so every resume can repair a lagging ledger. A missing reservation is corrupt unless nothing was spent. */
    follow(subject: RailUsageSubject, target: RailUsageTarget, evidenceHash: string): Promise<void>;
    reservation(subject: RailUsageSubject): Promise<AssetUsageReservation | null>;
    private active;
}
