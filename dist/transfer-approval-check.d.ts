import type { Economics, Hex, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
export declare function checkTransferApproval(rpc: RpcPort, operation: OperationRecord & {
    readonly economics: Economics;
    readonly transactionData: Hex;
}, failBeforeEffect: (reason: string) => Promise<never>): Promise<void>;
