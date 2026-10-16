import { getAddress } from "viem";
import { LEGACY_MERCHANT_ASSET, LEGACY_MERCHANT_MECHANISM, LEGACY_MERCHANT_URL, MERCHANT_CHAIN, merchantAssetMechanism } from "./pins.js";
function terms(payer, url, accepted, asset, legacy) {
    return { payer, url, chain: asset.chain, token: asset.token, payee: getAddress(String(accepted.payTo)), amount: String(accepted.amount),
        mechanism: legacy ? LEGACY_MERCHANT_MECHANISM : merchantAssetMechanism(asset), asset, legacy };
}
/** Terms of a new operation: payer custody(profile), `--url`, and the single challenge row naming a pinned asset. */
export function merchantPrepareTerms(payer, url, frozen, asset) {
    return terms(payer, url, frozen.accepted, asset, false);
}
/** Terms of a stored operation, from its own recorded custody, URL, asset and frozen row (version 1: the frozen legacy table). */
export function merchantTerms(o) {
    return o.schemaVersion === "apn.x402-merchant.v1"
        ? terms(o.custody.walletAddress, LEGACY_MERCHANT_URL, o.frozen.accepted, LEGACY_MERCHANT_ASSET, true)
        : terms(o.custody.walletAddress, o.url, o.frozen.accepted, o.asset, false);
}
//# sourceMappingURL=terms.js.map