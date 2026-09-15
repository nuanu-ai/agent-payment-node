import type { CommandRequest } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { OperationService } from "./operation-service.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { ProviderDirectState } from "./provider-direct-state.js";
import type { RuntimeContext } from "./runtime.js";
export declare function prepareCoinbaseGasless(context: RuntimeContext, operations: OperationService, durable: ProviderDirectState, loadProfile: (profileHash: string) => Promise<ProviderProfileRecord>, request: Extract<CommandRequest, {
    command: "gasless.transfer.prepare";
}>): Promise<unknown>;
export declare function coinbaseGaslessPreconditionsMatch(context: RuntimeContext, operation: OperationRecord): Promise<boolean>;
export declare function reobserveCoinbaseGasless(context: RuntimeContext, durable: ProviderDirectState, operation: OperationRecord): Promise<OperationRecord>;
