import { type EvmAssetSelection } from "../evm-asset.js";
import type { DirectEvmChainId } from "../evm-direct-networks.js";
import type { Address } from "../model.js";
export type StargateV2Asset = "ETH" | "USDC" | "USDT";
export interface StargateV2Deployment {
    readonly chainId: DirectEvmChainId;
    readonly eid: number;
    readonly asset: StargateV2Asset;
    readonly token: Address;
    readonly pool: Address;
    readonly kind: "pool" | "oft";
    readonly localDecimals: 6 | 18;
    readonly sharedDecimals: 6;
}
/**
 * Exact intersections of the active eleven-network allowlist and the official Stargate registry at the recorded commits.
 * No provider discovery, token alias, wrapped asset, or unlisted Stargate deployment may widen this table.
 */
export declare const STARGATE_V2_DEPLOYMENTS: readonly [StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment, StargateV2Deployment];
export declare function stargateV2Deployment(chainId: unknown, token: unknown): StargateV2Deployment;
export declare function stargateV2Route(source: EvmAssetSelection, destination: EvmAssetSelection): Readonly<{
    from: StargateV2Deployment;
    to: StargateV2Deployment;
}>;
