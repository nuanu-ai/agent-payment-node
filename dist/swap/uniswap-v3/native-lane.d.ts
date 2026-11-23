import type { Hex } from "viem";
import type { SwapMechanismPin } from "../pin.js";
import { type UniswapV3ExactInputCall } from "./encoder.js";
import { type UniswapV3PairPin } from "./pins.js";
export type UniswapNativeChainId = 1 | 56;
/** What a router decoder must prove the calldata pays: the quote's recipient, exact input, floor, deadline and output token. */
export interface UniswapNativeRouteExpectation {
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly outputToken: string;
}
export interface UniswapNativeRoute {
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly routeHash: string;
}
/**
 * One chain of the keyless native-input Uniswap V3 lane: native coin in, wrapped by the pinned router, one pinned pool,
 * one pinned output token. The quote, prepared material, execution binding, signer, observer and approval screen read
 * every chain-specific identity from here, chosen by the operation's own chain; nothing falls back to another chain.
 */
export interface UniswapNativeLane {
    readonly chain: "eip155:1" | "eip155:56";
    readonly chainId: UniswapNativeChainId;
    /** The chain's name in refusals; the screen names it as screenNetwork. */
    readonly networkName: string;
    readonly screenNetwork: string;
    readonly nativeSymbol: "ETH" | "BNB";
    readonly wrappedSymbol: "WETH" | "WBNB";
    readonly tokenStandard: "ERC20" | "BEP-20";
    readonly router: `0x${string}`;
    readonly routerLabel: string;
    readonly quoter: `0x${string}`;
    readonly wrappedNative: `0x${string}`;
    readonly rpcEnvironment: "APN_ETHEREUM_RPC_URL" | "APN_BNB_RPC_URL";
    readonly statusCommand: string;
    /** Blocks a quote's simulation may trail the head, at quote and at send (Ethereum 64, about 13 minutes). */
    readonly maxHeadDrift: number;
    pair(outputToken: string): UniswapV3PairPin;
    mechanismPin(pair: UniswapV3PairPin): SwapMechanismPin;
    encode(input: UniswapV3ExactInputCall): {
        readonly data: Hex;
        readonly route: UniswapNativeRoute;
    };
    decode(data: Hex, expected: UniswapNativeRouteExpectation): UniswapNativeRoute;
}
export declare const ETHEREUM_UNISWAP_NATIVE_LANE: UniswapNativeLane;
/** The lane of an exact chain identity, or undefined; callers refuse in their own terms. */
export declare function uniswapNativeLaneOf(chain: string): UniswapNativeLane | undefined;
