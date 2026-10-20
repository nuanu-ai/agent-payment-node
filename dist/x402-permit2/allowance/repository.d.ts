import { SecureStateStore } from "../../secure-state-store.js";
import { type Permit2AllowanceRecord } from "./model.js";
/** `permit2-allowance/<operationId>.json`: the family's only source of truth; the operation index is derived from it. */
export declare class Permit2AllowanceRepository extends SecureStateStore {
    private initialized;
    ready(): Promise<void>;
    /** Lock-free widen-only read; null when absent, a refusal when invalid. */
    find(operationId: string): Promise<Permit2AllowanceRecord | null>;
    required(operationId: string): Promise<Permit2AllowanceRecord>;
    /** The caller holds `operation:<id>`. A new record is created once; a later one must extend the stored journal. */
    persistLocked(next: Permit2AllowanceRecord): Promise<Permit2AllowanceRecord>;
    private path;
}
