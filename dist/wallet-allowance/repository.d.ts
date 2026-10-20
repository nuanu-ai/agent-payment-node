import { SecureStateStore } from "../secure-state-store.js";
import { type WalletAllowanceRevokeRecord } from "./model.js";
/** `wallet-allowance-revokes/<operationId>.json`: the family's only source of truth; the operation index is derived from it. */
export declare class WalletAllowanceRevokeRepository extends SecureStateStore {
    private initialized;
    ready(): Promise<void>;
    /** Lock-free widen-only read; null when absent, a refusal when invalid. */
    find(operationId: string): Promise<WalletAllowanceRevokeRecord | null>;
    required(operationId: string): Promise<WalletAllowanceRevokeRecord>;
    /** The open (non-terminal) revoke of one slot, if any; the account claim keeps it to at most one. */
    open(slot: string): Promise<WalletAllowanceRevokeRecord | null>;
    /** The caller holds `operation:<id>`. A new record is created once; a later one must extend the stored journal. */
    persistLocked(next: WalletAllowanceRevokeRecord): Promise<WalletAllowanceRevokeRecord>;
    private path;
}
