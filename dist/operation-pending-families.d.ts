import type { OperationRegistry } from "./operation-index/registry.js";
import type { RuntimeContext } from "./runtime.js";
/** `operation status|resume` and `receipt get` for an ID the index does not hold. */
export declare function pendingFamilyAnswer(root: string, registry: OperationRegistry, operationId: string): Promise<never>;
/** `operation abandon` for an ID the index does not hold: the family's existing owner exit, or its own commands. */
export declare function pendingFamilyAbandon(context: RuntimeContext, registry: OperationRegistry, operationId: string): Promise<unknown>;
