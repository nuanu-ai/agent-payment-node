import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { GaslessOperationRecord, GaslessRole } from "./operation-model.js";
import type { GaslessSealedMaterial } from "./ports.js";
export declare class GaslessEffectStore extends SecureStateStore {
    private readonly wrappingSecret;
    constructor(root: string, wrappingSecret: WrappingSecretPort);
    load(operation: GaslessOperationRecord, role: GaslessRole): Promise<GaslessSealedMaterial | null>;
    seal(operation: GaslessOperationRecord, material: GaslessSealedMaterial): Promise<GaslessSealedMaterial>;
    private decrypt;
    private path;
}
