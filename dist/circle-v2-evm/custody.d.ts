import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { type CircleEffect, type CircleOperationV1, type CircleRole } from "./operation-model.js";
export interface CircleMaterial {
    readonly schemaVersion: "apn.circle-v2-evm-effect.v1";
    readonly operationId: string;
    readonly role: CircleRole;
    readonly fingerprint: string;
    readonly envelopeHash: string;
    readonly rawTransaction: Hex;
    readonly transactionHash: Hex;
    readonly materialHash: string;
}
export declare class CircleEffectStore extends SecureStateStore {
    private readonly wrapping;
    constructor(root: string, wrapping: WrappingSecretPort);
    private path;
    load(op: CircleOperationV1, effect: CircleEffect): Promise<CircleMaterial | null>;
    save(op: CircleOperationV1, effect: CircleEffect, material: CircleMaterial): Promise<CircleMaterial>;
}
export declare class LocalCircleCustody {
    private readonly state;
    private readonly wallets;
    private readonly material;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    load(op: CircleOperationV1, effect: CircleEffect): Promise<CircleMaterial | null>;
    seal(op: CircleOperationV1, effect: CircleEffect): Promise<CircleMaterial>;
}
export declare function verifyCircleMaterial(op: CircleOperationV1, effect: CircleEffect, input: unknown): Promise<CircleMaterial>;
