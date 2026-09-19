import { getAddress, isAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_BLOCKED, X402_PERMIT2_MAX_TIMEOUT_SECONDS, permit2ListAsset, } from "./registry.js";
const OFFER_DOMAIN = "apn.x402-permit2.offer.v1";
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO = "0x0000000000000000000000000000000000000000";
/**
 * Select the first seller offer that pays a list-pinned token on a list network through the exact Permit2 flow.
 * Unsupported offers may coexist; they are skipped, never repaired. An offer naming a pinned token with any
 * deviation (unknown field, another transfer method, other token domain, unbounded timeout) is not selectable.
 */
export function selectPermit2Offer(accepts, payer) {
    if (!Array.isArray(accepts) || accepts.length === 0)
        refuse("x402_permit2_no_listed_offer", "The seller offered no payment requirements.");
    const payerAddress = strictAddress(payer);
    if (payerAddress === undefined)
        throw new ApnError("APN_INVALID_INPUT", "The payer must be an exact EVM address.");
    let listedButInvalid = false;
    let blocked = false;
    for (const [index, offer] of accepts.entries()) {
        if (!isPlainRecord(offer))
            continue;
        const listAsset = permit2ListAsset(offer.network);
        if (listAsset === undefined) {
            blocked ||= X402_PERMIT2_BLOCKED.some((row) => row.chain === offer.network && sameAddress(offer.asset, row.token));
            continue;
        }
        if (!sameAddress(offer.asset, listAsset.token))
            continue;
        const selection = validateOffer(index, offer, listAsset, payerAddress);
        if (selection !== undefined)
            return selection;
        listedButInvalid = true;
    }
    if (listedButInvalid)
        refuse("x402_permit2_offer_invalid", "The seller's offer for a listed token is not an exact Permit2 offer APN can sign.");
    if (blocked)
        refuse("x402_permit2_facilitator_unavailable", "No keyless facilitator settles this listed token on its network.");
    return refuse("x402_permit2_no_listed_offer", "No seller offer pays a list-pinned token through the exact Permit2 flow.");
}
/** Revalidate a frozen selection against its pinned registry row; any drift is state corruption. */
export function validatePermit2Selection(value, payer) {
    const listAsset = permit2ListAsset(value.requirement?.network);
    const again = listAsset === undefined || !Number.isSafeInteger(value.index) || value.index < 0
        ? undefined : validateOffer(value.index, value.requirement, listAsset, payer);
    if (again === undefined || canonicalJson(again) !== canonicalJson(value)) {
        throw new ApnError("APN_STATE_CORRUPT", "The frozen x402 Permit2 offer selection is invalid.");
    }
    return again;
}
function validateOffer(index, offer, listAsset, payer) {
    if (!exactKeys(offer, ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"]) || offer.scheme !== "exact")
        return undefined;
    if (!validExtra(offer.extra, listAsset))
        return undefined;
    if (typeof offer.amount !== "string" || !/^[1-9][0-9]{0,77}$/u.test(offer.amount) || BigInt(offer.amount) > MAX_UINT256)
        return undefined;
    if (typeof offer.maxTimeoutSeconds !== "number" || !Number.isSafeInteger(offer.maxTimeoutSeconds) ||
        offer.maxTimeoutSeconds < 1 || offer.maxTimeoutSeconds > X402_PERMIT2_MAX_TIMEOUT_SECONDS)
        return undefined;
    const payTo = strictAddress(offer.payTo);
    if (payTo === undefined || [ZERO, payer, listAsset.token, PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY].some((address) => sameAddress(payTo, address))) {
        return undefined;
    }
    const requirement = structuredClone(offer);
    return {
        index,
        requirement,
        listAsset,
        amountAtomic: offer.amount,
        payTo,
        maxTimeoutSeconds: offer.maxTimeoutSeconds,
        offerHash: domainHash(OFFER_DOMAIN, canonicalJson(requirement)),
    };
}
/** `name`/`version` are optional seller hints; when present they must equal the pinned token domain exactly. */
function validExtra(value, listAsset) {
    if (!isPlainRecord(value) || value.assetTransferMethod !== "permit2")
        return false;
    if (exactKeys(value, ["assetTransferMethod"]))
        return true;
    return exactKeys(value, ["assetTransferMethod", "name", "version"]) &&
        value.name === listAsset.tokenDomain.name && value.version === listAsset.tokenDomain.version;
}
function strictAddress(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        return undefined;
    // Mixed case must be a valid EIP-55 checksum; all-lowercase or all-uppercase hex carries no checksum.
    const hex = value.slice(2), unchecksummed = hex === hex.toLowerCase() || hex === hex.toUpperCase();
    if (!unchecksummed && !isAddress(value, { strict: true }))
        return undefined;
    return getAddress(value.toLowerCase());
}
function sameAddress(left, right) {
    const parsed = strictAddress(left);
    return parsed !== undefined && parsed.toLowerCase() === right.toLowerCase();
}
function refuse(reason, message) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", message, { reason, rail: "x402" });
}
//# sourceMappingURL=offer.js.map