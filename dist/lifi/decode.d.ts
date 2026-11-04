import type { Address } from "../model.js";
import type { BridgeMaterialization, DecodedBridgeCall } from "./model.js";
export declare function decodeBridgeCall(materialization: BridgeMaterialization): DecodedBridgeCall;
/** The FeeForwarder a materialization's one fee step calls, after `decodeBridgeCall` accepted it. */
export declare function bridgeFeeForwarder(materialization: BridgeMaterialization): Address;
