import { type HeldCleanup85Scope } from "./circle-cleanup85-financial-scope.js";
import { type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import type { Cleanup85NativeRpc } from "./circle-cleanup85-native-rpc.js";
import type { CircleRpc } from "./circle-v2-evm/rpc.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";
export interface VerifiedCleanup85NativeReservation {
    readonly kind: "verified-cleanup85-native-reservation";
}
export interface VerifiedCleanup85NativeSettlement {
    readonly kind: "verified-cleanup85-native-settlement";
}
export interface Cleanup85NativeReservationBody {
    readonly operation: OperationRecord;
    readonly policy: ActiveAssetPolicy;
    readonly reservationId: string;
    readonly idempotencyKey: string;
    readonly reservedAtomic: "2000000000000";
    readonly signedMaximumDebitAtomic: string;
}
export interface Cleanup85NativeActualSettlement {
    readonly kind: "circle_cleanup85_native_actual";
    readonly operationId: string;
    readonly fingerprint: string;
    readonly requestBinding: string;
    readonly transactionHash: string;
    readonly receiptHash: string;
    readonly blockHash: string;
    readonly blockNumberAtomic: string;
    readonly actualFeeAtomic: string;
    readonly nativeConsumedAtomic: string;
    readonly reservedAtomic: "2000000000000";
    readonly nativeReservationId: string;
    readonly policyDigest: string;
    readonly outcomeDigest: string;
}
export declare function verifiedCleanup85NativeReservation(token: VerifiedCleanup85NativeReservation, exactRoot: string): Cleanup85NativeReservationBody;
export declare function verifiedCleanup85NativeSettlement(token: VerifiedCleanup85NativeSettlement, exactRoot: string): {
    operation: OperationRecord;
    settlement: Cleanup85NativeActualSettlement;
};
/** Under canonical wallet/address/operation outer locks and TRUE allowlist profile inner lock.
 * Fresh full public A admission and the saved unsigned native operation precede reservation. */
export declare function verifyCleanup85NativeReservation(state: StateStore, id: string, source: CircleRpc, destination: CircleRpc, native: Cleanup85NativeRpc, now: () => Date, scope: HeldCleanup85Scope): Promise<VerifiedCleanup85NativeReservation>;
/** Only a freshly independently verified FINALIZED receipt for this root's durable operation mints settlement.
 * Moving finalized anchors never enter the stable accounting digest. */
export declare function verifyCleanup85NativeSettlement(state: StateStore, id: string, native: Cleanup85NativeRpc): Promise<VerifiedCleanup85NativeSettlement>;
/** C must reread the durable owning operation while holding the bucket lock, before any mutation. */
export declare function sameCleanup85LedgerOperation(expected: OperationRecord, actual: OperationRecord | null): boolean;
export declare function assertCleanup85NativeSlot(state: StateStore, o: OperationRecord): Promise<void>;
