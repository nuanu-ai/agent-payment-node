import type { Address, Hex } from "../model.js";
import type { GaslessOperationRecord, GaslessRole } from "./operation-model.js";
import type { GaslessAuthorization, GaslessChainId, GaslessCursor, GaslessEffectIdentity,
  GaslessEstimate, GaslessFees, GaslessGas, GaslessIntent, GaslessObservation, GaslessOwner, GaslessSnapshot, GaslessUserOperation } from "./model.js";

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
  /** A v4 UserOperation is signed at the `fees` its guard just chose; a bootstrap takes no fees. */
  seal(operation: GaslessOperationRecord, role: GaslessRole, owner: GaslessOwner,
    bootstrap?: GaslessBootstrapMaterial, fees?: GaslessFees): Promise<GaslessSealedMaterial>;
}
/** Observation has no custody, fee estimation, disclosure or submission capability. */
export interface GaslessObservationPort {
  readonly chainId: GaslessChainId;
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  observe(intent: GaslessIntent, identity: GaslessEffectIdentity, cursor: GaslessCursor): Promise<GaslessObservation>;
}
export type GaslessObservationRpcFactory = (chainId: GaslessChainId, environmentName: string) => GaslessObservationPort;
export interface GaslessRpcPort extends GaslessObservationPort {
  readonly bundlerOrigin: string;
  readonly bundlerEndpointHash: string;
  assertChain(): Promise<void>;
  /** Verifies endpoints, protocol and fresh fees; an approved offer is checked without alteration. */
  snapshot(owner: Address, approvedGas?: GaslessGas): Promise<GaslessSnapshot>;
  /**
   * Estimates the offer's exact UserOperation shape at `fees`, signed by a throwaway key under a fee-token balance
   * override whose storage layout the adapter proves against the chain before using it.
   */
  mirrorEstimate(intent: GaslessIntent, fees?: GaslessFees): Promise<GaslessEstimate>;
  /** v4 intents need the `fees` their guard chose before disclosure; earlier intents use their frozen fees. */
  estimate(intent: GaslessIntent, bootstrap: GaslessBootstrapMaterial, fees?: GaslessFees): Promise<GaslessEstimate>;
  send(intent: GaslessIntent, sealed: GaslessUserOperationMaterial): Promise<Hex>;
}
export type GaslessRpcFactory = (chainId: GaslessChainId) => GaslessRpcPort;
export interface GaslessApprovalPort {
  confirm(input: { readonly operationId: string; readonly fingerprint: string;
    readonly exactPhrase: string; readonly summary: Readonly<Record<string, unknown>> }): Promise<boolean>;
}
