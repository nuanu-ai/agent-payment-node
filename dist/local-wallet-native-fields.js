import { ApnError } from "./errors.js";
import { exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
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
export function assertWallet(identity, expected) {
    if (!addressEqual(identity.address, expected))
        throw rejected("APN_WALLET_MISMATCH", "Wallet identity differs from the frozen payment.");
}
export function ensureX402Live(validBefore) {
    if (BigInt(Math.floor(Date.now() / 1000)) >= BigInt(validBefore))
        throw rejected("APN_APPROVAL_EXPIRED", "x402 authorization is expired.");
}
export function effectSlot(domain, profile, operationId, fingerprint) {
    return sha256(`${domain}\0${profile}\0${operationId}\0${fingerprint}`);
}
export function requestProfile(payload) {
    return canonicalProfile(payload.profile);
}
export function exactRecord(value, keys) {
    if (!isPlainRecord(value) || !exactKeys(value, keys))
        throw protocol("Custody request violates the exact schema.");
    return value;
}
export function addressEqual(left, right) { return left.toLowerCase() === right.toLowerCase(); }
export function x402Address(value, label) {
    if (typeof value !== "string")
        throw protocol(`Invalid x402 ${label}.`);
    canonicalAddress(value);
    if (value !== value.toLowerCase())
        throw protocol(`x402 ${label} must be normalized lowercase.`);
    return value;
}
export function protocol(message) { return new ApnError("APN_NATIVE_PROTOCOL", message); }
export function rejected(nativeCode, message) {
    return new ApnError("APN_NATIVE_REJECTED", message, { nativeCode });
}
//# sourceMappingURL=local-wallet-native-fields.js.map