import { type FinalizedChainRead, type FinalizedReader } from "../evm-finalized-proof.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";
export declare const CIRCLE_RESIDUAL_SCHEMA = "apn.circle-v2-residual-allowance.v1";
export interface CircleResidualBlock {
    readonly numberAtomic: string;
    readonly hash: string;
}
export interface CircleResidualRecord {
    readonly schemaVersion: typeof CIRCLE_RESIDUAL_SCHEMA;
    readonly operationId: string;
    readonly profileHash: string;
    readonly chainId: 8453;
    readonly token: string;
    readonly owner: string;
    readonly spender: string;
    readonly allowanceAtomic: string;
    readonly block: CircleResidualBlock;
    readonly proof: "finalized_allowance_read" | "revoke_approval";
    readonly revokeOperationId: string | null;
    readonly observedAt: string;
    readonly integrityHash: string;
}
/** What status shows: the stored value and its block, whether this status read it, and why it is absent when it is. */
export interface CircleResidualView {
    readonly token: string;
    readonly owner: string;
    readonly spender: string;
    readonly allowanceAtomic: string | null;
    readonly block: CircleResidualBlock | null;
    readonly proof: CircleResidualRecord["proof"] | null;
    readonly revokeOperationId: string | null;
    readonly observedAt: string | null;
    readonly readByThisStatus: boolean;
    readonly unreadReason?: string;
}
/** `non-evm-source-journals/<profileHash>/<operationId>.residual-allowance.json`: never a record name, so the index skips it. */
export declare class CircleResidualAllowanceStore extends SecureStateStore {
    private path;
    load(journal: NonEvmSourceJournal): Promise<CircleResidualRecord | null>;
    /** Stores a value unless the stored one is at a later block; returns what is stored. */
    keepNewer(record: CircleResidualRecord): Promise<CircleResidualRecord>;
    /**
     * A revoke proven at `block` (Approval with value 0 and a fresh zero allowance) sets every stored residual of the same
     * owner and wrapper in the profile to 0, unless one was stored at a later block. Only existing values are updated.
     */
    revoked(profileHash: string, owner: string, spender: string, block: CircleResidualBlock, revokeOperationId: string, observedAt: string): Promise<void>;
}
/**
 * The residual shown by a status of a resolved burn: the stored value, or (when nothing is stored yet, or on an explicit
 * refresh) one eth_call at the finalized head, stored. `proven` is an endpoint this status already proved to serve Base,
 * and `head` its finalized block when it read one. An unreadable value is reported with its reason, never guessed.
 */
export declare function circleResidualAllowance(root: string, journal: NonEvmSourceJournal, read: FinalizedReader | undefined, refresh: boolean, now: () => number, proven?: FinalizedChainRead, head?: CircleResidualBlock): Promise<CircleResidualView>;
/** The finalized block a status already read: its number and hash. */
export declare function finalizedBlock(value: unknown): CircleResidualBlock;
