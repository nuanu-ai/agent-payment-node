import type { ErrorCode } from "../errors.js";
import { type BridgeChainId, type BridgeExecutionChainId } from "./chains.js";
import type { Address, Hex } from "../model.js";
import type { BridgeRouteRequest, BridgeTool } from "./model.js";
/**
 * The single source of admitted bridge chains and assets. Every chain identity, native coin, token address,
 * decimals count and contract pin the rail trusts is a row here; nothing else in `src/lifi/**` may carry its own
 * copy. A row exists only when its on-chain identity can be pinned the way canonical USDC already is.
 */
export declare const BRIDGE_CHAINS: readonly [1, 56, 143, 8453, 42161, 59144];
/**
 * Quote-only destinations whose exact allowlist USDC identity and LI.FI calldata shape were captured from the
 * public quote API. They may be discovered and decoded, but are deliberately absent from `BRIDGE_CHAINS`: no RPC,
 * deployment proof, destination observation or send path may treat them as executable bridge chains.
 */
export declare const BRIDGE_QUOTE_DESTINATIONS: {
    readonly 10: {
        readonly name: "OP Mainnet";
        readonly caip2: "eip155:10";
        readonly token: `0x${string}`;
        readonly tools: readonly ["across", "stargateV2"];
        readonly endpointId: 30111;
    };
    readonly 137: {
        readonly name: "Polygon PoS";
        readonly caip2: "eip155:137";
        readonly token: `0x${string}`;
        readonly tools: readonly ["across"];
        readonly endpointId: null;
    };
    readonly 43114: {
        readonly name: "Avalanche C-Chain";
        readonly caip2: "eip155:43114";
        readonly token: `0x${string}`;
        readonly tools: readonly ["stargateV2"];
        readonly endpointId: 30106;
    };
    readonly 130: {
        readonly name: "Unichain";
        readonly caip2: "eip155:130";
        readonly token: `0x${string}`;
        readonly tools: readonly ["across"];
        readonly endpointId: null;
    };
};
export type BridgeQuoteDestinationChainId = keyof typeof BRIDGE_QUOTE_DESTINATIONS;
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
    readonly upgradeability: "eip1967_proxy";
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
/**
 * The wrapped-native contract Across wraps a native deposit into and unwraps a native fill from. Its event shape is
 * pinned per chain: WETH9 emits `Deposit`/`Withdrawal`; Arbitrum's aeWETH mints and burns with `Transfer` logs.
 */
export interface BridgeWrappedNative {
    readonly address: Address;
    readonly code: BridgeTokenCode;
    readonly events: "weth9" | "erc20_mint_burn";
}
/**
 * Native coins are first class. The provider's zero-address wire sentinel names the native coin as a route leg and
 * is never a token. A native principal is carried by Across only: its deposit wraps into the pinned wrapped-native
 * contract and its fill unwraps from it, so both movements are provable by exact logs of that contract.
 */
export interface BridgeNativeCoin {
    readonly kind: "native";
    readonly chainId: BridgeChainId;
    readonly symbol: string;
    readonly coinKey: string;
    readonly decimals: 18;
    readonly pairKey: "eth" | "bnb" | "mon";
    readonly acrossSupported: true;
    readonly stargate: null;
    readonly peers: readonly BridgeChainId[];
    readonly wrapped: BridgeWrappedNative;
    readonly listing: "frozen_list";
}
export interface BridgeTokenAsset {
    readonly kind: "erc20";
    readonly chainId: BridgeChainId;
    readonly address: Address;
    readonly symbol: string;
    readonly coinKey: string;
    /** Two rows may be bridged to each other only when their pair keys match. */
    readonly pairKey: string;
    readonly decimals: number;
    readonly code: BridgeTokenCode;
    readonly acrossSupported: boolean;
    readonly stargate: BridgeStargatePool | null;
    readonly peers: readonly BridgeChainId[];
    /** `zero_first`: a nonzero approve over a nonzero allowance reverts and `approve` returns no value (Tether). */
    readonly approval: "standard" | "zero_first";
    /** `tether_fee_zero`: the owner-settable transfer fee, its cap and the deprecation forward are pinned at zero. */
    readonly transferFee: "none" | "tether_fee_zero";
    /** `frozen_list` rows must equal the frozen allowlist identity; `legacy_pinned` rows predate it and stay as pinned. */
    readonly listing: "frozen_list" | "legacy_pinned";
}
export type BridgeAsset = BridgeNativeCoin | BridgeTokenAsset;
export interface BridgeChainRow {
    readonly chainId: BridgeChainId;
    readonly name: string;
    readonly caip2: string;
    readonly rpcEnvironment: string;
    readonly nativeCoin: BridgeNativeCoin;
    readonly tokens: readonly BridgeTokenAsset[];
}
export declare const BRIDGE_ASSET_REGISTRY: Readonly<Record<BridgeChainId, BridgeChainRow>>;
export declare function bridgeChain(value: unknown, code?: ErrorCode): BridgeChainId;
export declare function bridgeCaip2(value: unknown): BridgeChainId;
/** CLI/request admission for a destination. Quote-only rows are returned with the legacy type at this boundary;
 * every execution boundary still calls `bridgeChain` and therefore refuses them. */
