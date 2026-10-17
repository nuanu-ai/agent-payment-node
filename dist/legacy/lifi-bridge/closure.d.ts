import type { NonceClosureFacts, OwnTransactionSeen } from "../../evm-finalized-proof.js";
import type { LegacyBridgeOperationRecord } from "../../lifi/legacy-operation.js";
import { SecureStateStore } from "../../secure-state-store.js";
export declare const LEGACY_BRIDGE_CLOSURE_SCHEMA = "apn.bridge-legacy-closure.v1";
/** The only closure: at the finalized block the signer's nonce is past every envelope of the journal and none of its own transactions is pending. */
export declare const LEGACY_BRIDGE_CLOSURE_REASON = "legacy_closed_nonce_consumed";
export interface LegacyBridgeClosure {
    readonly schemaVersion: typeof LEGACY_BRIDGE_CLOSURE_SCHEMA;
    readonly operationId: string;
    readonly profileHash: string;
    readonly recordIntegrityHash: string;
    readonly recordState: string;
    readonly reason: typeof LEGACY_BRIDGE_CLOSURE_REASON;
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
/**
 * What the frozen journal itself says the closure must prove: its source chain and owner, the highest nonce any of its
 * envelopes froze (every signature and send of the pre-allowlist writer used exactly that envelope nonce), and the
 * transaction hashes it recorded.
 */
export declare function legacyBridgeClosureFacts(record: LegacyBridgeOperationRecord): NonceClosureFacts;
/** Terminal by its own state (the outcome list its validator ties `terminal` to), or by a closure bound to this exact journal. */
export declare function legacyBridgeTerminal(root: string, record: LegacyBridgeOperationRecord): Promise<boolean>;
export declare function sealLegacyBridgeClosure(fields: Omit<LegacyBridgeClosure, "integrityHash">): LegacyBridgeClosure;
/**
 * `bridge-operations/<profileHash>/<operationId>.legacy-closure.json` beside the journal (never a record name, so the
 * operation index walk skips it). Create-only: the journal is never rewritten, and the operation index, a rebuildable
 * cache, re-derives the journal as terminal from this file after `rm -r operation-index`.
 */
export declare class LegacyBridgeClosureStore extends SecureStateStore {
    private path;
    load(record: LegacyBridgeOperationRecord): Promise<LegacyBridgeClosure | null>;
    /** Publishes the closure once; a concurrent closer's file wins and is returned after the same validation. */
    create(record: LegacyBridgeOperationRecord, closure: LegacyBridgeClosure): Promise<LegacyBridgeClosure>;
}
