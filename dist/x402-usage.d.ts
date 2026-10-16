import { type AssetUsageReservation } from "./asset-usage-ledger.js";
import type { ClockPort } from "./ports.js";
import type { X402OperationRecord } from "./x402-state-model.js";
/** Persisted reservation key; stored holds are found by it, so it never changes. One operation holds one x402 reservation. */
export declare function x402UsageKey(operationId: string): string;
/**
 * Local x402 spend in the shared asset-usage ledger. The reservation is made before anything is signed, under the
 * frozen per-request cap of the profile x402 policy, and then follows the operation journal forward. The profile x402
 * policy has no daily cap, so none is applied here; the reservation makes x402 spend count in the shared daily usage
 * that every capped rail on the same account and asset reads.
 */
export declare class X402Usage {
    private readonly context;
    private readonly ledger;
    constructor(context: {
        readonly state: {
            readonly root: string;
        };
        readonly clock: ClockPort;
    });
    reserve(operation: X402OperationRecord): Promise<AssetUsageReservation>;
    /** Idempotent; every approve, resume and abandon repairs a lagging ledger. Operations approved before this ledger have none. */
    follow(operation: X402OperationRecord): Promise<void>;
}
