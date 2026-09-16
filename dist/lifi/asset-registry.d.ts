import type { ErrorCode } from "../errors.js";
import type { EvmChainId } from "../evm-asset.js";
import type { Address, Hex } from "../model.js";
import type { BridgeRouteRequest, BridgeTool } from "./model.js";
/**
 * The single source of admitted bridge chains and assets. Every chain identity, native coin, token address,
 * decimals count and contract pin the rail trusts is a row here; nothing else in `src/lifi/**` may carry its own
 * copy. A row exists only when its on-chain identity can be pinned the way canonical USDC already is.
 */
export declare const BRIDGE_CHAINS: readonly [1, 8453, 42161];
/** Native coins are first class: the provider's zero-address sentinel is never an admitted asset. */
export interface BridgeNativeCoin {
    readonly kind: "native";
    readonly chainId: EvmChainId;
    readonly symbol: string;
    readonly coinKey: string;
    readonly decimals: 18;
}
/** Each upgradeability shape is pinned explicitly; there is no default shape for an unreviewed proxy. */
export type BridgeTokenCode = {
    readonly upgradeability: "immutable";
    readonly codeHash: Hex;
} | {
    readonly upgradeability: "legacy_proxy";
    readonly codeHash: Hex;
    readonly implementation: Address;
    readonly implementationCodeHash: Hex;
    readonly admin: Address;
} | {
    readonly upgradeability: "beacon_proxy";
    readonly codeHash: Hex;
    readonly beacon: Address;
    readonly beaconCodeHash: Hex;
    readonly implementation: Address;
    readonly implementationCodeHash: Hex;
};
export interface BridgeStargatePool {
    readonly assetId: 1;
    readonly router: Address;
    readonly routerCodeHash: Hex;
    readonly sharedDecimals: number;
    readonly addressConfig: readonly [Address, Address, Address, Address, Address, Address];
}
export interface BridgeTokenAsset {
    readonly kind: "erc20";
    readonly chainId: EvmChainId;
    readonly address: Address;
    readonly symbol: string;
    readonly coinKey: string;
    /** Two rows may be bridged to each other only when their pair keys match. */
    readonly pairKey: string;
    readonly decimals: number;
    readonly code: BridgeTokenCode;
    readonly acrossSupported: boolean;
    readonly stargate: BridgeStargatePool | null;
    readonly peers: readonly EvmChainId[];
}
export type BridgeAsset = BridgeNativeCoin | BridgeTokenAsset;
export interface BridgeChainRow {
    readonly chainId: EvmChainId;
    readonly name: string;
    readonly caip2: string;
    readonly rpcEnvironment: string;
    readonly nativeCoin: BridgeNativeCoin;
    readonly tokens: readonly BridgeTokenAsset[];
}
export declare const BRIDGE_ASSET_REGISTRY: Readonly<Record<EvmChainId, BridgeChainRow>>;
export declare function bridgeChain(value: unknown, code?: ErrorCode): EvmChainId;
export declare function bridgeCaip2(value: unknown): EvmChainId;
export declare function bridgeChainRow(value: unknown, code?: ErrorCode): BridgeChainRow;
export declare function bridgeNativeCoin(chainId: unknown, code?: ErrorCode): BridgeNativeCoin;
/** The one admission point for a bridgeable asset. The zero address is the native sentinel and is never a token. */
export declare function bridgeTokenRow(chainId: unknown, address: unknown, code?: ErrorCode): BridgeTokenAsset;
/** Native principal is not admitted: the fee forwarder, allowance and Transfer-log evidence are all ERC-20 shaped. */
export declare function bridgeAssetPair(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">, code?: ErrorCode): {
    readonly from: BridgeTokenAsset;
    readonly to: BridgeTokenAsset;
};
/** The peer chain's row for the same pair key, which is what a cross-chain tool pin and a route pair must agree on. */
export declare function bridgePeerToken(asset: BridgeTokenAsset, peerChainId: EvmChainId, code?: ErrorCode): BridgeTokenAsset;
export declare function bridgeAssetTool(asset: BridgeTokenAsset, tool: BridgeTool, code?: ErrorCode): BridgeStargatePool | null;
/** Parses one decimal amount at the admitted asset's exact precision. */
export declare function bridgeDecimal(value: unknown, decimals: number, positive?: boolean): string;
export declare function validateBridgeRequest(value: unknown, code?: ErrorCode): BridgeRouteRequest;
