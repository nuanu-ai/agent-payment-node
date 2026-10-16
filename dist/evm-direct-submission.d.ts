import type { Hex, OperationRecord } from "./model.js";
import { SecureStateStore } from "./secure-state-store.js";
/** Permanent dispatch fence: these exact bytes may have been sent, so recovery observes before any re-send of them and never signs anew. */
export declare class EvmDirectSubmissionJournal extends SecureStateStore {
    exists(operation: OperationRecord): Promise<boolean>;
    fence(operation: OperationRecord, raw: Hex): Promise<void>;
    private binding;
    private path;
}
