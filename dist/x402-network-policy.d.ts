import type { RuntimeContext } from "./runtime.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
export declare function assertCurrentNetworkPolicy(context: RuntimeContext, operation: X402OperationRecord, callerDeadlineMs?: number): Promise<void>;
