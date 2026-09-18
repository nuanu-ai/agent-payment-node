import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import type { Address } from "../model.js";
import type { ClockPort } from "../ports.js";
export declare const X402_PERMIT2_ALLOWLIST_SCHEMA: "apn.x402-permit2-allowlist.v1";
export interface X402Permit2AllowlistBinding {
    readonly schemaVersion: typeof X402_PERMIT2_ALLOWLIST_SCHEMA;
    readonly policyDigest: string;
    readonly policyRevision: number;
}
export interface X402Permit2AllowlistSubject {
    readonly profile: string;
    readonly operationId: string;
    /** The frozen EVM payer; must be the policy's owner EVM account. */
    readonly account: Address;
    readonly chain: string;
    readonly token: Address;
    readonly amountAtomic: string;
}
/** reserved -> exposed (signature left APN) -> finalized | unknown_finality; failed_before_effect only before exposure. */
export type X402Permit2UsageTarget = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect";
/** Owner allowlist gate for rail `x402`: exact list identity, the pinned Permit2 mechanism, per-rail caps and shared daily usage. */
export declare class X402Permit2AllowlistGate {
    private readonly context;
    private readonly ledger;
    constructor(context: {
        readonly state: {
            readonly root: string;
        };
        readonly clock: ClockPort;
    });
    /** Prepare: admitted now, including today's combined usage for the asset. Runs before any RPC, custody or signing call. */
    admit(subject: X402Permit2AllowlistSubject): Promise<X402Permit2AllowlistBinding>;
    /** After the foreground decision and before any signature: the same revision must still be active. Replays never double-reserve. */
    reserve(subject: X402Permit2AllowlistSubject, bindingValue: unknown): Promise<AssetUsageReservation>;
    /** Move the ledger forward to the operation's state. Idempotent; it never moves backward. */
    follow(subject: X402Permit2AllowlistSubject, target: X402Permit2UsageTarget, evidenceHash: string): Promise<void>;
    private active;
}
export declare function validateX402Permit2AllowlistBinding(value: unknown): X402Permit2AllowlistBinding;
export declare function x402Permit2UsageKey(operationId: string): string;
