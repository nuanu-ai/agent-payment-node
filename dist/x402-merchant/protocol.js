import { parseJsonWithDuplicateRejection } from "../x402-strict-json.js";
import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { decodeCanonicalBase64Json } from "../x402-codec.js";
import { MERCHANT_AMOUNT, MERCHANT_CHAIN, MERCHANT_PAYEE, MERCHANT_TOKEN, MERCHANT_URL } from "./pins.js";
export function checkMerchantObservation(o) {
    if (o.finalUrl !== MERCHANT_URL || o.observedOrigin !== new URL(MERCHANT_URL).origin ||
        o.safeTransportProvenance?.protocol !== "https" || o.safeTransportProvenance.tlsAuthorized !== true || o.safeTransportProvenance.redirectCount !== 0 ||
        o.bodyBytes.length > 256 * 1024 || !Number.isFinite(Date.parse(o.observedAt)))
        refuse("merchant_http_provenance");
}
export function checkMerchantChallenge(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["x402Version", "resource", "accepts", ...(value.error === undefined ? [] : ["error"]), ...(value.extensions === undefined ? [] : ["extensions"])]) || value.x402Version !== 2 ||
        !isPlainRecord(value.resource) || value.resource.url !== MERCHANT_URL || !Array.isArray(value.accepts) || value.accepts.length < 1 || value.accepts.length > 16)
        refuse("merchant_challenge_shape");
    if (value.error !== undefined && (typeof value.error !== "string" || value.error.length > 256) ||
        value.extensions !== undefined && (!isPlainRecord(value.extensions) || !exactKeys(value.extensions, ["bazaar"]) || !isPlainRecord(value.extensions.bazaar)))
        refuse("merchant_challenge_extensions");
    const matches = value.accepts.filter((r) => {
        if (!isPlainRecord(r) || !exactKeys(r, ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"]))
            return false;
        try {
            return r.scheme === "exact" && r.network === MERCHANT_CHAIN && getAddress(String(r.asset)) === MERCHANT_TOKEN &&
                r.amount === MERCHANT_AMOUNT && getAddress(String(r.payTo)) === MERCHANT_PAYEE && r.maxTimeoutSeconds === 300 &&
                canonicalJson(r.extra) === canonicalJson({ name: "USDm", version: "2" });
        }
        catch {
            return false;
        }
    });
    if (matches.length !== 1)
        refuse("merchant_exact_requirement_missing_or_ambiguous");
    const challenge = structuredClone(value);
    return { challenge, accepted: structuredClone(matches[0]), challengeHash: hashObject(challenge) };
}
export function merchantChallenge(o) {
    checkMerchantObservation(o);
    if (o.status !== 402)
        refuse("merchant_http_402_required");
    const headers = o.rawHeaderPairs.filter(([k]) => k.toLowerCase() === "payment-required");
    if (headers.length !== 1)
        refuse("merchant_payment_required_header");
    return checkMerchantChallenge(decodeCanonicalBase64Json(headers[0][1]));
}
export function merchantProof(frozen, txHash) {
    const checked = checkMerchantChallenge(frozen.challenge);
    if (canonicalJson(checked) !== canonicalJson(frozen) || !/^0x[0-9a-f]{64}$/u.test(txHash) || /^0x0+$/u.test(txHash))
        refuse("merchant_proof_binding");
    return Buffer.from(canonicalJson({ x402Version: 2, payload: { txHash }, resource: frozen.challenge.resource, accepted: frozen.accepted }), "utf8").toString("base64");
}
export function merchantPrice(o) {
    checkMerchantObservation(o);
    if (o.status !== 200)
        refuse("merchant_delivery_http_200_required");
    const headers = o.rawHeaderPairs.filter(([k]) => k.toLowerCase() === "content-type");
    if (headers.length !== 1 || !/^application\/json(?:\s*;.*)?$/iu.test(headers[0][1]))
        refuse("merchant_delivery_media_type");
    let value;
    try {
        value = parseJsonWithDuplicateRejection(new TextDecoder("utf-8", { fatal: true }).decode(o.bodyBytes));
    }
    catch {
        refuse("merchant_delivery_json");
    }
    if (!isPlainRecord(value) || !exactKeys(value, ["bitcoin"]) || !isPlainRecord(value.bitcoin) || !exactKeys(value.bitcoin, ["usd", ...(value.bitcoin.usd_24h_change === undefined ? [] : ["usd_24h_change"])]) || typeof value.bitcoin.usd !== "number" ||
        !Number.isFinite(value.bitcoin.usd) || value.bitcoin.usd <= 0 ||
        (value.bitcoin.usd_24h_change !== undefined && (typeof value.bitcoin.usd_24h_change !== "number" || !Number.isFinite(value.bitcoin.usd_24h_change))))
        refuse("merchant_delivery_price_schema");
    return value;
}
export function refuse(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Pinned USDm merchant operation refused.", { reason }); }
//# sourceMappingURL=protocol.js.map