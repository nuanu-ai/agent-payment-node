import type { ClockPort, X402RpcPort } from "./ports.js";
import { type X402ReconciliationOutcome, type X402ReconciliationStore } from "./x402-rpc-reconciler.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
export declare function reconcileX402Method(rpc: X402RpcPort, clock: ClockPort, store: X402ReconciliationStore, operation: X402OperationRecord): Promise<X402ReconciliationOutcome>;
