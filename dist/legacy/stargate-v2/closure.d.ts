import type { OwnTransactionSeen } from "../../evm-finalized-proof.js";
import { SecureStateStore } from "../../secure-state-store.js";
import { type LegacyStargateFamily, type LegacyStargateRecord } from "./reader.js";
export declare const LEGACY_CLOSURE_SCHEMA = "apn.stargate-v2-legacy-closure.v1";
/** The only closure: at the finalized block the signer's nonce is past every envelope of the record and none of its own transactions is pending. */
export declare const LEGACY_CLOSURE_REASON = "legacy_closed_nonce_consumed";
export interface LegacyStargateClosure {
    readonly schemaVersion: typeof LEGACY_CLOSURE_SCHEMA;
    readonly family: LegacyStargateFamily;
    readonly operationId: string;
    readonly recordSchemaVersion: string;
    readonly recordIntegrityHash: string;
    readonly recordPhase: string;
    readonly reason: typeof LEGACY_CLOSURE_REASON;
    readonly chainId: number;
    readonly account: string;
    readonly blockTag: "finalized";
    readonly highestEnvelopeNonceAtomic: string;
    readonly finalizedNonceAtomic: string;
    readonly ownTransactions: readonly {
        readonly transactionHash: string;
        readonly seen: OwnTransactionSeen;
    }[];
    readonly closedAt: string;
    readonly integrityHash: string;
}
/** What the record itself says the closure check must prove: its signing chain and account, every nonce it froze, and its own hashes. */
export interface LegacyClosureFacts {
    readonly family: LegacyStargateFamily;
    readonly chainId: number;
    readonly account: string;
    readonly highestNonce: bigint;
    readonly ownHashes: readonly string[];
}
export declare function legacyClosureFacts(record: LegacyStargateRecord): LegacyClosureFacts;
/** The phases the 60b247d5^ runtimes never left: an observed or reverted native send, an observed or cleaned token operation. */
export declare function legacyPhaseTerminal(record: LegacyStargateRecord): boolean;
/** Terminal by its own phase, or by a valid closure sidecar bound to this exact record. A damaged sidecar throws (undecidable). */
export declare function legacyStargateTerminal(root: string, record: LegacyStargateRecord): Promise<boolean>;
export declare function sealLegacyClosure(fields: Omit<LegacyStargateClosure, "integrityHash">): LegacyStargateClosure;
/**
 * `<family directory>/<operationId>.legacy-closure.json` beside the record (never a record name, so the operation index
 * walk skips it). Create-only: the record is never rewritten, and the operation index, a rebuildable cache, re-derives
 * the record as terminal from this file after `rm -r operation-index`.
 */
export declare class LegacyStargateClosureStore extends SecureStateStore {
    private path;
    load(record: LegacyStargateRecord): Promise<LegacyStargateClosure | null>;
    /** Publishes the closure once; a concurrent closer's file wins and is returned after the same validation. */
    create(record: LegacyStargateRecord, closure: LegacyStargateClosure): Promise<LegacyStargateClosure>;
}
