import type { SwapProtocolRegistry } from "../protocol-registry.js";
import type { SwapMechanismPin } from "../pin.js";
import type { JupiterV1QuoteResponse, JupiterV1RawBuildResponse } from "./v1-codec.js";
export type JupiterV1RouteId = "whirlpool-v1-83-sol-usdc" | "whirlpool-swap-v2-esv-sol-usdc" | "whirlpool-swap-v2-4h-sol-usdc";
export interface JupiterV1RouteConfig {
    readonly routeId: JupiterV1RouteId;
    readonly pool: string;
    readonly variant: 17 | 47;
    readonly instructionBytes: 36 | 37;
    readonly accountCount: 21 | 25;
    readonly mechanismPin: SwapMechanismPin;
    readonly protocolRegistry: SwapProtocolRegistry;
    readonly requiredExtraPrograms: readonly string[];
}
export declare const JUPITER_V1_OLD_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_V2_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_4H_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_FINITE_ROUTES: readonly JupiterV1RouteConfig[];
/** Finite source-reviewed pool lookup, never a pin learned from a provider response. */
export declare function routeConfigForQuote(quote: JupiterV1QuoteResponse, expectedRouteId?: JupiterV1RouteId): JupiterV1RouteConfig;
export interface JupiterV1RouteArguments {
    readonly variant: 17 | 47;
    readonly inputAtomic: string;
    readonly quotedOutputAtomic: string;
    readonly slippageBps: number;
    readonly aToB: true;
    readonly remainingAccountsInfo: null;
}
/** Complete Borsh route bytes. Option Some and every trailing byte are unsupported. */
export declare function decodeJupiterV1RouteArguments(build: JupiterV1RawBuildResponse, config: JupiterV1RouteConfig): JupiterV1RouteArguments;
export declare function routeConfigForQuoteBuild(quote: JupiterV1QuoteResponse, build: JupiterV1RawBuildResponse, expectedRouteId?: JupiterV1RouteId): JupiterV1RouteConfig;
export interface WhirlpoolV2NamedRoles {
    readonly payer: string;
    readonly source: string;
    readonly destination: string;
    readonly pool: string;
    readonly mintA: string;
    readonly mintB: string;
    readonly vaultA: string;
    readonly vaultB: string;
    readonly ticks: readonly [string, string, string];
    readonly oracle: string;
    readonly nativeCpiAccounts: readonly string[];
}
/** Raw aliases have their own privileges; compilation may union only the payer alias. */
export declare function whirlpoolV2NamedRoles(build: JupiterV1RawBuildResponse): WhirlpoolV2NamedRoles;
