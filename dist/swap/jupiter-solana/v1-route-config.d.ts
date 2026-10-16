import type { SwapProtocolRegistry } from "../protocol-registry.js";
import type { SwapMechanismPin } from "../pin.js";
import type { JupiterV1QuoteResponse, JupiterV1RawBuildResponse } from "./v1-codec.js";
import { type JupiterV1RegisteredProgramPin } from "./v1-pins.js";
import type { JupiterV1ResolvedMaterial } from "./v1-material.js";
import { type SolanaProgramAuthority, type SolanaUpgradeableProgramAuthority } from "../solana-program-authority.js";
export type JupiterV1RouteId = "whirlpool-v1-83-sol-usdc" | "whirlpool-swap-v2-esv-sol-usdc" | "whirlpool-swap-v2-4h-sol-usdc" | "whirlpool-v1-fp-sol-usdc" | "whirlpool-v1-fp-sol-usdc-runtime-099da3" | "whirlpool-v1-83-sol-usdc-runtime-099da3" | "whirlpool-swap-v2-esv-sol-usdc-runtime-099da3" | "whirlpool-swap-v2-4h-sol-usdc-runtime-099da3" | "whirlpool-v1-83-sol-usdc-runtime-c422b2" | "whirlpool-v1-fp-sol-usdc-runtime-c422b2" | "whirlpool-swap-v2-esv-sol-usdc-runtime-c422b2" | "whirlpool-swap-v2-4h-sol-usdc-runtime-c422b2" | JupiterV1CurrentRouteId;
export type JupiterV1CurrentRouteId = "whirlpool-v1-83-sol-usdc-authority" | "whirlpool-v1-fp-sol-usdc-authority" | "whirlpool-swap-v2-esv-sol-usdc-authority" | "whirlpool-swap-v2-4h-sol-usdc-authority";
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
    /** Present on the current route set only: what a fresh read is checked against instead of executable bytes. */
    readonly programAuthorities?: readonly SolanaUpgradeableProgramAuthority[];
}
export declare const JUPITER_V1_OLD_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_V2_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_4H_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_FP_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_ROUTE: JupiterV1RouteConfig;
export declare const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_ROUTE: JupiterV1RouteConfig;
/** Byte-pinned generations of APN 0.5.42 and earlier, in their original order: parsers for saved materials and operations only. */
export declare const JUPITER_V1_HISTORICAL_ROUTES: readonly JupiterV1RouteConfig[];
export declare const JUPITER_V1_ROUTES: readonly JupiterV1RouteConfig[];
/** Every route an operation can name: the current set first, then the historical generations it may have been prepared under. */
export declare const JUPITER_V1_KNOWN_ROUTES: readonly JupiterV1RouteConfig[];
/** Every program a current route may invoke: its upgradeable authorities and the immutable programs of its shape. */
export declare function jupiterV1RouteProgramAuthorities(route: JupiterV1RouteConfig): readonly SolanaProgramAuthority[];
export declare function jupiterV1RegisteredProgramPins(route: JupiterV1RouteConfig): readonly JupiterV1RegisteredProgramPin[];
/** Finite source-reviewed pool lookup, never a pin learned from a provider response. A new quote uses the current set. */
export declare function routeConfigForQuote(quote: JupiterV1QuoteResponse, expectedRouteId?: JupiterV1RouteId): JupiterV1RouteConfig;
/**
 * A saved material names its route by its own program evidence. Authority evidence (current) selects the pool's current
 * route and must be internally consistent; the fresh read that produced it was checked against the pinned authorities,
 * so a later release that reviews another authority still reads it. Byte evidence (APN 0.5.42 and earlier) selects only a
 * registered historical generation.
 */
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
