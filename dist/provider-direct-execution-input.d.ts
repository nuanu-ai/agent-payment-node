import type { OperationRecord, ProviderDirectBinding } from "./model.js";
import type { ProviderDirectExecutionInput } from "./provider-ports.js";
import type { RuntimeContext } from "./runtime.js";
export declare function providerDirectExecutionInput(context: RuntimeContext, operation: OperationRecord, binding: ProviderDirectBinding): ProviderDirectExecutionInput;
