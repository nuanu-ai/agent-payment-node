import { METAMASK_FACILITATOR_ADDRESSES } from "@metamask/smart-accounts-kit/experimental";
import { exactKeys, isPlainRecord } from "./canonical.js";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
export function canonicalErc7710Facilitators(extra) {
    const allowed = new Set([
        "assetTransferMethod", "facilitatorAddresses", "name", "version", "decimals", "paymentFlow",
    ]);
    if (extra.assetTransferMethod !== "erc7710" || Object.keys(extra).some((key) => !allowed.has(key)) ||
        !optionalBoundedString(extra.name) || !optionalBoundedString(extra.version) ||
        (extra.decimals !== undefined && extra.decimals !== 6) ||
        (extra.paymentFlow !== undefined && extra.paymentFlow !== "authorization"))
        return null;
    const value = extra.facilitatorAddresses;
    if (value === undefined)
        return normalizeAddresses(METAMASK_FACILITATOR_ADDRESSES);
    if (!Array.isArray(value) || value.length === 0 || value.length > 16)
        return null;
    return normalizeAddresses(value);
}
function normalizeAddresses(value) {
    const normalized = [];
    const unique = new Set();
    for (const item of value) {
        if (typeof item !== "string" || !ADDRESS.test(item) || /^0x0{40}$/iu.test(item))
            return null;
        const address = item.toLowerCase();
        if (unique.has(address))
            return null;
        unique.add(address);
        normalized.push(address);
    }
    return normalized;
}
function optionalBoundedString(value) {
    return value === undefined || (typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 128);
}
export function isStrictErc7710Payload(value) {
    return isPlainRecord(value) && exactKeys(value, ["delegationManager", "permissionContext", "delegator"]) &&
        typeof value.delegationManager === "string" && ADDRESS.test(value.delegationManager) &&
        !/^0x0{40}$/iu.test(value.delegationManager) && typeof value.delegator === "string" &&
        ADDRESS.test(value.delegator) && !/^0x0{40}$/iu.test(value.delegator) &&
        typeof value.permissionContext === "string" && /^0x(?:[0-9a-fA-F]{2})+$/u.test(value.permissionContext);
}
//# sourceMappingURL=x402-erc7710-codec.js.map