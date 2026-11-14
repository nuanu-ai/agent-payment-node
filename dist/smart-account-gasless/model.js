export const SA_CHAIN_ID = 8453;
export const SA_TTL_MS = 300_000;
export const SA_MIN_REMAINING_MS = 30_000;
export const SA_MAX_UINT = (1n << 256n) - 1n;
export const SA_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const SA_PROTOCOL_NAMES = ["manager", "value", "amount", "calldata", "timestamp", "redeemer",
    "period", "nonce", "delegate"];
/** The only answer that lets an operation reach settle. */
export function saVerifyAccepted(value) {
    return !Object.hasOwn(value, "invalidReason");
}
/** A closed provider reason token: no spaces, no hex run long enough to carry an address, hash or id. */
export function saProviderReasonToken(value) {
    return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value) && !/[0-9a-fA-F]{16}|\d{8}/u.test(value)
        ? value : null;
}
//# sourceMappingURL=model.js.map