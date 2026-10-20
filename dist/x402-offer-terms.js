import { createHash } from "node:crypto";
import { X402_EXACT_PERMIT2_PROXY } from "./x402-permit2/registry.js";
/**
 * The longest seller payment window (`maxTimeoutSeconds`) APN signs for, EIP-3009 and Permit2 alike: the signed
 * authorization (EIP-3009 `validBefore`, Permit2 `deadline`) stays valid this long after prepare. In the public x402
 * discovery catalog (25,959 resources, 71,406 `exact` offers, read 2026-10-21) 95.1% of offers ask at most 300 s and
 * 96.4% at most 3,600 s; about 3.5% ask 604,800–605,400 s (seven days), which APN refuses by name
 * (`x402_offer_timeout_exceeds_bound`) instead of leaving a payment signature live for a week.
 */
export const X402_OFFER_MAX_TIMEOUT_SECONDS = 3600;
/** The shortest window unattended x402 signs for: prepare, the owner's approval, signing and the paid request must fit. */
export const X402_OFFER_MIN_TIMEOUT_SECONDS = 30;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const MAX_TEXT = 128;
/** The only shape of seller text a refusal repeats verbatim: no spaces, quotes, brackets or other words-forming marks. */
const SELLER_VERBATIM = /^[A-Za-z0-9._:/-]{1,64}$/u;
/**
 * A seller-controlled value as a refusal's structured details show it, never its `message`: verbatim only when its text
 * (a string itself, anything else as JSON) matches {@link SELLER_VERBATIM}, otherwise only the UTF-8 byte length and
 * sha256 of that text. Seller text is untrusted input an agent reads; this way it cannot reach the agent as instructions.
 */
