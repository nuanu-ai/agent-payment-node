import type { Address, Hex } from "../model.js";
import type { GaslessOperationRecord, GaslessRole } from "./operation-model.js";
import type { GaslessAuthorization, GaslessChainId, GaslessCursor, GaslessEffectIdentity, GaslessEstimate, GaslessIntent, GaslessObservation, GaslessOwner, GaslessSnapshot, GaslessUserOperation } from "./model.js";
interface GaslessMaterialBinding {
    readonly schemaVersion: "apn.gasless-effect.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly envelopeHash: string;
    readonly materialHash: string;
}
export interface GaslessBootstrapMaterial extends GaslessMaterialBinding {
    readonly role: "bootstrap";
    readonly permitSignature: Hex;
    readonly authorization: GaslessAuthorization | null;
}
export interface GaslessUserOperationMaterial extends GaslessMaterialBinding {
    readonly role: "user_operation";
    readonly bootstrapMaterialHash: string;
    readonly estimateHash: string;
    readonly userOperation: GaslessUserOperation;
    readonly userOperationHash: Hex;
}
export type GaslessSealedMaterial = GaslessBootstrapMaterial | GaslessUserOperationMaterial;
export interface GaslessCustodyPort {
    load(operation: GaslessOperationRecord, role: GaslessRole): Promise<GaslessSealedMaterial | null>;
    seal(operation: GaslessOperationRecord, role: GaslessRole, owner: GaslessOwner, bootstrap?: GaslessBootstrapMaterial): Promise<GaslessSealedMaterial>;
}
export interface GaslessRpcPort {
    readonly chainId: GaslessChainId;
    readonly rpcOrigin: string;
    readonly rpcEndpointHash: string;
    readonly bundlerOrigin: string;
    readonly bundlerEndpointHash: string;
    assertChain(): Promise<void>;
    snapshot(owner: Address): Promise<GaslessSnapshot>;
    estimate(intent: GaslessIntent, bootstrap: GaslessBootstrapMaterial): Promise<GaslessEstimate>;
    send(intent: GaslessIntent, sealed: GaslessUserOperationMaterial): Promise<Hex>;
    observe(intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation>;
}
export type GaslessRpcFactory = (chainId: GaslessChainId) => GaslessRpcPort;
export interface GaslessApprovalPort {
    confirm(input: {
        readonly operationId: string;
        readonly fingerprint: string;
        readonly exactPhrase: string;
        readonly summary: Readonly<Record<string, unknown>>;
    }): Promise<boolean>;
}
export {};
