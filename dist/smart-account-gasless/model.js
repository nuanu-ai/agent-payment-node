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
/**
 * The facilitator's `invalidReason`, kept only as a closed snake_case token (all lower or all upper case) with no hex run
 * of 12 or digit run of 6: an address, hash, UUID or request id never fits. Anything else is kept as none.
 */
export function saProviderReasonToken(value) {
    return typeof value === "string" && /^(?:[a-z][a-z0-9_]{0,63}|[A-Z][A-Z0-9_]{0,63})$/u.test(value) &&
        !/[0-9a-fA-F]{12}|\d{6}/u.test(value) ? value : null;
}
/** The shape a saved `invalidReason` must have (frozen at 0.5.106); the provider-side filter above may only get stricter. */
export function saStoredReasonToken(value) {
    return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(value);
}
//# sourceMappingURL=model.js.map