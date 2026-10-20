import { PROXY_SETTLED_TOPIC, PROXY_SETTLED_WITH_PERMIT_TOPIC, X402_EXACT_PERMIT2_PROXY } from "./x402-permit2/registry.js";
const AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export function matchingAuthorizationUsed(log, operation) {
    return log.address.toLowerCase() === operation.token.toLowerCase() && log.topics.length === 3 &&
        log.topics[0]?.toLowerCase() === AUTHORIZATION_USED_TOPIC && log.topics[1]?.toLowerCase() === paddedAddress(operation.wallet) &&
        log.topics[2]?.toLowerCase() === operation.authorization.nonce && log.data === "0x";
}
export function matchingTransfer(log, operation) {
    if (log.address.toLowerCase() !== operation.token.toLowerCase() || log.topics.length !== 3 ||
        log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics[1]?.toLowerCase() !== paddedAddress(operation.wallet) ||
        log.topics[2]?.toLowerCase() !== paddedAddress(operation.payee) || !/^0x[0-9a-f]{64}$/u.test(log.data))
        return false;
    return BigInt(log.data) === BigInt(operation.amountAtomic);
}
function paddedAddress(address) {
    return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}
/** The x402 exact Permit2 proxy's own settlement event (with or without the sponsored permit). */
export function matchingPermit2Settled(log) {
    return log.address.toLowerCase() === X402_EXACT_PERMIT2_PROXY.toLowerCase() && log.topics.length === 1 && log.data === "0x" &&
        (log.topics[0]?.toLowerCase() === PROXY_SETTLED_TOPIC || log.topics[0]?.toLowerCase() === PROXY_SETTLED_WITH_PERMIT_TOPIC);
}
//# sourceMappingURL=x402-rpc-scan.js.map