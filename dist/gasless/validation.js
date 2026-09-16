import { getAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
export const GASLESS_CHAINS = [1, 10, 130, 137, 8453, 42161, 43114];
// Keep historical Avalanche records parseable; the admitted bundler path lacks EIP-7702 there.
export const GASLESS_EIP7702_CHAINS = Object.freeze([1, 10, 130, 137, 8453, 42161]);
export const GASLESS_TTL_MS = 300_000;
export const GASLESS_MIN_REMAINING_MS = 15_000;
export const GASLESS_MAX_UINT = (1n << 256n) - 1n;
export const GASLESS_MAX_UINT120 = (1n << 120n) - 1n;
export const GASLESS_MAX_DATA = 16 * 1024;
export const GASLESS_ZERO_ADDRESS = `0x${"0".repeat(40)}`;
export const GASLESS_FACTORY = getAddress("0x7702000000000000000000000000000000000000");
export function gaslessFailure(code, reason) {
    throw new ApnError(code, `Gasless validation failed: ${reason}.`);
}
export function gaslessRecord(value, code = "APN_PROVIDER_PROTOCOL") {
    if (!isPlainRecord(value))
        gaslessFailure(code, "gasless_record_shape");
    return value;
}
export function gaslessExact(value, keys, code = "APN_STATE_CORRUPT") {
    const r = gaslessRecord(value, code);
    if (!exactKeys(r, keys))
        gaslessFailure(code, "gasless_record_fields");
    return r;
}
export function gaslessUint(value, positive = false, code = "APN_PROVIDER_PROTOCOL") {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value))
        gaslessFailure(code, "gasless_atomic_integer");
    const n = BigInt(value);
    if (n > GASLESS_MAX_UINT || (positive && n === 0n))
        gaslessFailure(code, "gasless_integer_bound");
    return n;
}
export const GASLESS_MAX_DECIMALS = 36;
/** Scales one operator amount by the admitting registry row's `decimals`; never by a baked scale. */
export function gaslessDecimal(value, decimals, positive = false) {
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > GASLESS_MAX_DECIMALS) {
        gaslessFailure("APN_INVALID_INPUT", "gasless_decimal_scale");
    }
    const fractionPart = decimals === 0 ? "" : `(?:\\.[0-9]{1,${decimals}})?`;
    if (typeof value !== "string" || !new RegExp(`^(?:0|[1-9][0-9]{0,71})${fractionPart}$`, "u").test(value)) {
        gaslessFailure("APN_INVALID_INPUT", "gasless_decimal_amount");
    }
    const [whole, fraction = ""] = value.split(".");
    const n = (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")).toString();
    gaslessUint(n, positive, "APN_INVALID_INPUT");
    return n;
}
export function gaslessAddress(value, code = "APN_PROVIDER_PROTOCOL") {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        gaslessFailure(code, "gasless_address_shape");
    try {
        return getAddress(value);
    }
    catch {
        return gaslessFailure(code, "gasless_address_checksum");
    }
}
export function gaslessHex(value, maximum = GASLESS_MAX_DATA, bytes, code = "APN_PROVIDER_PROTOCOL") {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) || value.length > 2 + maximum * 2 ||
        (bytes !== undefined && value.length !== 2 + bytes * 2))
        gaslessFailure(code, "gasless_bounded_hex");
    return value.toLowerCase();
}
export function gaslessHash(value, code = "APN_STATE_CORRUPT") {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
        gaslessFailure(code, "gasless_hash_identity");
    return value;
}
export function gaslessChain(value, code = "APN_INVALID_INPUT") {
    if (!GASLESS_CHAINS.includes(value))
        gaslessFailure(code, "gasless_chain_identity");
    return value;
}
export function assertGaslessExecutionChain(chainId) {
    if (!GASLESS_EIP7702_CHAINS.includes(gaslessChain(chainId))) {
        gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_eip7702_unavailable");
    }
}
export function gaslessIso(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        gaslessFailure("APN_STATE_CORRUPT", "gasless_timestamp");
    return value;
}
export function gaslessSame(a, b) { return canonicalJson(a) === canonicalJson(b); }
export function validateGaslessRequest(value, code = "APN_INVALID_INPUT") {
    const r = gaslessExact(value, ["chainId", "recipient", "grossAtomic", "maxFeeAtomic", "minReceivedAtomic"], code);
    gaslessChain(r.chainId, code);
    if (gaslessAddress(r.recipient, code) !== r.recipient || r.recipient === GASLESS_ZERO_ADDRESS)
        gaslessFailure(code, "gasless_recipient");
    const g = gaslessUint(r.grossAtomic, true, code), n = gaslessUint(r.minReceivedAtomic, true, code);
    gaslessUint(r.maxFeeAtomic, false, code);
    if (n > g)
        gaslessFailure(code, "gasless_minimum_above_gross");
    return r;
}
//# sourceMappingURL=validation.js.map