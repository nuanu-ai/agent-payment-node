import type { Hex, OperationRecord } from "./model.js";
import { SecureStateStore } from "./secure-state-store.js";
/** Permanent dispatch fence. Absence of a receipt never grants another send. */
export declare class EvmDirectSubmissionJournal extends SecureStateStore {
    exists(operation: OperationRecord): Promise<boolean>;
    fence(operation: OperationRecord, raw: Hex): Promise<void>;
    private binding;
    private path;
}
