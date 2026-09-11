import type { BridgeAccountSnapshot, BridgeEnvelope, BridgeMaterialization, DecodedBridgeCall } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeRpcPort } from "./ports.js";
export declare function freezeBridgeEnvelopes(m: BridgeMaterialization, account: BridgeAccountSnapshot, rpc: BridgeRpcPort): Promise<readonly BridgeEnvelope[]>;
export declare function bridgeExpiry(m: BridgeMaterialization, decoded: DecodedBridgeCall, account: BridgeAccountSnapshot, preparedAt: string, now: number): string;
export declare function assertBridgeRemaining(op: BridgeOperationRecord, now: number): void;
export declare function guardBridgeEffect(op: BridgeOperationRecord, role: "approval" | "bridge", source: BridgeRpcPort, destination: BridgeRpcPort, now: () => number): Promise<void>;
