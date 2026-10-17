import { type FinalizedReader } from "../../evm-finalized-proof.js";
import type { LegacyBridgeOperationRecord } from "../../lifi/legacy-operation.js";
import { LEGACY_BRIDGE_CLOSURE_REASON, type LegacyBridgeClosure } from "./closure.js";
export interface LegacyBridgeClosureView {
    readonly terminal: boolean;
    readonly terminal_reason: typeof LEGACY_BRIDGE_CLOSURE_REASON | null;
    readonly closure: LegacyBridgeClosure | null;
    readonly waiting_for: string | null;
    readonly read_only: true;
}
/** A frozen (pre-allowlist) journal whose state is not one of the family's outcomes: only its closure can end it. */
export declare function legacyBridgeOpen(record: LegacyBridgeOperationRecord): boolean;
/**
 * R4 exit of a frozen bridge journal that the live code never resumes (no signing, no money, no consent): the family
 * status reads, at the finalized tag of its source chain, the owner's nonce and the journal's own transaction hashes.
 * Nonce past every envelope nonce and nothing pending writes the closure once beside the journal; otherwise it stays
 * open and says what it waits for. A journal already in an outcome state answers its stored view as before.
 */
export declare function legacyBridgeStatus(root: string, record: LegacyBridgeOperationRecord, read: FinalizedReader | undefined, now: () => number): Promise<unknown>;
