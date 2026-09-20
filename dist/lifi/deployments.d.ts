import type { BridgeChainId } from "./chains.js";
import type { Address } from "../model.js";
import type { BridgeDeploymentContract, BridgeTool } from "./model.js";
/**
 * The exact code and configuration pins for one direction, tool and asset. Every asset-specific pin comes from the
 * registry row; an asset the registry does not admit, or one whose tool has not been reviewed for it, is refused.
 * A native leg pins the wrapped-native contract whose logs prove the wrap and the unwrap instead of a token contract.
 */
export declare function bridgeDeployment(chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address): BridgeDeploymentContract;
export declare function bridgeProtocolEmitter(chainId: BridgeChainId, tool: BridgeTool, token: Address): Address;
export declare function bridgeEndpointId(chainId: BridgeChainId): number;
