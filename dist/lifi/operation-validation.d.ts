import { type BridgeOperationRecord } from "./operation-model.js";
import type { BridgeEnvelope, BridgeTransactionProof } from "./model.js";
export declare function bridgeCorrupt(): never;
export declare function validateBridgeOperation(value: unknown): BridgeOperationRecord;
export declare function validateEnvelope(e: BridgeEnvelope): void;
export declare function validateEnvelopeProof(p: BridgeTransactionProof, e: BridgeEnvelope, hash: string): void;
export declare function validateBridgeContinuity(previous: BridgeOperationRecord, next: BridgeOperationRecord): void;
