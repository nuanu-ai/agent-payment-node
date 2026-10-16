import type { X402AuthorizationState } from "./ports.js";
import type { Eip3009StateSettlementEvidence, X402OperationRecord } from "./x402-state-model.js";
/** Settlement read from the nonce state at a safe block; `transaction` is attached only after its receipt matched. */
export declare function stateSettlementEvidence(operation: X402OperationRecord, state: X402AuthorizationState & {
    readonly value: true;
    readonly blockTag: "safe";
}, rpcOrigin: string, transaction?: {
    readonly transactionHash: `0x${string}`;
    readonly blockNumber: string;
    readonly blockHash: `0x${string}`;
}): Eip3009StateSettlementEvidence;
export declare function validateStateSettlementEvidence(value: unknown, operation?: Record<string, unknown>): Eip3009StateSettlementEvidence;
