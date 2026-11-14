import { type GaslessTransport } from "../gasless/https.js";
import { type SmartAccountGaslessProviderBinding, type SmartAccountGaslessProviderSettlement, type SmartAccountGaslessSealedMaterial, type SmartAccountGaslessVerifyAnswer } from "./model.js";
import type { SmartAccountGaslessOperationRecord } from "./operation-model.js";
import type { SmartAccountGaslessProviderPort } from "./ports.js";
/** Exactly one transport call per method; the lifecycle owns every dispatch marker. */
export declare class MetaMaskSmartAccountGaslessProvider implements SmartAccountGaslessProviderPort {
    private readonly transport;
    private readonly now;
    constructor(transport?: GaslessTransport, now?: () => Date);
    supported(): Promise<SmartAccountGaslessProviderBinding>;
    /** A refused answer is returned, not thrown, so the journal keeps what the facilitator said without asking again. */
    verify(operation: SmartAccountGaslessOperationRecord, material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessVerifyAnswer>;
    settle(operation: SmartAccountGaslessOperationRecord, material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessProviderSettlement>;
    private post;
}