export declare function bridgeDestinationCaip2(value: unknown): BridgeChainId;
export declare function bridgeQuoteDestination(value: unknown, code?: ErrorCode): {
    readonly name: "OP Mainnet";
    readonly caip2: "eip155:10";
    readonly token: `0x${string}`;
    readonly tools: readonly ["across", "stargateV2"];
    readonly endpointId: 30111;
} | {
    readonly name: "Polygon PoS";
    readonly caip2: "eip155:137";
    readonly token: `0x${string}`;
    readonly tools: readonly ["across"];
    readonly endpointId: null;
} | {
    readonly name: "Avalanche C-Chain";
    readonly caip2: "eip155:43114";
    readonly token: `0x${string}`;
    readonly tools: readonly ["stargateV2"];
    readonly endpointId: 30106;
} | {
    readonly name: "Unichain";
    readonly caip2: "eip155:130";
    readonly token: `0x${string}`;
    readonly tools: readonly ["across"];
    readonly endpointId: null;
};
export declare function bridgeDestinationChain(value: unknown, code?: ErrorCode): BridgeChainId;
export declare function bridgeExecutionDestination(value: unknown): value is BridgeExecutionChainId;
export declare function bridgeChainRow(value: unknown, code?: ErrorCode): BridgeChainRow;
export declare function bridgeNativeCoin(chainId: unknown, code?: ErrorCode): BridgeNativeCoin;
/** The one admission point for a bridgeable token. The zero address is the native sentinel and is never a token. */
export declare function bridgeTokenRow(chainId: unknown, address: unknown, code?: ErrorCode): BridgeTokenAsset;
/**
 * The one admission point for a route leg. The zero address names the chain's native coin; any other address must be
 * a registry row. An address the frozen list does not name is refused as unlisted, never matched by symbol.
 */
export declare function bridgeAssetRow(chainId: unknown, address: unknown, code?: ErrorCode): BridgeAsset;
/** The wire identity of a route leg: the token contract, or the provider's zero-address sentinel for the native coin. */
export declare function bridgeAssetAddress(asset: BridgeAsset): Address;
/** The identity a declared fee row carries for this asset: `"native"` for the native coin, else the token contract. */
export declare function bridgeFeeAsset(asset: BridgeAsset): Address | "native";
export declare function bridgeNativePrincipal(request: Pick<BridgeRouteRequest, "fromToken">): boolean;
export declare function bridgeCrossNativeConversion(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">): boolean;
/** The only reviewed native principal lanes whose source and destination coins use different denominations. */
export declare function bridgeNativeDenominationConversion(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">): boolean;
/** Native destinations that require a provider named transaction plus exact trace and balance proof. */
export declare function bridgeProviderBoundNativeDestination(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">): boolean;
/** Both legs must share a pair key, decimals and each other's chain as a peer: native pairs with native, a token with its own. */
export declare function bridgeAssetPair(request: Pick<BridgeRouteRequest, "fromChainId" | "toChainId" | "fromToken" | "toToken">, code?: ErrorCode): {
    readonly from: BridgeAsset;
    readonly to: BridgeAsset;
};
/** The peer chain's row for the same pair key, which is what a cross-chain tool pin and a route pair must agree on. */
export declare function bridgePeerToken(asset: BridgeTokenAsset, peerChainId: BridgeChainId, code?: ErrorCode): BridgeTokenAsset;
export declare function bridgeAssetTool(asset: BridgeAsset, tool: BridgeTool, code?: ErrorCode): BridgeStargatePool | null;
/** Parses one decimal amount at the admitted asset's exact precision. */
export declare function bridgeDecimal(value: unknown, decimals: number, positive?: boolean): string;
export declare function validateBridgeRequest(value: unknown, code?: ErrorCode): BridgeRouteRequest;
