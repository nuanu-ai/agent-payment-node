import type { OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
export declare function checkEvmTransferFunding(rpcPort: RpcPort, operation: OperationRecord, beforeSigning: boolean): Promise<void>;
export declare function evmCustodyPayload(operation: OperationRecord): Readonly<Record<string, unknown>>;
