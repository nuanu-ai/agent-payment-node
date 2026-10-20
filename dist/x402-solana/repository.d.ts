import { SecureStateStore } from "../secure-state-store.js";
import { type X402SolanaRecord } from "./model.js";
/** `x402-solana/<operationId>.json`: the family's only source of truth; the operation index is derived from it. */
export declare class X402SolanaRepository extends SecureStateStore {
    private initialized;
    ready(): Promise<void>;
    /** Lock-free widen-only read; null when absent, a refusal when invalid. */
    find(operationId: string): Promise<X402SolanaRecord | null>;
    required(operationId: string): Promise<X402SolanaRecord>;
    /** The caller holds `operation:<id>`. A new record is created once; a later one must extend the stored journal. */
    persistLocked(next: X402SolanaRecord): Promise<X402SolanaRecord>;
    private path;
}
