import type { TronRpcPort } from "../../tron/rpc.js";
import { SUNSWAP_V2_ROUTER, SUNSWAP_V2_WTRX_USDT_PAIR, type SunSwapPinnedContract } from "./catalog.js";
import { type SunSwapBlockReference } from "./tron-call.js";
export declare const SUNSWAP_MARKET_SCHEMA: "apn.sunswap-tron-v2-market.v1";
export interface SunSwapV2Market {
    readonly schemaVersion: typeof SUNSWAP_MARKET_SCHEMA;
    readonly rpcOriginHash: string;
    readonly referenceBlock: SunSwapBlockReference;
    readonly headBlockNumber: string;
    readonly maxHeadDrift: number;
    readonly router: typeof SUNSWAP_V2_ROUTER;
    readonly pair: typeof SUNSWAP_V2_WTRX_USDT_PAIR;
    readonly path: readonly string[];
    readonly codeHashes: Readonly<Record<SunSwapPinnedContract, string>>;
    readonly amountInAtomic: string;
    readonly amountOutAtomic: string;
    readonly reserveInAtomic: string;
    readonly reserveOutAtomic: string;
    readonly reserveTimestampSeconds: string;
    readonly amountsOutResultHex: string;
    readonly reservesResultHex: string;
    readonly routeHash: string;
}
export interface SunSwapV2Pricing {
    readonly expectedOutputAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly slippageBps: number;
    readonly ownerSlippageCapBps: number;
    readonly spotOutputAtomic: string;
    readonly spotPriceUsdtPerTrx: string;
    readonly executionPriceUsdtPerTrx: string;
    readonly priceImpactBps: string;
    readonly lpFeeBps: "30";
}
export interface SunSwapV2MarketRequest {
    readonly caller: string;
    readonly amountInAtomic: string;
}
/** Reads price, output and reserves directly from the pinned router and pair; no quote API and no API key. */
export declare function readSunSwapV2Market(rpc: TronRpcPort, request: SunSwapV2MarketRequest): Promise<SunSwapV2Market>;
/** Seals decoded market evidence with its route hash after full re-validation. */
export declare function sealSunSwapV2Market(body: Omit<SunSwapV2Market, "routeHash">): SunSwapV2Market;
/** Re-derives every market binding; used for fresh reads and for persisted prepared material. */
export declare function validateSunSwapV2Market(value: unknown, mode: "input" | "stored"): SunSwapV2Market;
/** Exact integer pricing: minimum output from the slippage bound and price impact against the reserve spot price. */
export declare function priceSunSwapV2Market(marketValue: SunSwapV2Market, slippageBps: number, ownerSlippageCapBps: number, mode?: "input" | "stored"): SunSwapV2Pricing;
/** keccak256(runtimecode) and the node's code_hash must both equal the frozen pin. */
export declare function verifySunSwapPinnedCode(rpc: TronRpcPort, address: string, expected: string): Promise<string>;
