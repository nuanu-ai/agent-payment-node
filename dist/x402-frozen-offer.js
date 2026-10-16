import { isPlainRecord } from "./canonical.js";
import { stateCorrupt } from "./x402-state-validation-primitives.js";
/**
 * Binds a saved operation to the seller requirements it froze at prepare, using only that saved JSON: network,
 * asset, amount, payee and the method fields must equal the record's own economics. Returns the frozen
 * maxTimeoutSeconds that fixed validBefore. Admission limits (token map, timeout window, extra fields) belong to
 * prepare and are deliberately not re-applied here.
 */
export function frozenOfferTimeout(requirements, operation, resolved) {
    if (!isPlainRecord(requirements) || !isPlainRecord(requirements.extra))
        stateCorrupt("x402 frozen offer is malformed.");
    const extra = requirements.extra;
    const timeout = requirements.maxTimeoutSeconds;
    if (requirements.scheme !== "exact" || requirements.network !== operation.network ||
        typeof requirements.asset !== "string" || requirements.asset.toLowerCase() !== operation.token ||
        requirements.amount !== operation.amountAtomic ||
        typeof requirements.payTo !== "string" || requirements.payTo.toLowerCase() !== operation.payee ||
        typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout < 1)
        stateCorrupt("x402 frozen offer economics disagree with protected state.");
    const methodMatches = resolved.assetTransferMethod === "erc7710"
        ? extra.assetTransferMethod === "erc7710" && (extra.facilitatorAddresses === undefined || sameAddresses(extra.facilitatorAddresses, resolved.facilitatorAddresses))
        : (extra.assetTransferMethod === undefined || extra.assetTransferMethod === "eip3009") &&
            extra.name === resolved.tokenName && extra.version === resolved.tokenVersion;
    if (!methodMatches)
        stateCorrupt("x402 frozen offer method disagrees with protected state.");
    return BigInt(timeout);
}
function sameAddresses(declared, frozen) {
    if (!Array.isArray(declared) || !Array.isArray(frozen) || declared.some((item) => typeof item !== "string"))
        return false;
    const normalized = [...new Set(declared.map((item) => item.toLowerCase()))].sort();
    return JSON.stringify(normalized) === JSON.stringify([...frozen].sort());
}
//# sourceMappingURL=x402-frozen-offer.js.map