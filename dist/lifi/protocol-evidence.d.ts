import type { Address, Hex } from "../model.js";
import type { BridgeDestinationProof, BridgeMaterialization, BridgeProtocolReceipt, BridgeSourceProof, DecodedBridgeCall } from "./model.js";
/**
 * The reviewed StargatePoolNative on Base. The pool is immutable code at a fixed address (a Stargate upgrade deploys a new
 * pool), and Base has EIP-6780, so its registry code hash is a fact of the address: OFTReceived from it follows its
 * successful native outflow without re-reading the code at the receipt block (P2).
 */
export interface NativeStargateDestinationPin {
    readonly pool: Address;
    readonly poolCodeHash: Hex;
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
