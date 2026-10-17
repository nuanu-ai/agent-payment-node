import { type StoredBridgeOperationRecord } from "../../lifi/legacy-operation.js";
import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function bridgeDomains(record: StoredBridgeOperationRecord): readonly MoneyConflictDomain[];
/**
 * Current and legacy (widen-only) bridge journals, through the repository's version-aware reader. A legacy journal is
 * frozen (resume refuses it, nothing signs for it again), so it holds only its account, not its profile: only a
 * transaction it already sent may still land on that account.
 */
export declare const bridgeAdapter: OperationFamilyAdapter<StoredBridgeOperationRecord>;
