import { SecureStateStore } from "./secure-state-store.js";
export declare class Cleanup85NativePublicRecords extends SecureStateStore {
    /** Existing-only audit peek: bound filenames BEFORE operation decoding; never initializes. */
    cleanup85BuyerOperations(state: StateStore): Promise<readonly OperationRecord[]>;
    hasAnyCleanup85BuyerOperation(state: StateStore): Promise<boolean>;
    /** DENY-only metadata projection. No private capability, current admission or nested ledger lock. */
    successorProtectionLineage(state: StateStore, request: Cleanup85CancellationRequest, original: OperationRecord): Promise<Readonly<{
        originalOperationId: string;
        operationId: string;
        namespace: string;
        retirementProofHash: string;
        readmission: import("./circle-v2-evm/cleanup85-recovery-store.js").Cleanup85RecoveryIntent;
    }>>;
    load(id: string, kind: "material" | "proof" | "slot" | "failure" | "canonical" | "successor-slot"): Promise<unknown>;
    publish(id: string, kind: "material" | "proof" | "slot" | "failure" | "canonical" | "successor-slot", body: unknown): Promise<void>;
}
import type { StateStore } from "./state.js";
import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import type { OperationRecord } from "./model.js";
/** Public deny/reconciliation lookup only. It never grants reservation, settlement or dispatch.
 * Fixed slots provide the normal lookup; a missing original index triggers only a
 * capped existing-only Buyer roster for denial. No chain requests or ledger locks. */
export declare function loadCleanup85NativeReservationIdentity(state: StateStore): Promise<{
    readonly operationId: string;
    readonly fingerprint: string;
    readonly nativeReservationId: string;
} | null>;
