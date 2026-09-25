import type { Address, Hex } from "../model.js";
import type { BridgeDeploymentIdentity, BridgeDestinationProof, BridgeMaterialization, BridgeProtocolReceipt, BridgeSourceProof, DecodedBridgeCall } from "./model.js";
/** Frozen and observed deployment identities are checked again at the exact destination receipt block. */
export interface NativeStargateDestinationPin {
    readonly pool: Address;
    readonly frozenDeployment: BridgeDeploymentIdentity;
    readonly observedDeployment: BridgeDeploymentIdentity;
    readonly frozenPoolCodeHash: Hex;
    readonly observedPoolCodeHash: Hex;
}
export declare function bridgeSourceProof(materialization: BridgeMaterialization, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): BridgeSourceProof;
export declare function bridgeDestinationProof(source: BridgeSourceProof, materialization: BridgeMaterialization, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt, nativeStargatePin?: NativeStargateDestinationPin): BridgeDestinationProof;
/** Prove the canonical Across fill tuple before requesting any destination execution trace. */
export declare function validateBnbFilledRelay(source: BridgeSourceProof, materialization: BridgeMaterialization, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): void;
/** The destination token selects the Stargate pool emitter; the Across spoke pool is asset independent. */
export declare function destinationEventFilter(source: BridgeSourceProof, destinationToken: Address): {
    address: Address;
    topics: readonly (Hex | null)[];
};
