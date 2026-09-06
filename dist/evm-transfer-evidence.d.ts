import type { EvmRpcCall, EvmTransferEvidence } from "./evm-ports.js";
import type { OperationRecord } from "./model.js";
import type { RpcReceipt } from "./ports.js";
export declare function observeEvmTransfer(call: EvmRpcCall, operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence>;
