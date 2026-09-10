import { type GaslessTransport } from "../gasless/https.js";
import type { SmartAccountGaslessProviderBinding, SmartAccountGaslessProviderSettlement, SmartAccountGaslessSealedMaterial, SmartAccountGaslessVerification } from "./model.js";
import type { SmartAccountGaslessOperationRecord } from "./operation-model.js";
import type { SmartAccountGaslessProviderPort } from "./ports.js";
/** Exactly one transport call per method; the lifecycle owns every dispatch marker. */
export declare class MetaMaskSmartAccountGaslessProvider implements SmartAccountGaslessProviderPort {
    private readonly transport;
    private readonly now;
    constructor(transport?: GaslessTransport, now?: () => Date);
    supported(): Promise<SmartAccountGaslessProviderBinding>;
    verify(operation: SmartAccountGaslessOperationRecord, material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessVerification>;
    settle(operation: SmartAccountGaslessOperationRecord, material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessProviderSettlement>;
    private post;
}
