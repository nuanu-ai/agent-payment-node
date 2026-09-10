import type { GaslessIntent, GaslessPermissionInvalidation } from "./model.js";
import type { GaslessMutable, GaslessOperationRecord } from "./operation-model.js";
export declare const GASLESS_PERMISSIONS_INVALIDATED = "gasless_bootstrap_permissions_invalidated";
export declare function validateGaslessPermissionInvalidation(intent: GaslessIntent, bootstrapMaterialHash: string, value: unknown): GaslessPermissionInvalidation;
export declare function assertGaslessPermissionClosure(op: Pick<GaslessOperationRecord, "intent">, s: GaslessMutable): GaslessPermissionInvalidation;
