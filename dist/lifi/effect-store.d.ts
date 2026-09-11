import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeSealedMaterial } from "./ports.js";
export declare class BridgeEffectStore extends SecureStateStore {
    private readonly wrappingSecret;
    constructor(root: string, wrappingSecret: WrappingSecretPort);
    load(op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<BridgeSealedMaterial | null>;
    seal(op: BridgeOperationRecord, material: BridgeSealedMaterial): Promise<BridgeSealedMaterial>;
    private path;
}
export declare function validateMaterial(value: unknown, op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<BridgeSealedMaterial>;
