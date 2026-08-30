import type { OperationRecord, ReceiptRecord } from "./model.js";
import type { RpcReceipt } from "./ports.js";
export declare function providerDirectReceipt(operation: OperationRecord, rpcReceipt?: RpcReceipt): ReceiptRecord;
export declare function recoverProviderTerminalOperation(operation: OperationRecord, receipt: ReceiptRecord | null): OperationRecord | null;
export declare function assertProviderTerminalReceiptAuthority(operation: OperationRecord, receipt: ReceiptRecord | null): void;
