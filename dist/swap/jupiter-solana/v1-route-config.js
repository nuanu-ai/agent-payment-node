import { reviewedWhirlpoolV2Pool } from "./v1-whirlpool-v2-pools.js";
import { ApnError } from "../../errors.js";
import { JUPITER_V1_POOL, JUPITER_V1_WHIRLPOOL_V2_POOL, JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, JUPITER_V1_MEMO_PROGRAM, JUPITER_V1_WHIRLPOOL_PROGRAM, JUPITER_V1_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_4H_POOL, JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY } from "./v1-pins.js";
import { JUPITER_V6_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, WRAPPED_SOL_MINT, SOLANA_USDC_MINT } from "./catalog.js";
import { JUPITER_V1_WHIRLPOOL_FP_POOL, JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY } from "./v1-pins.js";
export const JUPITER_V1_OLD_ROUTE = Object.freeze({ routeId: "whirlpool-v1-83-sol-usdc", pool: JUPITER_V1_POOL, variant: 17, instructionBytes: 36, accountCount: 21, mechanismPin: Object.freeze({ ...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN, auxiliaryContractProgramIdentities: Object.freeze([...JUPITER_V1_WHIRLPOOL_MECHANISM_PIN.auxiliaryContractProgramIdentities]) }), protocolRegistry: JUPITER_V1_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([]) });
export const JUPITER_V1_WHIRLPOOL_V2_ROUTE = Object.freeze({ routeId: "whirlpool-swap-v2-esv-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_V2_POOL, variant: 47, instructionBytes: 37, accountCount: 25, mechanismPin: JUPITER_V1_WHIRLPOOL_V2_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_V2_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([JUPITER_V1_MEMO_PROGRAM]) });
export const JUPITER_V1_WHIRLPOOL_4H_ROUTE = Object.freeze({ routeId: "whirlpool-swap-v2-4h-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_4H_POOL, variant: 47, instructionBytes: 37, accountCount: 25, mechanismPin: JUPITER_V1_WHIRLPOOL_4H_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_4H_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([JUPITER_V1_MEMO_PROGRAM]) });
export const JUPITER_V1_WHIRLPOOL_FP_ROUTE = Object.freeze({ routeId: "whirlpool-v1-fp-sol-usdc", pool: JUPITER_V1_WHIRLPOOL_FP_POOL, variant: 17, instructionBytes: 36, accountCount: 21, mechanismPin: JUPITER_V1_WHIRLPOOL_FP_MECHANISM_PIN, protocolRegistry: JUPITER_V1_WHIRLPOOL_FP_PROTOCOL_REGISTRY, requiredExtraPrograms: Object.freeze([]) });
export const JUPITER_V1_FINITE_ROUTES = Object.freeze([JUPITER_V1_OLD_ROUTE, JUPITER_V1_WHIRLPOOL_V2_ROUTE, JUPITER_V1_WHIRLPOOL_4H_ROUTE, JUPITER_V1_WHIRLPOOL_FP_ROUTE]);
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter V1 pool, variant or canonical route shape is outside the admitted lane."); }
/** Finite source-reviewed pool lookup, never a pin learned from a provider response. */
export function routeConfigForQuote(quote, expectedRouteId) {
    const pool = quote.routePlan[0]?.swapInfo.ammKey;
    const config = JUPITER_V1_FINITE_ROUTES.find(route => route.pool === pool) ?? blocked();
    if (expectedRouteId !== undefined && config.routeId !== expectedRouteId)
        blocked();
    return config;
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
        whirlpoolV2NamedRoles(build);
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