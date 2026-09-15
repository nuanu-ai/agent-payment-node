import type { OperationRecord, ProviderDirectBinding } from "./model.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { RuntimeContext } from "./runtime.js";
export declare function requiredProviderBinding(operation: OperationRecord): ProviderDirectBinding;
export declare function requiredProviderDirectProfile(context: RuntimeContext, profileHash: string): Promise<ProviderProfileRecord>;
