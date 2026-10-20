import { canonicalJson, domainHash, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { canonicalErc7710Facilitators } from "./x402-erc7710-codec.js";
import { isBaseUsdc, releasedX402Pair } from "./x402-network.js";
import { declaredMethod, decimalsRefusal, evmExtraRefusal, evmOfferMethod, isOfferRefusal, offerRefusal, refusedOffersDetails, timeoutRefusal, X402_OFFER_MIN_TIMEOUT_SECONDS } from "./x402-offer-terms.js";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const POSITIVE_UINT = /^[1-9][0-9]*$/u;
const READINESS = { cap: "unverified", walletBalance: "unverified", tokenDomain: "unverified", payment: "unverified" };
/** Offers of exactly the selected network and token (a bare chain id: its released USDC); others are skipped, never repaired. */
export function inspectCandidates(paymentRequired, requestedUrl, asset) {
    return inspectOffers(paymentRequired, requestedUrl, asset).candidates;
}
/** Every offer of the selected network and token, judged: a candidate, or refused with the reason that decided it. */
export function inspectOffers(paymentRequired, requestedUrl, asset) {
    if (paymentRequired.x402Version !== 2)
        return { candidates: [], refused: [], resourceMismatch: null };
    if (!resourceMatches(paymentRequired.resource.url, requestedUrl)) {
        return { candidates: [], refused: [], resourceMismatch: paymentRequired.resource.url.slice(0, 2048) };
    }
    const candidates = [], refused = [];
    paymentRequired.accepts.forEach((requirements, index) => {
        const verdict = inspectOffer(requirements, index, asset);
        if (verdict === null)
            return;
        if (isOfferRefusal(verdict)) {
            refused.push({ index: index.toString(), network: asset.network, asset: asset.token.toLowerCase(), method: declaredMethod(requirements.extra), ...verdict });
        }
        else
            candidates.push(verdict);
    });
    return { candidates, refused, resourceMismatch: null };
}
/**
 * One seller offer against the selected network and token: null when it is for another network or token, a candidate
 * when APN can sign it, otherwise the refusal naming the field that decided it (amount, payee, method, timeout, an
 * `extra` key APN understands, the token's decimals).
 */
export function inspectOffer(requirements, index, selected) {
    if (requirements.scheme !== "exact" || requirements.network !== selected.network || !ADDRESS.test(requirements.asset) ||
        requirements.asset.toLowerCase() !== selected.token.toLowerCase())
        return null;
    const extra = isPlainRecord(requirements.extra) ? requirements.extra : {};
    if (!POSITIVE_UINT.test(requirements.amount))
        return offerRefusal("x402_offer_amount_invalid", "amount", requirements.amount);
    if (!ADDRESS.test(requirements.payTo) || /^0x0{40}$/iu.test(requirements.payTo))
        return offerRefusal("x402_offer_payee_invalid", "payTo", requirements.payTo);
    const method = evmOfferMethod(extra);
    if (isOfferRefusal(method))
        return method;
    const refusal = timeoutRefusal(requirements.maxTimeoutSeconds, X402_OFFER_MIN_TIMEOUT_SECONDS) ?? evmExtraRefusal(extra, method, selected.chainId) ??
        // A declared decimals hint must be USDC's 6 on the released pairs; elsewhere prepare compares it with the token's own.
        (releasedX402Pair(selected.chainId, selected.token) ? decimalsRefusal(extra, 6) : null);
    if (refusal !== null)
        return refusal;
    const declaredCanonicalJson = canonicalJson(requirements);
    const base = {
        index: index.toString(),
        scheme: "exact",
        network: selected.network,
        asset: requirements.asset.toLowerCase(),
        amountAtomic: requirements.amount,
        payTo: requirements.payTo.toLowerCase(),
        maxTimeoutSeconds: requirements.maxTimeoutSeconds.toString(),
        offerHash: domainHash("apn.x402.offer.v1", declaredCanonicalJson),
        readiness: READINESS,
    };
    if (method === "permit2") {
        return { ...base, assetTransferMethod: "permit2", paymentFlow: "permit2WitnessTransfer",
            ...(typeof extra.name === "string" ? { tokenName: extra.name, tokenVersion: extra.version } : {}) };
    }
    if (method === "erc7710") {
        if (!isBaseUsdc(selected))
            return offerRefusal("x402_offer_method_unsupported", "extra.assetTransferMethod", "erc7710", "erc7710 only on Base USDC");
        const facilitatorAddresses = canonicalErc7710Facilitators(extra);
        if (facilitatorAddresses === null)
            return offerRefusal("x402_offer_extra_invalid", "extra.facilitatorAddresses", extra.facilitatorAddresses, "1..16 distinct EVM addresses");
        return { ...base, assetTransferMethod: "erc7710", paymentFlow: "delegatedErc20Transfer", facilitatorAddresses };
    }
    return { ...base, tokenName: extra.name, tokenVersion: extra.version,
        assetTransferMethod: "eip3009", paymentFlow: "transferWithAuthorization" };
}
/**
 * The refusal when no offer of the selected network and token can be signed: the resource the seller names is another
 * origin or path, every such offer was refused (each with its reason), or the seller offers this network and token not at all.
 */
export function unsupportedOfferError(asset, paymentRequired, inspection) {
    const pair = { chain: asset.network, asset: asset.token };
    if (inspection.resourceMismatch !== null) {
        return new ApnError("APN_X402_UNSUPPORTED_OFFER", "The seller's challenge names a resource on another origin or path than the one requested; APN pays only for the endpoint it asked for.", { reason: "x402_resource_url_mismatch", ...pair, resourceUrl: inspection.resourceMismatch });
    }
    const offered = offeredX402Assets(paymentRequired.accepts).map((offer) => `${offer.network} ${offer.asset} ${offer.method}`);
    if (inspection.refused.length > 0) {
        const named = refusedOffersDetails(inspection.refused);
        return new ApnError("APN_X402_UNSUPPORTED_OFFER", named.message, { ...named.details, ...pair, offered });
    }
    // Name what the seller does offer, so the caller can select another admitted network and token.
    return new ApnError("APN_X402_UNSUPPORTED_OFFER", `Seller challenge has no supported x402 offer for ${asset.token} on ${asset.network}.`, { reason: "x402_offer_asset_not_offered", ...pair, offered });
}
/** The seller's EVM `exact` offers as (network, lowercase asset, method), at most 16, for a refusal's details. */
function offeredX402Assets(accepts) {
    const out = [];
    for (const offer of accepts) {
        if (out.length >= 16 || typeof offer !== "object" || offer === null)
            continue;
        const { scheme, network, asset, extra } = offer;
        if (scheme !== "exact" || typeof network !== "string" || !/^eip155:[1-9][0-9]{0,15}$/u.test(network) ||
            typeof asset !== "string" || !ADDRESS.test(asset))
            continue;
        const method = declaredMethod(extra);
        if (!out.some((row) => row.network === network && row.asset === asset.toLowerCase() && row.method === method))
            out.push({ network, asset: asset.toLowerCase(), method });
    }
    return out;
}
/**
 * The seller's resource names the requested endpoint: the same scheme, host, port and path after WHATWG normalisation.
 * Query and fragment may differ (most sellers name the resource without the caller's query); the seller's resource is
 * still echoed unchanged in the payment payload, and the paid request goes to the requested URL.
 */
function resourceMatches(value, requested) {
    try {
        const resource = new URL(value), target = new URL(requested);
        return resource.origin === target.origin && resource.pathname === target.pathname;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=x402-offer-inspect.js.map