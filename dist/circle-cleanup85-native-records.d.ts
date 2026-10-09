import { SecureStateStore } from "./secure-state-store.js";
export declare class Cleanup85NativePublicRecords extends SecureStateStore {
    load(id: string, kind: "material" | "proof" | "slot" | "failure" | "canonical"): Promise<unknown>;
    publish(id: string, kind: "material" | "proof" | "slot" | "failure" | "canonical", body: unknown): Promise<void>;
}
import type { StateStore } from "./state.js";
/** Public deny/reconciliation lookup only. It never grants reservation, settlement or dispatch.
 * The one fixed create-only slot permits exact lookup without profile scans or chain requests. */
export declare function loadCleanup85NativeReservationIdentity(state: StateStore): Promise<{
    readonly operationId: string;
    readonly fingerprint: string;
    readonly nativeReservationId: string;
} | null>;
