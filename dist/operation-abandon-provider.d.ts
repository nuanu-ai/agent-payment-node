import type { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";
/**
 * Owner release (R4) of a provider paid request whose settlement stayed unprovable after its evidence window:
 * evidence that is not unique, mismatched or unavailable. It never pays, sends or calls the provider again.
 */
export declare function abandonProviderX402(context: RuntimeContext, operations: OperationService, operationId: string): Promise<unknown>;
/**
 * Owner release (R4) of an exposed Smart Account gasless transfer that stayed unproven after its child delegation
 * expired on chain (for example several candidate redemptions). The expired child can no longer be redeemed.
 */
export declare function abandonSmartAccountGasless(context: RuntimeContext, operations: OperationService, operationId: string): Promise<unknown>;
