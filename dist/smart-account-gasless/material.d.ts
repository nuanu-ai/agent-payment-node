import type { SmartAccountGaslessMaterialStorePort } from "../encrypted-smart-account-gasless-material-store.js";
import type { SmartAccountPermissionStorePort } from "../encrypted-smart-account-permission-store.js";
import type { Hex } from "../model.js";
import { type Erc7710EnginePort } from "../smart-account-erc7710/engine.js";
import type { Erc7710MaterialIntent } from "../smart-account-erc7710/intent.js";
import { type SmartAccountGaslessBinding, type SmartAccountGaslessMaterialHashes, type SmartAccountGaslessProfileIdentity, type SmartAccountGaslessSealedMaterial } from "./model.js";
import type { SmartAccountGaslessOperationRecord } from "./operation-model.js";
import type { SmartAccountGaslessMaterialPort, SmartAccountGaslessMaterialValidatorPort, SmartAccountGaslessValidationInput } from "./ports.js";
export declare class SmartAccountGaslessMaterialValidator implements SmartAccountGaslessMaterialValidatorPort {
    validate(input: SmartAccountGaslessValidationInput): Promise<SmartAccountGaslessMaterialHashes>;
}
export declare class MetaMaskSmartAccountGaslessMaterial implements SmartAccountGaslessMaterialPort {
    private readonly permissions;
    private readonly materials;
    private readonly engine;
    private readonly validator;
    private readonly now;
    constructor(permissions: SmartAccountPermissionStorePort, materials: SmartAccountGaslessMaterialStorePort, engine?: Erc7710EnginePort, validator?: SmartAccountGaslessMaterialValidatorPort, now?: () => Date);
    inspect(expected: SmartAccountGaslessProfileIdentity, nowUnix: number): Promise<SmartAccountGaslessBinding>;
    load(operation: SmartAccountGaslessOperationRecord): Promise<SmartAccountGaslessSealedMaterial | null>;
    seal(operation: SmartAccountGaslessOperationRecord): Promise<SmartAccountGaslessSealedMaterial>;
    markExposed(operation: SmartAccountGaslessOperationRecord, material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessSealedMaterial>;
    private recover;
    private activeRecord;
}
export declare function directIntent(operationId: string, fingerprint: string, intent: SmartAccountGaslessOperationRecord["intent"], rootContext: Hex): Erc7710MaterialIntent;
