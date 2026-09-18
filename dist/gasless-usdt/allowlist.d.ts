import { type AssetUsageReservation } from "../asset-usage-ledger.js";
import type { ClockPort } from "../ports.js";
export declare const USDT_GASLESS_ALLOWLIST_SCHEMA: "apn.gasless-usdt-allowlist.v1";
/** Frozen at prepare: the exact owner revision, and the caps and usage it admitted the transfer under. */
export interface UsdtGaslessAdmission {
    readonly schemaVersion: typeof USDT_GASLESS_ALLOWLIST_SCHEMA;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly maximumPerTransferAtomic: string;
    readonly dailyLimitAtomic: string;
    readonly dailyUsageAtomic: string;
}
export interface UsdtGaslessSubject {
    readonly profile: string;
    readonly operationId: string;
    /** Checksummed EVM owner account; the policy's `accounts.evm` must name it. */
    readonly account: string;
    /** Gross: the most this operation can debit (N + F). The ledger counts it, not the net. */
    readonly grossAtomic: string;
}
export type UsdtGaslessUsageTarget = "submitted" | "unknown_finality" | "finalized" | "failed_before_effect";
export declare function usdtGaslessUsageKey(operationId: string): string;
/**
 * Gate for rail `gasless` on USDT/Ethereum. The active owner policy must admit the asset on this rail with exactly the
 * pinned `{provider, reference}` mechanism, and the gross must fit the per-operation cap and today's shared usage.
 */
export declare class UsdtGaslessAllowlistGate {
    private readonly context;
    private readonly ledger;
    constructor(context: {
        readonly state: {
            readonly root: string;
        };
        readonly clock: ClockPort;
    });
    admit(subject: UsdtGaslessSubject): Promise<UsdtGaslessAdmission>;
    /** Approval, before any signature: the same revision must still be active; a replayed approval never reserves twice. */
    reserve(subject: UsdtGaslessSubject, admission: UsdtGaslessAdmission): Promise<AssetUsageReservation>;
    /** Move the ledger forward with the operation journal; idempotent so each observation can repair a lagging ledger. */
    follow(subject: UsdtGaslessSubject, target: UsdtGaslessUsageTarget, outcomeDigest: string): Promise<void>;
    private existing;
    private active;
}
