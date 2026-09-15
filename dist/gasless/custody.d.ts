import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import type { Hex } from "../model.js";
import type { GaslessAuthorization, GaslessFees, GaslessIntent, GaslessOwner } from "./model.js";
import type { GaslessOperationRecord, GaslessRole } from "./operation-model.js";
import type { GaslessBootstrapMaterial, GaslessCustodyPort, GaslessSealedMaterial } from "./ports.js";
export declare class LocalGaslessCustody implements GaslessCustodyPort {
    private readonly state;
    private readonly now;
    private readonly wallets;
    private readonly effects;
    constructor(state: StateStore, wrapping: WrappingSecretPort, now?: () => number);
    load(operation: GaslessOperationRecord, role: GaslessRole): Promise<GaslessSealedMaterial | null>;
    seal(operation: GaslessOperationRecord, role: GaslessRole, owner: GaslessOwner, bootstrap?: GaslessBootstrapMaterial, fees?: GaslessFees): Promise<GaslessSealedMaterial>;
    private sealBootstrap;
    private sealUserOperation;
}
/** Throwaway-key material for a pre-disclosure mirror estimate. The owner's wallet and key are never loaded. */
export declare function gaslessMirrorBootstrap(intent: GaslessIntent): Promise<{
    readonly intent: GaslessIntent;
    readonly permitSignature: Hex;
    readonly authorization: GaslessAuthorization;
}>;
