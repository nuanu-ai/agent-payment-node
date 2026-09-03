import { exactKeys, isPlainRecord } from "./canonical.js";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
export function canonicalErc7710Facilitators(extra) {
    if (!exactKeys(extra, ["assetTransferMethod", "facilitatorAddresses"]))
        return null;
    const value = extra.facilitatorAddresses;
    if (!Array.isArray(value) || value.length === 0 || value.length > 16)
        return null;
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
export function isStrictErc7710Payload(value) {
    return isPlainRecord(value) && exactKeys(value, ["delegationManager", "permissionContext", "delegator"]) &&
        typeof value.delegationManager === "string" && ADDRESS.test(value.delegationManager) &&
        !/^0x0{40}$/iu.test(value.delegationManager) && typeof value.delegator === "string" &&
        ADDRESS.test(value.delegator) && !/^0x0{40}$/iu.test(value.delegator) &&
        typeof value.permissionContext === "string" && /^0x(?:[0-9a-fA-F]{2})+$/u.test(value.permissionContext);
}
//# sourceMappingURL=x402-erc7710-codec.js.map