export function sellerValue(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value) ?? typeof value;
    if (SELLER_VERBATIM.test(text))
        return text;
    const bytes = Buffer.from(text, "utf8");
    return `length:${bytes.byteLength} sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export function offerRefusal(reason, field, value, expected) {
    return { reason, field, ...(value === undefined ? {} : { value: sellerValue(value) }), ...(expected === undefined ? {} : { expected }) };
}
export function isOfferRefusal(value) {
    return typeof value === "object" && value !== null && typeof value.reason === "string" &&
        typeof value.field === "string";
}
/** The seller's window must be a whole number of seconds from `minimum` through {@link X402_OFFER_MAX_TIMEOUT_SECONDS}. */
export function timeoutRefusal(value, minimum) {
    const bound = `${minimum}..${X402_OFFER_MAX_TIMEOUT_SECONDS}`;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
        return offerRefusal("x402_offer_timeout_below_bound", "maxTimeoutSeconds", value, bound);
    }
    return value > X402_OFFER_MAX_TIMEOUT_SECONDS
        ? offerRefusal("x402_offer_timeout_exceeds_bound", "maxTimeoutSeconds", value, bound) : null;
}
/** `extra.assetTransferMethod`: absent or `eip3009`, `permit2`, `erc7710`; any other method is refused by its name. */
export function evmOfferMethod(extra) {
    const declared = extra.assetTransferMethod;
    if (declared === undefined || declared === "eip3009")
        return "eip3009";
    if (declared === "permit2" || declared === "erc7710")
        return declared;
    return offerRefusal("x402_offer_method_unsupported", "extra.assetTransferMethod", declared, "eip3009, permit2 or erc7710");
}
/**
 * The `extra` keys APN understands, checked strictly: `name`/`version` (bounded text; required for EIP-3009, a pair for
 * Permit2), `decimals` (0..255; the token's own decimals are compared where they are read), `paymentFlow`
 * (`authorization` outside Permit2), Permit2 `spenderAddress` (exactly the x402 exact Permit2 proxy) and `chainId`
 * (exactly the offer's chain). Every other key is the seller's own: never a reason to refuse, carried unchanged in the
 * `accepted` requirements the payment payload echoes.
 */
export function evmExtraRefusal(extra, method, chainId) {
    for (const key of ["name", "version"]) {
        const value = extra[key];
        if (value !== undefined && !boundedText(value))
            return offerRefusal("x402_offer_extra_invalid", `extra.${key}`, value, "1..128 UTF-8 bytes");
    }
    if (method === "eip3009" || method === "permit2" && (extra.name === undefined) !== (extra.version === undefined)) {
        const missing = extra.name === undefined ? "name" : extra.version === undefined ? "version" : null;
        if (missing !== null)
            return offerRefusal("x402_offer_extra_invalid", `extra.${missing}`, undefined, "the token's EIP-712 domain name and version");
    }
    const decimals = extra.decimals;
    if (decimals !== undefined && (typeof decimals !== "number" || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255)) {
        return offerRefusal("x402_offer_extra_invalid", "extra.decimals", decimals, "0..255");
    }
    if (method !== "permit2" && extra.paymentFlow !== undefined && extra.paymentFlow !== "authorization") {
        return offerRefusal("x402_offer_extra_invalid", "extra.paymentFlow", extra.paymentFlow, "authorization");
    }
    const spender = extra.spenderAddress;
    if (method === "permit2" && spender !== undefined &&
        !(typeof spender === "string" && ADDRESS.test(spender) && spender.toLowerCase() === X402_EXACT_PERMIT2_PROXY.toLowerCase())) {
        return offerRefusal("x402_offer_spender_mismatch", "extra.spenderAddress", spender, X402_EXACT_PERMIT2_PROXY);
    }
    if (extra.chainId !== undefined && !sameChain(extra.chainId, chainId)) {
        return offerRefusal("x402_offer_chain_mismatch", "extra.chainId", extra.chainId, String(chainId));
    }
    return null;
}
/** The offer's declared token decimals must equal the token's own; absent, nothing is compared. */
export function decimalsRefusal(extra, decimals) {
    return extra.decimals === undefined || extra.decimals === decimals ? null
        : offerRefusal("x402_token_decimals_mismatch", "extra.decimals", extra.decimals, String(decimals));
}
/** The method an offer names, as text for a refusal's details (never trusted for anything else). */
export function declaredMethod(extra) {
    const declared = typeof extra === "object" && extra !== null ? extra.assetTransferMethod : undefined;
    return declared === undefined ? "eip3009" : sellerValue(declared);
}
/**
 * The refusal details for offers of the selected chain and token that were all refused: the reason they share (or
 * `x402_offers_refused` when they differ), the first one's deciding field with the seller's value and what APN accepts
 * there, and every refused offer in seller order as one line each (at most 16). The message names only APN's own words
 * (the offer's place, the selected network and token, the reason and field); every seller value stays in the details.
 */
export function refusedOffersDetails(refused) {
    const first = refused[0];
    if (first === undefined)
        throw new Error("No refused offer to name.");
    const reason = refused.every((offer) => offer.reason === first.reason) ? first.reason : "x402_offers_refused";
    return {
        message: `The seller's offer ${first.index} for ${first.network} ${first.asset} was refused: ${first.reason} (${first.field}); ` +
            "details name the seller's value and what APN accepts.",
        details: { reason, field: first.field, ...(first.value === undefined ? {} : { sellerValue: first.value }),
            ...(first.expected === undefined ? {} : { accepted: first.expected }), refused: refused.slice(0, 16).map(refusedLine) },
    };
}
function refusedLine(offer) {
    return `offer ${offer.index} ${offer.network} ${offer.asset} ${offer.method}: ${offer.reason} ${offer.field}` +
        `${offer.value === undefined ? "" : `=${offer.value}`}${offer.expected === undefined ? "" : ` (APN accepts ${offer.expected})`}`;
}
function sameChain(value, chainId) {
    return typeof value === "number" ? value === chainId : typeof value === "string" && value === String(chainId);
}
function boundedText(value) {
    return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_TEXT;
}
//# sourceMappingURL=x402-offer-terms.js.map