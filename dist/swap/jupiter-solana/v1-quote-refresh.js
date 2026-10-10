import { canonicalJson, exactKeys } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { rpcAtomic, rpcRecord } from "../../solana/rpc.js";
import { decodeJupiterV1Build, freezeJson, jupiterV1Instructions, jupiterV1Lifetime, jupiterV1ResponseHash } from "./v1-codec.js";
import { assertJupiterV1FreshMaterial, checkedJupiterV1QuoteRpcLifetime, jupiterV1MaterialDigest, validateJupiterV1Material } from "./v1-material.js";
import { assembleJupiterV1 } from "./v1-resolver.js";
/** Quote construction only, before any saved quote, consent, lease or signature.
 * A second official build must preserve every instruction, account, privilege,
 * lookup table and economic field. Only lifetime and timing metadata may change.
 * Execution still rereads all program bytes and uses the final frozen message.
 */
export async function refreshJupiterV1QuoteBuild(rpc, material, response, useRpcLifetime = false) {
    const prior = validateJupiterV1Material(material), build = decodeJupiterV1Build(response);
    if (canonicalJson(withoutTiming(prior.rawBuildResponse)) !== canonicalJson(withoutTiming(build)) ||
        BigInt(jupiterV1Lifetime(build).lastValidBlockHeight) < BigInt(prior.lifetime.lastValidBlockHeight)) {
        throw new ApnError("APN_REPREPARE_REQUIRED", "Jupiter changed the quote build beyond its unsigned lifetime metadata.");
    }
    let quoteRpcLifetime;
    if (useRpcLifetime) {
        const minimumContextSlot = prior.semanticAccounts.reduce((largest, row) => BigInt(row.slot) > largest ? BigInt(row.slot) : largest, BigInt(prior.accountSlot));
        if (minimumContextSlot > BigInt(Number.MAX_SAFE_INTEGER))
            throw new ApnError("APN_REPREPARE_REQUIRED", "Jupiter quote RPC context cannot be represented safely.");
        const result = rpcRecord(await rpc.call("getLatestBlockhash", [{ commitment: "confirmed", minContextSlot: Number(minimumContextSlot) }]));
        const value = rpcRecord(result.value), context = rpcRecord(result.context);
        if (!exactKeys(result, ["context", "value"]) || !exactKeys(value, ["blockhash", "lastValidBlockHeight"]) ||
            !exactKeys(context, ["slot", ...(Object.hasOwn(context, "apiVersion") ? ["apiVersion"] : [])]) ||
            context.apiVersion !== undefined && (typeof context.apiVersion !== "string" || context.apiVersion.length > 64))
            throw new ApnError("APN_RPC_PROTOCOL", "Jupiter's pre-freeze RPC blockhash response shape is invalid.");
        quoteRpcLifetime = checkedJupiterV1QuoteRpcLifetime({ source: "configured_mainnet_rpc_before_quote_freeze", rpcOriginHash: rpc.originHash,
            contextSlot: rpcAtomic(context.slot).toString(), minimumContextSlot: minimumContextSlot.toString(),
            blockhash: value.blockhash, lastValidBlockHeight: rpcAtomic(value.lastValidBlockHeight).toString() });
    }
    const compiled = assembleJupiterV1(prior.payer, build, prior.addressTables, quoteRpcLifetime);
    const fee = rpcRecord(await rpc.call("getFeeForMessage", [compiled.messageBase64, { commitment: "confirmed" }]));
    const height = rpcAtomic(await rpc.call("getBlockHeight", [{ commitment: "confirmed" }])).toString();
    if (quoteRpcLifetime !== undefined && (BigInt(quoteRpcLifetime.lastValidBlockHeight) - BigInt(height) < 100n || BigInt(quoteRpcLifetime.lastValidBlockHeight) - BigInt(height) > 151n))
        throw new ApnError("APN_REPREPARE_REQUIRED", "Jupiter's pre-freeze RPC blockhash has an insufficient or excessive lifetime.");
    const { materialDigest: _digest, ...original } = prior;
    const body = { ...original, rawBuildResponse: build, rawBuildResponseHash: jupiterV1ResponseHash(build),
        lifetime: quoteRpcLifetime === undefined ? jupiterV1Lifetime(build) : { blockhash: quoteRpcLifetime.blockhash, lastValidBlockHeight: quoteRpcLifetime.lastValidBlockHeight },
        ...(quoteRpcLifetime === undefined ? {} : { quoteRpcLifetime }), ...compiled, rawInstructions: jupiterV1Instructions(build),
        networkFeeLamports: fee.value === null ? null : rpcAtomic(fee.value).toString(), currentBlockHeight: height };
    const result = freezeJson({ ...body, materialDigest: jupiterV1MaterialDigest(body) });
    assertJupiterV1FreshMaterial(result);
    return result;
}
function withoutTiming(build) {
    const result = { ...build };
    for (const key of ["blockhashWithMetadata", "timeTaken", "createAtaTimeTaken", "simulationSlot"])
        delete result[key];
    return result;
}
//# sourceMappingURL=v1-quote-refresh.js.map