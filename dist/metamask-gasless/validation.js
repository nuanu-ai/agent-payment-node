import { getAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { MM_CHAINS, MM_MAX_UINT, MM_ZERO_ADDRESS } from "./model.js";
import { mmFail } from "./reasons.js";
export function mmExact(value, keys, reason = "mm_gasless_state_corrupt") {
    if (!isPlainRecord(value) || !exactKeys(value, keys))
        mmFail(reason);
    return value;
}
export function mmUint(value, positive = false, reason = "mm_gasless_input") {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value))
        mmFail(reason);
    const parsed = BigInt(value);
    if (parsed > MM_MAX_UINT || (positive && parsed === 0n))
        mmFail(reason);
    return parsed;
}
export function mmDecimal(value, positive = false) {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,71})(?:\.[0-9]{1,6})?$/u.test(value))
        mmFail("mm_gasless_input");
    const [whole, fraction = ""] = value.split(".");
    const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
    return mmUint(result.toString(), positive).toString();
}
export function mmFormat(value) {
    const n = mmUint(value), fraction = (n % 1000000n).toString().padStart(6, "0").replace(/0+$/u, "");
    return `${n / 1000000n}${fraction ? `.${fraction}` : ""}`;
}
export function mmAddress(value, reason = "mm_gasless_input") {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        mmFail(reason);
    try {
        return getAddress(value).toLowerCase();
    }
    catch {
        return mmFail(reason);
    }
}
export function mmCanonicalAddress(value, reason = "mm_gasless_state_corrupt") {
    const result = mmAddress(value, reason);
    if (result !== value)
        mmFail(reason);
    return result;
}
export function mmHex(value, bytes, reason = "mm_gasless_state_corrupt", maximum = 16_384) {
    if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(value) || value.length > 2 + maximum * 2 ||
        (bytes !== undefined && value.length !== 2 + bytes * 2))
        mmFail(reason);
    return value;
}
export function mmHash(value, reason = "mm_gasless_state_corrupt") {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
        mmFail(reason);
    return value;
}
export function mmIso(value, reason = "mm_gasless_state_corrupt") {
    if (typeof value !== "string")
        mmFail(reason);
    const n = Date.parse(value);
    if (!Number.isSafeInteger(n) || n <= 0 || new Date(n).toISOString() !== value)
        mmFail(reason);
    return value;
}
export function mmUuid(value, reason = "mm_gasless_state_corrupt") {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value))
        mmFail(reason);
    return value;
}
export function mmChain(value) {
    if (!MM_CHAINS.includes(value))
        mmFail("mm_gasless_unsupported_chain");
    return value;
}
export function mmSame(a, b) { return canonicalJson(a) === canonicalJson(b); }
export function mmRequest(value, reason = "mm_gasless_input") {
    const r = mmExact(value, ["chainId", "recipient", "grossAtomic", "maxFeeAtomic", "minReceivedAtomic"], reason);
    mmChain(r.chainId);
    if (mmCanonicalAddress(r.recipient, reason) === MM_ZERO_ADDRESS)
        mmFail(reason);
    const gross = mmUint(r.grossAtomic, true, reason), minimum = mmUint(r.minReceivedAtomic, true, reason);
    mmUint(r.maxFeeAtomic, false, reason);
    if (minimum > gross)
        mmFail(reason);
    return r;
}
//# sourceMappingURL=validation.js.map