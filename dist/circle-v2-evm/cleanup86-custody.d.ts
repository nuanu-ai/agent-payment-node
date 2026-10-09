import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { type Cleanup86Intent } from "./cleanup86-store.js";
import { type Cleanup86Grant } from "./cleanup86-controller.js";
export interface Cleanup86Material {
    readonly version: "apn.circle-cleanup86-material.v1";
    readonly intentHash: string;
    readonly recoveryBinding: string;
    readonly envelopeHash: string;
    readonly rawTransaction: Hex;
    readonly transactionHash: Hex;
    readonly materialHash: string;
}
/** First sign only. There is deliberately no private material restore/unseal API for recovery dispatch. */
export declare class Cleanup86Custody extends SecureStateStore {
    private readonly state;
    private readonly wrapping;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    private path;
    assertAbsent(op: CircleOperationV1): Promise<void>;
    publicMetadata(op: CircleOperationV1, i: Cleanup86Intent): Promise<{
        transactionHash: Hex;
        materialHash: string;
    } | null>;
    seal(op: CircleOperationV1, i: Cleanup86Intent, grant: Cleanup86Grant, beforePrivate: () => Promise<void>): Promise<Cleanup86Material>;
    private encrypt;
}
