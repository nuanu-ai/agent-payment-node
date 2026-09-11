import type { GaslessOperationRecord, GaslessRole } from "./operation-model.js";
import type { GaslessBootstrapMaterial, GaslessSealedMaterial } from "./ports.js";
export declare function validateGaslessMaterial(value: unknown, operation: GaslessOperationRecord, role: GaslessRole, originalBootstrap?: GaslessBootstrapMaterial): Promise<GaslessSealedMaterial>;
