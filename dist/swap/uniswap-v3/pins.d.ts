import { type Hex } from "viem";
import type { EvmRpcCall } from "../../evm-ports.js";
import { type SwapMechanismPin } from "../pin.js";
import { type SwapProtocolRegistry } from "../protocol-registry.js";
/**
 * Keyless Uniswap V3 pins. Every address and runtime code hash below was read with eth_getCode on Ethereum
 * mainnet (block 26001913, 2026-09-18) and cross-checked: pool.token0/token1/fee/factory, factory.getPool,
 * QuoterV2.factory/WETH9, and a same-block Universal Router simulation whose amountOutMin equals the QuoterV2
 * output (quoted + 1 reverts with V3TooLittleReceived). Contract immutables live in runtime code, so each hash
 * also pins them. The hashes are re-verified at quote time; any drift fails closed.
 */
export declare const UNISWAP_WETH9: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export declare const UNISWAP_V3_FACTORY: "0x1F98431c8aD98523631AE4a59f267346ea31F984";
export declare const UNISWAP_V3_QUOTER_V2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
export declare const UNISWAP_V3_USDC_WETH_500: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
export declare const ETHEREUM_USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7";
/** Deepest WETH/USDT V3 pool by in-range liquidity (1.83e19 vs 5.1e17 for 0.05%), block 26002096, 2026-09-18. */
export declare const UNISWAP_V3_WETH_USDT_3000: "0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36";
/** EIP-1967 style ZeppelinOS implementation slot used by the FiatTokenProxy behind USDC. */
export declare const USDC_IMPLEMENTATION_SLOT: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
export interface UniswapV3CodePin {
    readonly role: string;
    readonly address: string;
    readonly codeHash: Hex;
}
export declare const UNISWAP_V3_CODE_PINS: readonly UniswapV3CodePin[];
export declare const USDC_IMPLEMENTATION_PIN: UniswapV3CodePin;
export interface UniswapV3PairPin {
    readonly outputToken: string;
    readonly outputSymbol: string;
    readonly outputDecimals: number;
    readonly pool: string;
    /** Uniswap fee in hundredths of a basis point. */
    readonly fee: number;
    /** Pool orientation: WETH is token1 in USDC/WETH because USDC sorts first. */
    readonly wethIsToken0: boolean;
}
export declare const UNISWAP_V3_PAIRS: readonly UniswapV3PairPin[];
export declare const UNISWAP_V3_KEYLESS_MECHANISM_PIN: SwapMechanismPin;
/** Official identity only. Owners must still admit both assets with this exact pin under a sealed policy. */
export declare const UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY: SwapProtocolRegistry;
export declare function uniswapV3Pair(outputToken: string): UniswapV3PairPin;
/** Verifies the code pins a quote or send depends on at one exact block tag; drift fails closed. */
export type UniswapV3PinVerifier = (call: EvmRpcCall, tag: Hex) => Promise<readonly UniswapV3CodePin[]>;
/** Production verifier: every pinned runtime code hash, the USDC proxy implementation, and USDT not deprecated. */
export declare const verifyUniswapV3CodePins: UniswapV3PinVerifier;
export declare function verifyUsdtNotDeprecated(call: EvmRpcCall, tag: Hex): Promise<void>;
export declare function verifyCodePins(call: EvmRpcCall, tag: Hex, pins: readonly UniswapV3CodePin[], implementation: {
    readonly proxy: string;
    readonly slot: Hex;
    readonly pin: UniswapV3CodePin;
}): Promise<readonly UniswapV3CodePin[]>;
