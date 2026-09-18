import type { CommandRequest } from "./commands.js";
import type { DirectEvmChainId } from "./evm-direct-networks.js";
import type { OperationRecord } from "./model.js";
import type { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";
/** The shared networks keep their existing profile rule; a direct-only network is local-wallet only. */
export declare function assertDirectEvmProfile(context: RuntimeContext, profile: string, chainId: DirectEvmChainId | undefined): Promise<void>;
export declare function prepareEvmTransfer(context: RuntimeContext, operations: OperationService, request: Extract<CommandRequest, {
    command: "transfer.prepare";
}>, persist: (operation: OperationRecord) => Promise<void>): Promise<unknown>;
