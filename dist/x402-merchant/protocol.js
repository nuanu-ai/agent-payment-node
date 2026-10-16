import { parseJsonWithDuplicateRejection } from "../x402-strict-json.js";
import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { decodeCanonicalBase64Json } from "../x402-codec.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { LEGACY_MERCHANT_AMOUNT, LEGACY_MERCHANT_ASSET, LEGACY_MERCHANT_PAYEE, LEGACY_MERCHANT_URL, merchantAssetPin } from "./pins.js";
const LEGACY = { url: LEGACY_MERCHANT_URL, legacy: true, asset: LEGACY_MERCHANT_ASSET };
/** `--url`: a credential-free public HTTPS URL in its canonical WHATWG form (the rule x402 fetch uses). */
export function canonicalMerchantUrl(value) {
    if (typeof value !== "string")
        throw new ApnError("APN_INVALID_INPUT", "Merchant URL must be a string.");
    const url = parsePublicHttpsUrl(value, "APN_HTTP_CONFIG", "Merchant URL", 2048).toString();
    if (url !== value)
        throw new ApnError("APN_HTTP_CONFIG", "Merchant URL must use its canonical WHATWG serialization.");
    return url;
}
/** HTTPS from the exact URL, TLS-authorized, no redirects, bounded body. */
export function checkMerchantObservation(o, url = LEGACY_MERCHANT_URL) {
    if (o.finalUrl !== url || o.observedOrigin !== new URL(url).origin ||
        o.safeTransportProvenance?.protocol !== "https" || o.safeTransportProvenance.tlsAuthorized !== true || o.safeTransportProvenance.redirectCount !== 0 ||
        o.bodyBytes.length > 256 * 1024 || !Number.isFinite(Date.parse(o.observedAt)))
        refuse("merchant_http_provenance");
}
function challengeShape(value, legacy) {
    if (!isPlainRecord(value) || !exactKeys(value, ["x402Version", "resource", "accepts", ...(value.error === undefined ? [] : ["error"]), ...(value.extensions === undefined ? [] : ["extensions"])]) || value.x402Version !== 2 ||
        !isPlainRecord(value.resource) || (legacy ? value.resource.url !== LEGACY_MERCHANT_URL : typeof value.resource.url !== "string" || value.resource.url.length > 2048) ||
        !Array.isArray(value.accepts) || value.accepts.length < 1 || value.accepts.length > 16)
        refuse("merchant_challenge_shape");
    // Legacy: only the x402engine `bazaar` extension. Generic: any informational object; APN acts on none of them.
    if (value.error !== undefined && (typeof value.error !== "string" || value.error.length > 256) ||
        value.extensions !== undefined && (!isPlainRecord(value.extensions) || legacy && (!exactKeys(value.extensions, ["bazaar"]) || !isPlainRecord(value.extensions.bazaar))))
        refuse("merchant_challenge_extensions");
}
function freeze(value, matches) {
    if (matches.length !== 1)
        refuse("merchant_exact_requirement_missing_or_ambiguous");
    const challenge = structuredClone(value);
    return { challenge, accepted: structuredClone(matches[0]), challengeHash: hashObject(challenge) };
}
/** Version 1 (frozen legacy table): exactly one x402engine USDm Bitcoin-price row. */
export function checkMerchantChallenge(value) {
    challengeShape(value, true);
    return freeze(value, value.accepts.filter((r) => {
        if (!isPlainRecord(r) || !exactKeys(r, ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"]))
            return false;
        try {
            return r.scheme === "exact" && r.network === LEGACY_MERCHANT_ASSET.chain && getAddress(String(r.asset)) === LEGACY_MERCHANT_ASSET.token &&
                r.amount === LEGACY_MERCHANT_AMOUNT && getAddress(String(r.payTo)) === LEGACY_MERCHANT_PAYEE && r.maxTimeoutSeconds === 300 &&
                canonicalJson(r.extra) === canonicalJson({ name: "USDm", version: "2" });
        }
        catch {
            return false;
        }
    }));
}
/**
 * Any merchant (OD-2): exactly one `exact` row whose network and asset name a pinned asset. Payee, amount and asset come
 * from that row; the owner's admission (asset, mechanism, caps, optional recipient pin) bounds them. A row whose payment
 * window is shorter than APN's own 300-second local deadline is not payable and never matches.
 */
export function checkGenericMerchantChallenge(value, assets) {
    challengeShape(value, false);
    const rows = value.accepts.map((r) => {
        if (!isPlainRecord(r) || !exactKeys(r, ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", ...(r.extra === undefined ? [] : ["extra"])]) ||
            r.scheme !== "exact" || (r.extra !== undefined && !isPlainRecord(r.extra)))
            return null;
        const asset = merchantAssetPin(r.network, r.asset, assets);
        let payee = null;
        try {
            payee = getAddress(String(r.payTo));
        }
        catch { /* not an EVM payee */ }
        const amount = typeof r.amount === "string" && /^[1-9][0-9]{0,77}$/u.test(r.amount) && BigInt(r.amount) < 1n << 256n;
        return asset !== undefined && payee !== null && payee !== "0x0000000000000000000000000000000000000000" && amount &&
            Number.isSafeInteger(r.maxTimeoutSeconds) && r.maxTimeoutSeconds >= 300 ? { row: r, asset } : null;
    }).filter((x) => x !== null);
    const frozen = freeze(value, rows.map((x) => x.row));
    return { ...frozen, asset: rows[0].asset };
}
/** Re-derive the frozen challenge from its stored body under the operation's own context; never from the current registry. */
export function checkChallengeFor(ctx, value) {
    if (ctx.legacy)
        return checkMerchantChallenge(value);
    const { asset: _asset, ...frozen } = checkGenericMerchantChallenge(value, [ctx.asset]);
    return frozen;
}
/** The 402 challenge for the operation's URL; version 1 keeps the legacy reader. */
export function merchantChallenge(o, ctx = LEGACY) {
    checkMerchantObservation(o, ctx.url);
    if (o.status !== 402)
        refuse("merchant_http_402_required");
    const headers = o.rawHeaderPairs.filter(([k]) => k.toLowerCase() === "payment-required");
    if (headers.length !== 1)
        refuse("merchant_payment_required_header");
    return checkChallengeFor(ctx, decodeCanonicalBase64Json(headers[0][1]));
}
/** A new merchant's 402: the single row naming any pinned asset selects the asset. */
export function merchantGenericChallenge(o, url, assets) {
    checkMerchantObservation(o, url);
    if (o.status !== 402)
        refuse("merchant_http_402_required");
    const headers = o.rawHeaderPairs.filter(([k]) => k.toLowerCase() === "payment-required");
    if (headers.length !== 1)
        refuse("merchant_payment_required_header");
    return checkGenericMerchantChallenge(decodeCanonicalBase64Json(headers[0][1]), assets);
}
export function merchantProof(frozen, txHash, ctx = LEGACY) {
    const checked = checkChallengeFor(ctx, frozen.challenge);
    if (canonicalJson(checked) !== canonicalJson(frozen) || !/^0x[0-9a-f]{64}$/u.test(txHash) || /^0x0+$/u.test(txHash))
        refuse("merchant_proof_binding");
    return Buffer.from(canonicalJson({ x402Version: 2, payload: { txHash }, resource: frozen.challenge.resource, accepted: frozen.accepted }), "utf8").toString("base64");
}
/** Version 1 delivery: HTTP 200 JSON with a finite positive Bitcoin USD price. */
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
/**
 * Any merchant: delivery is HTTP 200 from the operation's URL. The bounded body is retained with its digest; a JSON body
 * (by media type, duplicate keys refused) is kept parsed, any other body as base64.
 */
export function merchantDelivery(o, ctx) {
    if (ctx.legacy)
        return merchantPrice(o);
    checkMerchantObservation(o, ctx.url);
    if (o.status !== 200)
        refuse("merchant_delivery_http_200_required");
    const types = o.rawHeaderPairs.filter(([k]) => k.toLowerCase() === "content-type").map(([, v]) => v);
    if (types.length > 1)
        refuse("merchant_delivery_media_type");
    const mediaType = types[0] ?? null;
    if (mediaType !== null && /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;.*)?$/iu.test(mediaType)) {
        try {
            return { mediaType, json: parseJsonWithDuplicateRejection(new TextDecoder("utf-8", { fatal: true }).decode(o.bodyBytes)) };
        }
        catch {
            refuse("merchant_delivery_json");
        }
    }
    return { mediaType, base64: Buffer.from(o.bodyBytes).toString("base64") };
}
export function refuse(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Merchant transfer-proof operation refused.", { reason }); }
//# sourceMappingURL=protocol.js.map