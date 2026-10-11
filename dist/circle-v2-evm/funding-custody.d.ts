import { type CircleFundingOperationV2 } from "./funding-operation.js";
import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { type CircleEffect, type CircleRole } from "./operation-model.js";
export interface CircleFundingMaterial {
    readonly schemaVersion: "apn.circle-v2-evm-effect.v2";
    readonly operationId: string;
    readonly role: CircleRole;
    readonly fingerprint: string;
    readonly envelopeHash: string;
    readonly rawTransaction: Hex;
    readonly transactionHash: Hex;
    readonly materialHash: string;
}
export declare class CircleFundingEffectStore extends SecureStateStore {
    private readonly wrapping;
    constructor(root: string, wrapping: WrappingSecretPort);
    private path;
    load(op: CircleFundingOperationV2, effect: CircleEffect, guard?: () => void): Promise<CircleFundingMaterial | null>;
    claim(op: CircleFundingOperationV2, effect: CircleEffect, kind: "sign" | "send", guard: () => void): Promise<void>;
    private snapshot;
    private sameSnapshot;
    save(op: CircleFundingOperationV2, effect: CircleEffect, material: CircleFundingMaterial, guard?: () => void): Promise<CircleFundingMaterial>;
}
export declare class LocalCircleFundingCustody {
    private readonly state;
    private readonly wallets;
    private readonly material;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    load(op: CircleFundingOperationV2, effect: CircleEffect): Promise<CircleFundingMaterial | null>;
    claimSend(op: CircleFundingOperationV2, effect: CircleEffect, guard: () => void): Promise<void>;
    seal(input: CircleFundingOperationV2, effectInput: CircleEffect, guard: () => void): Promise<CircleFundingMaterial>;
}
export declare function verifyCircleFundingMaterial(op: CircleFundingOperationV2, effect: CircleEffect, input: unknown): Promise<CircleFundingMaterial>;
