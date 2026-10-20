import { canonicalJson, domainHash, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { solanaAddress } from "../solana/rpc.js";
import { WRAPPED_SOL_MINT, X402_SOLANA_MAX_MEMO_BYTES, X402_SOLANA_NETWORK } from "./constants.js";
const U64_MAX = (1n << 64n) - 1n;
/** Every structurally valid Solana `exact` offer in seller order; anything else is skipped, never repaired. */
export function solanaExactOffers(accepts) {
    const offers = [];
    accepts.forEach((value, index) => {
        const offer = parseOffer(value, index);
        if (offer !== null)
            offers.push(offer);
    });
    return offers;
}
function parseOffer(value, index) {
    if (!isPlainRecord(value) || value.scheme !== "exact" || value.network !== X402_SOLANA_NETWORK)
        return null;
    const extra = value.extra;
    if (!isPlainRecord(extra) || typeof value.amount !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value.amount) ||
        BigInt(value.amount) > U64_MAX || typeof value.maxTimeoutSeconds !== "number" || !Number.isSafeInteger(value.maxTimeoutSeconds) ||
        value.maxTimeoutSeconds < 1)
        return null;
    const mint = canonical(value.asset), payee = canonical(value.payTo), feePayer = canonical(extra.feePayer);
    // A declared memo must be 1 to 256 bytes of well-formed UTF-8 (it is put into the transaction byte for byte).
    const memo = extra.memo === undefined ? null : typeof extra.memo === "string" && extra.memo.length > 0 &&
        Buffer.byteLength(extra.memo, "utf8") <= X402_SOLANA_MAX_MEMO_BYTES && Buffer.from(extra.memo, "utf8").toString("utf8") === extra.memo
        ? extra.memo : undefined;
    if (mint === null || payee === null || feePayer === null || memo === undefined)
        return null;
    const declaredCanonicalJson = canonicalJson(value);
    return { index, mint, amountAtomic: value.amount, payee, feePayer, maxTimeoutSeconds: value.maxTimeoutSeconds, declaredCanonicalJson,
        offerHash: domainHash("apn.x402.offer.v1", declaredCanonicalJson), memo };
}
/**
 * A native SOL offer (the wrapped SOL mint with `extra.native`, a system-program lamport transfer the seller's own note
 * asks for, and no facilitator fee payer) is outside the x402 SVM `exact` scheme, which pays only through an SPL or
 * Token-2022 TransferChecked sponsored by a facilitator.
 */
export function refuseNativeSol(accepts, mint) {
    if (mint !== WRAPPED_SOL_MINT || !accepts.some(nativeSolOffer) || solanaExactOffers(accepts).some((offer) => offer.mint === mint))
        return;
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "The seller asks for native SOL through a system transfer without a facilitator fee payer; " +
        "the x402 Solana exact scheme pays only an SPL TransferChecked sponsored by the facilitator.", { reason: "x402_solana_native_sol_unsupported",
        chain: X402_SOLANA_NETWORK, asset: mint });
}
function nativeSolOffer(value) {
    return isPlainRecord(value) && value.scheme === "exact" && value.network === X402_SOLANA_NETWORK && value.asset === WRAPPED_SOL_MINT &&
        isPlainRecord(value.extra) && (value.extra.native === true || value.extra.feePayer === undefined);
}
function canonical(value) {
    if (typeof value !== "string")
        return null;
    try {
        return solanaAddress(value);
    }
    catch {
        return null;
    }
}
/**
 * The deterministic rule: the lowest-index Solana `exact` offer for the admitted mint whose price is within the cap, whose
 * payee the owner's pin admits, and whose fee
 * payer is a third party (never the payer, the payee or the mint).
 */
export function selectSolanaOffer(input) {
    const offers = solanaExactOffers(input.accepts), forMint = offers.filter((offer) => offer.mint === input.mint);
    if (forMint.length === 0) {
        refuseNativeSol(input.accepts, input.mint);
        throw new ApnError("APN_X402_UNSUPPORTED_OFFER", `Seller challenge has no Solana x402 exact offer for the mint ${input.mint}.`, { reason: "x402_offer_asset_not_offered", chain: X402_SOLANA_NETWORK, asset: input.mint,
            offered: [...new Set(offers.map((offer) => `${X402_SOLANA_NETWORK} ${offer.mint}`))].slice(0, 16) });
    }
    let overCap = false, payeeRefused = false, feePayerRefused = false;
    for (const offer of forMint) {
        if (BigInt(offer.amountAtomic) > input.capAtomic) {
            overCap = true;
            continue;
        }
        if ([input.payer, offer.payee, offer.mint].includes(offer.feePayer) || offer.payee === input.payer) {
            feePayerRefused = true;
            continue;
        }
        if (!input.payeeAdmitted(offer.payee)) {
            payeeRefused = true;
            continue;
        }
        return offer;
    }
    if (payeeRefused) {
        throw new ApnError("APN_ALLOWLIST_REFUSED", "The active owner allowlist policy pins the recipients of this admission; no offered payee is one of them.", { reason: "allowlist_recipient_not_admitted", rail: "x402", chain: X402_SOLANA_NETWORK });
    }
    if (overCap) {
        throw new ApnError("APN_X402_CAP_EXCEEDED", "Every Solana offer for this mint exceeds the explicit maximum or the owner's per-payment cap.", { reason: "x402_offer_exceeds_cap", chain: X402_SOLANA_NETWORK, asset: input.mint, capAtomic: input.capAtomic.toString() });
    }
    if (feePayerRefused) {
        throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "The seller's fee payer is the payer, the payee or the mint; APN pays only through a third-party fee payer.", { reason: "x402_solana_fee_payer_invalid" });
    }
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", "No Solana offer can be paid.", { reason: "x402_solana_no_payable_offer" });
}
//# sourceMappingURL=offer.js.map