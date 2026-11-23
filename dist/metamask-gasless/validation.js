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
/** Exact decimal text of token atoms at the token's own scale (6 for USDC rows, 18 for the chain 56 rows). */
export function mmFormat(value, decimals) {
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36)
        mmFail("mm_gasless_internal");
    const n = mmUint(value), scale = 10n ** BigInt(decimals);
    const fraction = (n % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
    return `${n / scale}${fraction ? `.${fraction}` : ""}`;
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
/**
 * The request's shape only. Its optional token is a canonical address; which chains need it is the registry's rule,
 * applied when a request is prepared (`mmRequestDeployment`), so a saved record never depends on today's rows.
 */
export function mmRequest(value, reason = "mm_gasless_input") {
    const fixed = isPlainRecord(value) && Object.hasOwn(value, "fixedNet"), token = isPlainRecord(value) && Object.hasOwn(value, "token");
    const r = mmExact(value, ["chainId", "recipient", "grossAtomic", "maxFeeAtomic", "minReceivedAtomic", ...(fixed ? ["fixedNet"] : []),
        ...(token ? ["token"] : [])], reason);
    mmChain(r.chainId);
    if (mmCanonicalAddress(r.recipient, reason) === MM_ZERO_ADDRESS)
        mmFail(reason);
    if (token && (mmCanonicalAddress(r.token, reason) === MM_ZERO_ADDRESS || r.token === r.recipient))
        mmFail(reason);
    const gross = mmUint(r.grossAtomic, true, reason), minimum = mmUint(r.minReceivedAtomic, true, reason);
    mmUint(r.maxFeeAtomic, false, reason);
    if (minimum > gross)
        mmFail(reason);
    if (fixed) {
        const f = mmExact(r.fixedNet, ["netAtomic", "maxGrossAtomic"], reason);
        const net = mmUint(f.netAtomic, true, reason);
        if (mmUint(f.maxGrossAtomic, true, reason) !== gross || net > gross || f.netAtomic !== r.minReceivedAtomic)
            mmFail(reason);
    }
    return r;
}
//# sourceMappingURL=validation.js.map