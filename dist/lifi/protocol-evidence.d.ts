import type { Address, Hex } from "../model.js";
import type { BridgeDestinationProof, BridgeMaterialization, BridgeProtocolReceipt, BridgeSourceProof, DecodedBridgeCall } from "./model.js";
export declare function bridgeSourceProof(materialization: BridgeMaterialization, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): BridgeSourceProof;
export declare function bridgeDestinationProof(source: BridgeSourceProof, materialization: BridgeMaterialization, decoded: DecodedBridgeCall, receipt: BridgeProtocolReceipt): BridgeDestinationProof;
/** The destination token selects the Stargate pool emitter; the Across spoke pool is asset independent. */
export declare function destinationEventFilter(source: BridgeSourceProof, destinationToken: Address): {
    address: Address;
    topics: readonly (Hex | null)[];
};
