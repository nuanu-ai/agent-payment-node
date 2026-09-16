import type { EvmChainId } from "../evm-asset.js";
import type { Address } from "../model.js";
import type { BridgeDeploymentContract, BridgeTool } from "./model.js";
/**
 * The exact code and configuration pins for one direction, tool and asset. Every asset-specific pin comes from the
 * registry row; an asset the registry does not admit, or one whose tool has not been reviewed for it, is refused.
 */
export declare function bridgeDeployment(chainId: EvmChainId, peerChainId: EvmChainId, tool: BridgeTool, token: Address): BridgeDeploymentContract;
export declare function bridgeProtocolEmitter(chainId: EvmChainId, tool: BridgeTool, token: Address): Address;
export declare function bridgeEndpointId(chainId: EvmChainId): number;
