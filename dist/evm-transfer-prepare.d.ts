import type { CommandRequest } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";
export declare function prepareEvmTransfer(context: RuntimeContext, operations: OperationService, request: Extract<CommandRequest, {
    command: "transfer.prepare";
}>, persist: (operation: OperationRecord) => Promise<void>): Promise<unknown>;
