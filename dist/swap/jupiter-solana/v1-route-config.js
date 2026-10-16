import { reviewedWhirlpoolV2Pool } from "./v1-whirlpool-v2-pools.js";
import { ApnError } from "../../errors.js";
import { JUPITER_V1_POOL, JUPITER_V1_WHIRLPOOL_V2_POOL, JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, JUPITER_V1_MEMO_PROGRAM, JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_4H_POOL, JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V6_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, WRAPPED_SOL_MINT, SOLANA_USDC_MINT } from "./catalog.js";
import { JUPITER_V1_WHIRLPOOL_FP_POOL, JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V1_RUNTIME_PROGRAM_PINS, JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V1_83_MECHANISM_PIN, JUPITER_V1_83_PROTOCOL_REGISTRY, JUPITER_V1_FP_MECHANISM_PIN, JUPITER_V1_FP_PROTOCOL_REGISTRY, JUPITER_V1_ESV_MECHANISM_PIN, JUPITER_V1_ESV_PROTOCOL_REGISTRY, JUPITER_V1_4H_MECHANISM_PIN, JUPITER_V1_4H_PROTOCOL_REGISTRY, JUPITER_V1_PROGRAM_AUTHORITIES, JUPITER_V1_IMMUTABLE_PROGRAMS } from "./v1-pins.js";
import { UPGRADEABLE_LOADER } from "../solana-program-authority.js";
import { JUPITER_V1_RUNTIME_099DA3_WHIRLPOOL_C422B2_PROGRAM_PINS, JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_PROTOCOL_REGISTRY } from "./v1-pins.js";
export const JUPITER_V1_OLD_ROUTE = Object.freeze({ routeId: "whirlpool-v1-83-sol-usdc", pool: JUPITER_V1_POOL, variant: 17, instructionBytes: 36, accountCount: 21, mechanismPin: Object.freeze({ ...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, auxiliaryContractProgramIdentities: Object.freeze([...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN.auxiliaryContractProgramIdentities]) }), protocolRegistry: JUPITER_V1_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([]) });
export const JUPITER_V1_WHIRLPOOL_V2_ROUTE = Object.freeze({ routeId: "whirlpool-swap-v2-esv-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_V2_POOL, variant: 47, instructionBytes: 37, accountCount: 25, mechanismPin: JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([JUPITER_V1_MEMO_PROGRAM]) });
export const JUPITER_V1_WHIRLPOOL_4H_ROUTE = Object.freeze({ routeId: "whirlpool-swap-v2-4h-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_4H_POOL, variant: 47, instructionBytes: 37, accountCount: 25, mechanismPin: JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([JUPITER_V1_MEMO_PROGRAM]) });
export const JUPITER_V1_WHIRLPOOL_FP_ROUTE = Object.freeze({ routeId: "whirlpool-v1-fp-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_FP_POOL, variant: 17, instructionBytes: 36, accountCount: 21, mechanismPin: JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([]) });
export const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE = Object.freeze({
    ...JUPITER_V1_WHIRLPOOL_FP_ROUTE, routeId: "whirlpool-v1-fp-sol-usdc-runtime-099da3",
    mechanismPin: JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_MECHANISM_PIN,
    protocolRegistry: JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_PROTOCOL_REGISTRY,
    runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS
});
export const JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE = Object.freeze({
    ...JUPITER_V1_OLD_ROUTE, routeId: "whirlpool-v1-83-sol-usdc-runtime-099da3",
    mechanismPin: JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_MECHANISM_PIN,
    protocolRegistry: JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_PROTOCOL_REGISTRY,
    runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS
});
export const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE = Object.freeze({
    ...JUPITER_V1_WHIRLPOOL_V2_ROUTE, routeId: "whirlpool-swap-v2-esv-sol-usdc-runtime-099da3",
    mechanismPin: JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_MECHANISM_PIN,
    protocolRegistry: JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_PROTOCOL_REGISTRY,
    runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS
});
export const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE = Object.freeze({
    ...JUPITER_V1_WHIRLPOOL_4H_ROUTE, routeId: "whirlpool-swap-v2-4h-sol-usdc-runtime-099da3",
    mechanismPin: JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_MECHANISM_PIN,
    protocolRegistry: JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_PROTOCOL_REGISTRY,
    runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_PROGRAM_PINS
});
/** Whirlpool c422b2 generations on the same four pools; every preceding route keeps its order, digest and dispatch. */
function c422b2(route, routeId, mechanismPin, protocolRegistry) {
    return Object.freeze({ ...route, routeId, mechanismPin, protocolRegistry, runtimeProgramPins: JUPITER_V1_RUNTIME_099DA3_WHIRLPOOL_C422B2_PROGRAM_PINS });
}
export const JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_ROUTE = c422b2(JUPITER_V1_OLD_ROUTE, "whirlpool-v1-83-sol-usdc-runtime-c422b2", JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_PROTOCOL_REGISTRY);
export const JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE = c422b2(JUPITER_V1_WHIRLPOOL_FP_ROUTE, "whirlpool-v1-fp-sol-usdc-runtime-c422b2", JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_PROTOCOL_REGISTRY);
export const JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_ROUTE = c422b2(JUPITER_V1_WHIRLPOOL_V2_ROUTE, "whirlpool-swap-v2-esv-sol-usdc-runtime-c422b2", JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_PROTOCOL_REGISTRY);
export const JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_ROUTE = c422b2(JUPITER_V1_WHIRLPOOL_4H_ROUTE, "whirlpool-swap-v2-4h-sol-usdc-runtime-c422b2", JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_PROTOCOL_REGISTRY);
/** Byte-pinned generations of APN 0.5.42 and earlier, in their original order: parsers for saved materials and operations only. */
export const JUPITER_V1_HISTORICAL_ROUTES = Object.freeze([JUPITER_V1_OLD_ROUTE, JUPITER_V1_WHIRLPOOL_V2_ROUTE, JUPITER_V1_WHIRLPOOL_4H_ROUTE, JUPITER_V1_WHIRLPOOL_FP_ROUTE, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_099DA3_ROUTE, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_099DA3_ROUTE,
    JUPITER_V1_WHIRLPOOL_RUNTIME_C422B2_ROUTE, JUPITER_V1_WHIRLPOOL_FP_RUNTIME_C422B2_ROUTE, JUPITER_V1_WHIRLPOOL_V2_RUNTIME_C422B2_ROUTE, JUPITER_V1_WHIRLPOOL_4H_RUNTIME_C422B2_ROUTE]);
/** The current route set: one route per pool, valid across routine program upgrades by the pinned authorities. */
function current(route, routeId, mechanismPin, protocolRegistry) {
    const { runtimeProgramPins: _historical, ...shape } = route;
    return Object.freeze({ ...shape, routeId, mechanismPin, protocolRegistry, programAuthorities: JUPITER_V1_PROGRAM_AUTHORITIES });
}
export const JUPITER_V1_ROUTES = Object.freeze([
    current(JUPITER_V1_OLD_ROUTE, "whirlpool-v1-83-sol-usdc-authority", JUPITER_V1_83_MECHANISM_PIN, JUPITER_V1_83_PROTOCOL_REGISTRY),
    current(JUPITER_V1_WHIRLPOOL_FP_ROUTE, "whirlpool-v1-fp-sol-usdc-authority", JUPITER_V1_FP_MECHANISM_PIN, JUPITER_V1_FP_PROTOCOL_REGISTRY),
    current(JUPITER_V1_WHIRLPOOL_V2_ROUTE, "whirlpool-swap-v2-esv-sol-usdc-authority", JUPITER_V1_ESV_MECHANISM_PIN, JUPITER_V1_ESV_PROTOCOL_REGISTRY),
    current(JUPITER_V1_WHIRLPOOL_4H_ROUTE, "whirlpool-swap-v2-4h-sol-usdc-authority", JUPITER_V1_4H_MECHANISM_PIN, JUPITER_V1_4H_PROTOCOL_REGISTRY)
]);
/** Every route an operation can name: the current set first, then the historical generations it may have been prepared under. */
export const JUPITER_V1_KNOWN_ROUTES = Object.freeze([...JUPITER_V1_ROUTES, ...JUPITER_V1_HISTORICAL_ROUTES]);
/** Every program a current route may invoke: its upgradeable authorities and the immutable programs of its shape. */
export function jupiterV1RouteProgramAuthorities(route) {
    if (route.programAuthorities === undefined)
        blocked();
    return [...route.programAuthorities, ...JUPITER_V1_IMMUTABLE_PROGRAMS.filter(pin => pin.programId !== JUPITER_V1_MEMO_PROGRAM || route.requiredExtraPrograms.includes(pin.programId))];
}
export function jupiterV1RegisteredProgramPins(route) {
    return route.runtimeProgramPins ?? JUPITER_V1_RUNTIME_PROGRAM_PINS;
}
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter V1 pool, variant or canonical route shape is outside the admitted lane."); }
/** Finite source-reviewed pool lookup, never a pin learned from a provider response. A new quote uses the current set. */
export function routeConfigForQuote(quote, expectedRouteId) {
    const pool = quote.routePlan[0]?.swapInfo.ammKey;
    const config = (expectedRouteId === undefined ? JUPITER_V1_ROUTES : JUPITER_V1_KNOWN_ROUTES).find(route => route.pool === pool && (expectedRouteId === undefined || route.routeId === expectedRouteId)) ?? blocked();
    return config;
}
/**
 * A saved material names its route by its own program evidence. Authority evidence (current) selects the pool's current
 * route and must be internally consistent; the fresh read that produced it was checked against the pinned authorities,
 * so a later release that reviews another authority still reads it. Byte evidence (APN 0.5.42 and earlier) selects only a
 * registered historical generation.
 */
export function routeConfigForMaterial(material) {
    if (material.programPins.some(pin => pin.provenance === "upgrade_authority")) {
        const config = JUPITER_V1_ROUTES.find(route => route.pool === material.quoteResponse.routePlan[0]?.swapInfo.ammKey) ?? blocked();
        if (material.programPins.some(pin => pin.provenance !== "upgrade_authority") || config.programAuthorities.some(pin => {
            const rows = material.programPins.filter(row => row.programId === pin.programId);
            return rows.length !== 1 || rows[0].loader !== UPGRADEABLE_LOADER || rows[0].programDataAddress !== pin.programDataAddress;
        }))
            blocked();
        return routeConfigForQuoteBuild(material.quoteResponse, material.rawBuildResponse, config.routeId);
    }
    const jup = material.programPins.filter(pin => pin.programId === JUPITER_V6_PROGRAM);
    if (jup.length !== 1 || jup[0].provenance !== "runtime_bytes_only")
        blocked();
    const candidates = JUPITER_V1_HISTORICAL_ROUTES.filter(route => route.pool === material.quoteResponse.routePlan[0]?.swapInfo.ammKey &&
        jupiterV1RegisteredProgramPins(route).some(pin => pin.programId === JUPITER_V6_PROGRAM && materialHasPin(material, pin)));
    // Several generations can share one JUP6 snapshot. Then every registered executable pin, Whirlpool included, selects one.
    const exact = candidates.length === 1 ? candidates : candidates.filter(route => jupiterV1RegisteredProgramPins(route).every(pin => materialHasPin(material, pin)));
    const config = exact.length === 1 ? exact[0] : blocked();
    return routeConfigForQuoteBuild(material.quoteResponse, material.rawBuildResponse, config.routeId);
}
function materialHasPin(material, pin) {
    const rows = material.programPins.filter(row => row.programId === pin.programId);
    return rows.length === 1 && rows[0].provenance === "runtime_bytes_only" && rows[0].storedPayloadHash === pin.payloadHash &&
        rows[0].programDataAddress === pin.programDataAddress && (pin.programDataHash === undefined || pin.programDataHash === rows[0].programDataHash);
}
/** Complete Borsh route bytes. Option Some and every trailing byte are unsupported. */
export function decodeJupiterV1RouteArguments(build, config) {
    const ix = build.swapInstruction, d = Buffer.from(ix.data, "base64"), shift = config.variant === 47 ? 1 : 0;
    if (ix.programId !== JUPITER_V6_PROGRAM || ix.accounts.length !== config.accountCount || d.length !== config.instructionBytes || d.subarray(0, 8).toString("hex") !== "e517cb977ae3ad2a" || d.readUInt32LE(8) !== 1 || d[12] !== config.variant || d[13] !== 1 || (shift === 1 && d[14] !== 0) || d[14 + shift] !== 100 || d[15 + shift] !== 0 || d[16 + shift] !== 1 || d[35 + shift] !== 0)
        blocked();
    return Object.freeze({ variant: config.variant, inputAtomic: d.readBigUInt64LE(17 + shift).toString(), quotedOutputAtomic: d.readBigUInt64LE(25 + shift).toString(), slippageBps: d.readUInt16LE(33 + shift), aToB: true, remainingAccountsInfo: null });
}
export function routeConfigForQuoteBuild(quote, build, expectedRouteId) {
    const config = routeConfigForQuote(quote, expectedRouteId), args = decodeJupiterV1RouteArguments(build, config);
    if (args.inputAtomic !== quote.inAmount || args.quotedOutputAtomic !== quote.outAmount || args.slippageBps !== quote.slippageBps)
        blocked();
    if (config.variant === 47) {
        if (whirlpoolV2NamedRoles(build).pool !== config.pool)
            blocked();
        const programs = [TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, JUPITER_V6_PROGRAM];
        if ([...build.computeBudgetInstructions, ...build.setupInstructions, build.swapInstruction, ...(build.cleanupInstruction === null ? [] : [build.cleanupInstruction])].some(ix => !programs.includes(ix.programId)))
            blocked();
    }
    return config;
}
/** Raw aliases have their own privileges; compilation may union only the payer alias. */
export function whirlpoolV2NamedRoles(build) {
    const r = build.swapInstruction.accounts;
    if (r.length !== 25)
        blocked();
    const p = r[1].pubkey, source = r[2].pubkey, destination = r[3].pubkey, pool = reviewedWhirlpoolV2Pool(r[14].pubkey);
    const keys = [TOKEN_PROGRAM, p, source, destination, JUPITER_V6_PROGRAM, SOLANA_USDC_MINT, JUPITER_V6_PROGRAM, "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf", JUPITER_V6_PROGRAM, JUPITER_V1_WHIRLPOOL_PROGRAM, TOKEN_PROGRAM, TOKEN_PROGRAM, JUPITER_V1_MEMO_PROGRAM, p, pool.pool, WRAPPED_SOL_MINT, SOLANA_USDC_MINT, source, pool.vaultA, destination, pool.vaultB, r[21].pubkey, r[22].pubkey, r[23].pubkey, pool.oracle];
    const writable = new Set([2, 3, 14, 17, 18, 19, 20, 21, 22, 23, 24]);
    if (r.some((a, i) => a.pubkey !== keys[i] || a.isSigner !== (i === 1) || a.isWritable !== writable.has(i)) || new Set([source, destination, ...r.slice(21, 24).map(a => a.pubkey)]).size !== 5)
        blocked();
    return Object.freeze({ payer: p, source, destination, pool: keys[14], mintA: keys[15], mintB: keys[16], vaultA: keys[18], vaultB: keys[20], ticks: Object.freeze([keys[21], keys[22], keys[23]]), oracle: keys[24], nativeCpiAccounts: Object.freeze(r.slice(10).map(a => a.pubkey)) });
}
//# sourceMappingURL=v1-route-config.js.map