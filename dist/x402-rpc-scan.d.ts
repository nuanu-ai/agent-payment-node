import type { X402RpcHead, X402RpcLog } from "./ports.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
export declare function sameRpcOrigin(left: string, right: string): boolean;
export declare function validX402Head(head: X402RpcHead): boolean;
export declare function matchingAuthorizationUsed(log: X402RpcLog, operation: X402OperationRecord): boolean;
export declare function matchingTransfer(log: X402RpcLog, operation: X402OperationRecord): boolean;
