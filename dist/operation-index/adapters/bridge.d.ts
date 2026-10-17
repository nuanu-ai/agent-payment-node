import type { StoredBridgeOperationRecord } from "../../lifi/legacy-operation.js";
import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function bridgeDomains(record: StoredBridgeOperationRecord): readonly MoneyConflictDomain[];
/** Current and legacy (widen-only) bridge journals, through the repository's version-aware reader. */
export declare const bridgeAdapter: OperationFamilyAdapter<StoredBridgeOperationRecord>;
