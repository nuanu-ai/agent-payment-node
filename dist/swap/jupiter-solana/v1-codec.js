import { routeConfigForQuote } from "./v1-route-config.js";
import { getBase58Decoder } from "@solana/kit";
import { canonicalJson, isPlainRecord, exactKeys, sha256 } from "../../canonical.js";
import { atomic, canonicalAddress, canonicalBase64, invalid, JUPITER_V6_PROGRAM, WRAPPED_SOL_MINT, SOLANA_USDC_MINT } from "./catalog.js";
export function decodeJupiterV1Quote(value) {
    if (!isPlainRecord(value))
        invalid("Jupiter V1 quote shape is invalid.");
    const allowed = ["inputMint", "inAmount", "outputMint", "outAmount", "otherAmountThreshold", "swapMode", "slippageBps", "platformFee", "priceImpactPct", "routePlan", "contextSlot", "timeTaken", "swapUsdValue", "mostReliableAmmsQuoteReport", "longtailMarketQuoteReport", "useIncurredSlippageForQuoting", "useRewards", "otherRoutePlans", "loadedLongtailToken", "instructionVersion", "transactionVersion"];
    if (Object.keys(value).some(k => !allowed.includes(k)) || value.inputMint !== WRAPPED_SOL_MINT || value.outputMint !== SOLANA_USDC_MINT || value.swapMode !== "ExactIn" || value.instructionVersion !== "V1" || value.transactionVersion !== 0 || !Number.isSafeInteger(value.contextSlot) || Number(value.contextSlot) < 1 || !Number.isSafeInteger(value.slippageBps) || Number(value.slippageBps) < 0 || Number(value.slippageBps) >= 10000)
        invalid("Jupiter V1 quote pair or version is invalid.");
    for (const key of ["inAmount", "outAmount", "otherAmountThreshold"])
        if (atomic(value[key]) > (1n << 64n) - 1n)
            invalid("Jupiter V1 amount exceeds u64.");
    if (atomic(value.otherAmountThreshold) > atomic(value.outAmount))
        invalid("Jupiter V1 minimum exceeds output.");
    if (value.platformFee !== null && (!isPlainRecord(value.platformFee) || !exactKeys(value.platformFee, ["amount", "feeBps"]) || value.platformFee.amount !== "0" || value.platformFee.feeBps !== 0))
        invalid("Jupiter V1 platform fee is unsupported.");
    if (!Array.isArray(value.routePlan) || value.routePlan.length !== 1)
        invalid("Jupiter V1 requires one direct route.");
    const route = value.routePlan[0];
    if (!isPlainRecord(route) || Object.keys(route).some(k => !["swapInfo", "percent", "bps"].includes(k)) || route.percent !== 100 || (route.bps !== undefined && route.bps !== null && route.bps !== 10000) || !isPlainRecord(route.swapInfo))
        invalid("Jupiter V1 route is invalid.");
    const swap = route.swapInfo;
    if (Object.keys(swap).some(k => !["ammKey", "label", "inputMint", "outputMint", "inAmount", "outAmount", "feeAmount", "feeMint", "updateContextSlot"].includes(k)) || swap.label !== "Whirlpool" || swap.inputMint !== value.inputMint || swap.outputMint !== value.outputMint || swap.inAmount !== value.inAmount || swap.outAmount !== value.outAmount || typeof swap.ammKey !== "string")
        invalid("Jupiter V1 route binding is invalid.");
    canonicalAddress(swap.ammKey);
    if (typeof value.priceImpactPct !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(value.priceImpactPct))
        invalid("Jupiter V1 price impact is invalid.");
    routeConfigForQuote(value);
    return freezeJson(value);
}
export function decodeJupiterV1Instruction(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["programId", "accounts", "data"]) || typeof value.programId !== "string" || !Array.isArray(value.accounts) || value.accounts.length > 64)
        invalid("Jupiter V1 instruction shape is invalid.");
    canonicalAddress(value.programId);
    canonicalBase64(value.data, 1232);
    value.accounts.forEach(meta => {
        if (!isPlainRecord(meta) || !exactKeys(meta, ["pubkey", "isSigner", "isWritable"]) || typeof meta.pubkey !== "string" || typeof meta.isSigner !== "boolean" || typeof meta.isWritable !== "boolean")
            invalid("Jupiter V1 instruction meta is invalid.");
        canonicalAddress(meta.pubkey);
    });
    return freezeJson(value);
}
export function decodeJupiterV1Build(value) {
    if (!isPlainRecord(value))
        invalid("Jupiter V1 build shape is invalid.");
    const allowed = ["tokenLedgerInstruction", "computeBudgetInstructions", "setupInstructions", "swapInstruction", "cleanupInstruction", "otherInstructions", "addressLookupTableAddresses", "prioritizationFeeLamports", "computeUnitLimit", "loadedAccountsDataSize", "loadedAccountsDataSizeLimit", "transactionVersion", "prioritizationType", "simulationSlot", "dynamicSlippageReport", "simulationError", "addressesByLookupTableAddress", "blockhashWithMetadata", "timeTaken", "createAtaTimeTaken"];
    if (Object.keys(value).some(k => !allowed.includes(k)) || value.tokenLedgerInstruction !== null || !Array.isArray(value.otherInstructions) || value.otherInstructions.length !== 0 || value.transactionVersion !== 0 || value.simulationError !== null || value.dynamicSlippageReport !== null)
        invalid("Jupiter V1 unsupported build features.");
    for (const key of ["computeBudgetInstructions", "setupInstructions"]) {
        if (!Array.isArray(value[key]) || value[key].length > 8)
            invalid("Jupiter V1 instruction list is invalid.");
        value[key].forEach(decodeJupiterV1Instruction);
    }
    const swap = decodeJupiterV1Instruction(value.swapInstruction);
    if (swap.programId !== JUPITER_V6_PROGRAM)
        invalid("Jupiter V1 swap program is invalid.");
    if (value.cleanupInstruction !== null)
        decodeJupiterV1Instruction(value.cleanupInstruction);
    if (!Array.isArray(value.addressLookupTableAddresses) || value.addressLookupTableAddresses.length > 8 || new Set(value.addressLookupTableAddresses).size !== value.addressLookupTableAddresses.length)
        invalid("Jupiter V1 ALT list is invalid.");
    value.addressLookupTableAddresses.forEach(v => {
        if (typeof v !== "string")
            invalid("Jupiter V1 ALT identity is invalid.");
        canonicalAddress(v);
    });
    const life = value.blockhashWithMetadata;
    if (!isPlainRecord(life) || !Array.isArray(life.blockhash) || life.blockhash.length !== 32 || life.blockhash.some(v => !Number.isInteger(v) || v < 0 || v > 255) || !Number.isSafeInteger(life.lastValidBlockHeight) || Number(life.lastValidBlockHeight) < 1)
        invalid("Jupiter V1 lifetime is invalid.");
    return freezeJson(value);
}
export function jupiterV1Lifetime(build) { return { blockhash: getBase58Decoder().decode(new Uint8Array(build.blockhashWithMetadata.blockhash)), lastValidBlockHeight: String(build.blockhashWithMetadata.lastValidBlockHeight) }; }
export function jupiterV1Instructions(build) { return [...build.computeBudgetInstructions, ...build.setupInstructions, build.swapInstruction, ...(build.cleanupInstruction === null ? [] : [build.cleanupInstruction])]; }
export function jupiterV1ResponseHash(value) { return sha256(canonicalJson(value)); }
export function freezeJson(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            freezeJson(child);
        Object.freeze(value);
    }
    return value;
}
//# sourceMappingURL=v1-codec.js.map