import type { EvmChainId } from "../evm-asset.js";
import type { Address } from "../model.js";
import type { BridgeDeploymentContract, BridgeTool } from "./model.js";
export declare function bridgeDeployment(chainId: EvmChainId, peerChainId: EvmChainId, tool: BridgeTool): BridgeDeploymentContract;
export declare function bridgeProtocolEmitter(chainId: EvmChainId, tool: BridgeTool): Address;
export declare function bridgeEndpointId(chainId: EvmChainId): number;
