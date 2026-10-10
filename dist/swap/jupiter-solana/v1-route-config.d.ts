import type { SwapProtocolRegistry } from "../protocol-registry.js";
import type { SwapMechanismPin } from "../pin.js";
import type { JupiterV1QuoteResponse, JupiterV1RawBuildResponse } from "./v1-codec.js";
import { type JupiterV1RegisteredProgramPin } from "./v1-pins.js";
import type { JupiterV1ResolvedMaterial } from "./v1-material.js";
export type JupiterV1RouteId = "whirlpool-v1-83-sol-usdc" | "whirlpool-swap-v2-esv-sol-usdc" | "whirlpool-swap-v2-4h-sol-usdc" | "whirlpool-v1-fp-sol-usdc" | "whirlpool-v1-fp-sol-usdc-runtime-099da3" | "whirlpool-v1-83-sol-usdc-runtime-099da3" | "whirlpool-swap-v2-esv-sol-usdc-runtime-099da3" | "whirlpool-swap-v2-4h-sol-usdc-runtime-099da3";
export interface JupiterV1RouteConfig {
    readonly routeId: JupiterV1RouteId;
    readonly pool: string;
    readonly variant: 17 | 47;
    readonly instructionBytes: 36 | 37;
    readonly accountCount: 21 | 25;
    readonly mechanismPin: SwapMechanismPin;
    readonly protocolRegistry: SwapProtocolRegistry;
    readonly requiredExtraPrograms: readonly string[];
    readonly runtimeProgramPins?: readonly JupiterV1RegisteredProgramPin[];
}
export declare const JUPITER_V1_OLD_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_V2_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_4H_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_FP_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_FINITE_ROUTES: readonly JupiterV1RouteConfig[];
export declare function jupiterV1RegisteredProgramPins(route: JupiterV1RouteConfig): readonly JupiterV1RegisteredProgramPin[];
/** Finite source-reviewed pool lookup, never a pin learned from a provider response. */
export declare function routeConfigForQuote(quote: JupiterV1QuoteResponse, expectedRouteId?: JupiterV1RouteId): JupiterV1RouteConfig;
/** Saved materials select only a registered generation. Pool identity alone cannot select upgraded code. */
export declare function routeConfigForMaterial(material: Pick<JupiterV1ResolvedMaterial, "quoteResponse" | "rawBuildResponse" | "programPins">): JupiterV1RouteConfig;
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
