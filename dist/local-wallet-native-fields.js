import { ApnError } from "./errors.js";
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const HASH = /^[a-f0-9]{64}$/u;
const NONCE = /^0x[0-9a-fA-F]{64}$/u;
export function decimal(value, label, positive = false) {
    if (typeof value !== "string" || !DECIMAL.test(value) || (positive && value === "0"))
        throw protocol(`Invalid ${label}.`);
    return value;
}
export function hash(value, label) {
    if (typeof value !== "string" || !HASH.test(value))
        throw protocol(`Invalid ${label}.`);
    return value;
}
export function hex32(value, label) {
    if (typeof value !== "string" || !NONCE.test(value))
        throw protocol(`Invalid ${label}.`);
    return value;
}
function protocol(message) { return new ApnError("APN_NATIVE_PROTOCOL", message); }
//# sourceMappingURL=local-wallet-native-fields.js.map