import type { SwapProtocolRegistry } from "../protocol-registry.js";
import { reviewedWhirlpoolV2Pool } from "./v1-whirlpool-v2-pools.js";
import { ApnError } from "../../errors.js";
import type { SwapMechanismPin } from "../pin.js";
import { JUPITER_V1_POOL, JUPITER_V1_WHIRLPOOL_V2_POOL, JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, JUPITER_V1_MEMO_PROGRAM, JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_4H_POOL, JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V6_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, WRAPPED_SOL_MINT, SOLANA_USDC_MINT } from "./catalog.js";
import type { JupiterV1QuoteResponse, JupiterV1RawBuildResponse } from "./v1-codec.js";
import { JUPITER_V1_WHIRLPOOL_FP_POOL, JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V1_RUNTIME_PROGRAM_PINS, JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_PROTOCOL_REGISTRY, type JupiterV1RegisteredProgramPin } from "./v1-pins.js";
import type { JupiterV1ResolvedMaterial } from "./v1-material.js";
import { JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_PROTOCOL_REGISTRY } from "./v1-pins.js";
export type JupiterV1RouteId = "whirlpool-v1-83-sol-usdc" | "whirlpool-swap-v2-esv-sol-usdc" | "whirlpool-swap-v2-4h-sol-usdc" | "whirlpool-v1-fp-sol-usdc" | "whirlpool-v1-fp-sol-usdc-runtime-099da3" | "whirlpool-v1-83-sol-usdc-runtime-099da3" | "whirlpool-swap-v2-esv-sol-usdc-runtime-099da3" | "whirlpool-swap-v2-4h-sol-usdc-runtime-099da3";
export interface JupiterV1RouteConfig { readonly routeId: JupiterV1RouteId; readonly pool: string; readonly variant: 17 | 47; readonly instructionBytes: 36 | 37; readonly accountCount: 21 | 25; readonly mechanismPin: SwapMechanismPin; readonly protocolRegistry: SwapProtocolRegistry; readonly requiredExtraPrograms: readonly string[]; readonly runtimeProgramPins?: readonly JupiterV1RegisteredProgramPin[] }
export const JUPITER_V1_OLD_ROUTE: JupiterV1RouteConfig = Object.freeze({ routeId: "whirlpool-v1-83-sol-usdc", pool: JUPITER_V1_POOL, variant: 17, instructionBytes: 36, accountCount: 21, mechanismPin: Object.freeze({...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, auxiliaryContractProgramIdentities: Object.freeze([...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN.auxiliaryContractProgramIdentities])}), protocolRegistry: JUPITER_V1_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([]) });
export const JUPITER_V1_WHIRLPOOL_V2_ROUTE: JupiterV1RouteConfig = Object.freeze({ routeId: "whirlpool-swap-v2-esv-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_V2_POOL, variant: 47, instructionBytes: 37, accountCount: 25, mechanismPin: JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([JUPITER_V1_MEMO_PROGRAM]) });
export const JUPITER_V1_WHIRLPOOL_4H_ROUTE: JupiterV1RouteConfig = Object.freeze({ routeId: "whirlpool-swap-v2-4h-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_4H_POOL, variant: 47, instructionBytes: 37, accountCount: 25, mechanismPin: JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([JUPITER_V1_MEMO_PROGRAM]) });
export const JUPITER_V1_WHIRLPOOL_FP_ROUTE: JupiterV1RouteConfig = Object.freeze({ routeId: "whirlpool-v1-fp-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_FP_POOL, variant: 17, instructionBytes: 36, accountCount: 21, mechanismPin: JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([]) });
export const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig = Object.freeze({
 ...JUPITER_V1_WHIRLPOOL_FP_ROUTE, routeId: "whirlpool-v1-fp-sol-usdc-runtime-099da3",
 mechanismPin: JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_MECHANISM_PIN,
 protocolRegistry: JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_PROTOCOL_REGISTRY,
 runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS
});
export const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig = Object.freeze({
 ...JUPITER_V1_OLD_ROUTE, routeId: "whirlpool-v1-83-sol-usdc-runtime-099da3",
 mechanismPin: JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_MECHANISM_PIN,
 protocolRegistry: JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_PROTOCOL_REGISTRY,
 runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS
});
export const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig = Object.freeze({
 ...JUPITER_V1_WHIRLPOOL_V2_ROUTE, routeId: "whirlpool-swap-v2-esv-sol-usdc-runtime-099da3",
 mechanismPin: JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_MECHANISM_PIN,
 protocolRegistry: JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_PROTOCOL_REGISTRY,
 runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS
});
export const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE: JupiterV1RouteConfig = Object.freeze({
 ...JUPITER_V1_WHIRLPOOL_4H_ROUTE, routeId: "whirlpool-swap-v2-4h-sol-usdc-runtime-099da3",
 mechanismPin: JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_MECHANISM_PIN,
 protocolRegistry: JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_PROTOCOL_REGISTRY,
 runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS
});
export const JUPITER_V1_FINITE_ROUTES: readonly JupiterV1RouteConfig[] = Object.freeze([JUPITER_V1_OLD_ROUTE, JUPITER_V1_WHIRLPOOL_V2_ROUTE, JUPITER_V1_WHIRLPOOL_4H_ROUTE, JUPITER_V1_WHIRLPOOL_FP_ROUTE, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE]);
export function jupiterV1RegisteredProgramPins(route: JupiterV1RouteConfig): readonly JupiterV1RegisteredProgramPin[] {
 return route.runtimeProgramPins ?? JUPITER_V1_RUNTIME_PROGRAM_PINS;
}
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter V1 pool, variant or canonical route shape is outside the admitted lane."); }
/** Finite source-reviewed pool lookup, never a pin learned from a provider response. */
export function routeConfigForQuote(quote: JupiterV1QuoteResponse, expectedRouteId?: JupiterV1RouteId): JupiterV1RouteConfig {
    const pool = quote.routePlan[0]?.swapInfo.ammKey;
    const config = JUPITER_V1_FINITE_ROUTES.find(route => route.pool === pool && (expectedRouteId === undefined || route.routeId === expectedRouteId)) ?? blocked();
    return config;
}
/** Saved materials select only a registered generation. Pool identity alone cannot select upgraded code. */
export function routeConfigForMaterial(material: Pick<JupiterV1ResolvedMaterial, "quoteResponse" | "rawBuildResponse" | "programPins">): JupiterV1RouteConfig {
 const jup = material.programPins.filter(pin => pin.programId === JUPITER_V6_PROGRAM);
 if (jup.length !== 1 || jup[0]!.provenance !== "runtime_bytes_only") blocked();
 const config = JUPITER_V1_FINITE_ROUTES.find(route => route.pool === material.quoteResponse.routePlan[0]?.swapInfo.ammKey &&
  jupiterV1RegisteredProgramPins(route).some(pin => pin.programId === JUPITER_V6_PROGRAM &&
   pin.payloadHash === jup[0]!.storedPayloadHash && pin.programDataAddress === jup[0]!.programDataAddress &&
   (pin.programDataHash === undefined || pin.programDataHash === jup[0]!.programDataHash))) ?? blocked();
 return routeConfigForQuoteBuild(material.quoteResponse, material.rawBuildResponse, config.routeId);
}
export interface JupiterV1RouteArguments { readonly variant: 17 | 47; readonly inputAtomic: string; readonly quotedOutputAtomic: string; readonly slippageBps: number; readonly aToB: true; readonly remainingAccountsInfo: null }
/** Complete Borsh route bytes. Option Some and every trailing byte are unsupported. */
export function decodeJupiterV1RouteArguments(build: JupiterV1RawBuildResponse, config: JupiterV1RouteConfig): JupiterV1RouteArguments {
    const ix = build.swapInstruction, d = Buffer.from(ix.data, "base64"), shift = config.variant === 47 ? 1 : 0;
    if (ix.programId !== JUPITER_V6_PROGRAM || ix.accounts.length !== config.accountCount || d.length !== config.instructionBytes || d.subarray(0, 8).toString("hex") !== "e517cb977ae3ad2a" || d.readUInt32LE(8) !== 1 || d[12] !== config.variant || d[13] !== 1 || (shift === 1 && d[14] !== 0) || d[14 + shift] !== 100 || d[15 + shift] !== 0 || d[16 + shift] !== 1 || d[35 + shift] !== 0) blocked();
    return Object.freeze({ variant: config.variant, inputAtomic: d.readBigUInt64LE(17 + shift).toString(), quotedOutputAtomic: d.readBigUInt64LE(25 + shift).toString(), slippageBps: d.readUInt16LE(33 + shift), aToB: true, remainingAccountsInfo: null });
}
export function routeConfigForQuoteBuild(quote: JupiterV1QuoteResponse, build: JupiterV1RawBuildResponse, expectedRouteId?: JupiterV1RouteId): JupiterV1RouteConfig {
    const config = routeConfigForQuote(quote, expectedRouteId), args = decodeJupiterV1RouteArguments(build, config);
    if (args.inputAtomic !== quote.inAmount || args.quotedOutputAtomic !== quote.outAmount || args.slippageBps !== quote.slippageBps) blocked();
    if (config.variant === 47) {
        if (whirlpoolV2NamedRoles(build).pool !== config.pool) blocked();
        const programs: readonly string[] = [TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, JUPITER_V6_PROGRAM];
        if ([...build.computeBudgetInstructions, ...build.setupInstructions, build.swapInstruction, ...(build.cleanupInstruction === null ? [] : [build.cleanupInstruction])].some(ix => !programs.includes(ix.programId))) blocked();
    }
    return config;
}
export interface WhirlpoolV2NamedRoles { readonly payer: string; readonly source: string; readonly destination: string; readonly pool: string; readonly mintA: string; readonly mintB: string; readonly vaultA: string; readonly vaultB: string; readonly ticks: readonly [string, string, string]; readonly oracle: string; readonly nativeCpiAccounts: readonly string[] }
/** Raw aliases have their own privileges; compilation may union only the payer alias. */
export function whirlpoolV2NamedRoles(build: JupiterV1RawBuildResponse): WhirlpoolV2NamedRoles {
    const r = build.swapInstruction.accounts;
    if (r.length !== 25) blocked();
    const p = r[1]!.pubkey, source = r[2]!.pubkey, destination = r[3]!.pubkey, pool = reviewedWhirlpoolV2Pool(r[14]!.pubkey);
    const keys = [TOKEN_PROGRAM,p,source,destination,JUPITER_V6_PROGRAM,SOLANA_USDC_MINT,JUPITER_V6_PROGRAM,"D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf",JUPITER_V6_PROGRAM,JUPITER_V1_WHIRLPOOL_PROGRAM,TOKEN_PROGRAM,TOKEN_PROGRAM,JUPITER_V1_MEMO_PROGRAM,p,pool.pool,WRAPPED_SOL_MINT,SOLANA_USDC_MINT,source,pool.vaultA,destination,pool.vaultB,r[21]!.pubkey,r[22]!.pubkey,r[23]!.pubkey,pool.oracle];
    const writable = new Set([2,3,14,17,18,19,20,21,22,23,24]);
    if (r.some((a,i) => a.pubkey !== keys[i] || a.isSigner !== (i === 1) || a.isWritable !== writable.has(i)) || new Set([source,destination,...r.slice(21,24).map(a=>a.pubkey)]).size !== 5) blocked();
    return Object.freeze({payer:p,source,destination,pool:keys[14]!,mintA:keys[15]!,mintB:keys[16]!,vaultA:keys[18]!,vaultB:keys[20]!,ticks:Object.freeze([keys[21]!,keys[22]!,keys[23]!] as const),oracle:keys[24]!,nativeCpiAccounts:Object.freeze(r.slice(10).map(a=>a.pubkey))});
}
