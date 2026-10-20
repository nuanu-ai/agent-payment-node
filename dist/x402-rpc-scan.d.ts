import type { X402RpcLog } from "./ports.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
export declare function matchingAuthorizationUsed(log: X402RpcLog, operation: X402OperationRecord): boolean;
export declare function matchingTransfer(log: X402RpcLog, operation: X402OperationRecord): boolean;
/** The x402 exact Permit2 proxy's own settlement event (with or without the sponsored permit). */
export declare function matchingPermit2Settled(log: X402RpcLog): boolean;
