import { getAddress } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
export const BRIDGE_MAX_CALLDATA_BYTES = 12 * 1024;
export const BRIDGE_MAX_SIGNED_BYTES = 16 * 1024;
export const BRIDGE_MAX_GAS = 5000000n;
export const BRIDGE_TTL_MS = 300_000;
export const BRIDGE_MIN_REMAINING_MS = 15_000;
export const BRIDGE_CHAINS = [1, 8453, 42161];
export const BRIDGE_USDC = {
    1: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
    8453: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    42161: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
};
export const BRIDGE_DIAMOND = getAddress("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE");
export const BRIDGE_ZERO_ADDRESS = `0x${"0".repeat(40)}`;
export const BRIDGE_ZERO_WORD = `0x${"0".repeat(64)}`;
const MAX_UINT = (1n << 256n) - 1n;
export function bridgeFailure(code, reason) {
    throw new ApnError(code, `Bridge validation failed: ${reason}.`);
}
export function bridgeRecord(value, code = "APN_PROVIDER_PROTOCOL") {
    if (!isPlainRecord(value))
        bridgeFailure(code, "object_required");
    return value;
}
export function bridgeExact(value, keys, code = "APN_STATE_CORRUPT") {
    const result = bridgeRecord(value, code);
    if (!exactKeys(result, keys))
        bridgeFailure(code, "record_fields");
    return result;
}
export function bridgeUint(value, positive = false, code = "APN_PROVIDER_PROTOCOL") {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(value))
        bridgeFailure(code, "atomic_integer");
    const result = BigInt(value);
    if (result > MAX_UINT || (positive && result === 0n))
        bridgeFailure(code, "integer_bound");
    return result;
}
export function bridgeDecimal(value, positive = false) {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,71})(?:\.[0-9]{1,6})?$/u.test(value))
        bridgeFailure("APN_INVALID_INPUT", "six_decimal_USDC_amount");
    const [whole, fraction = ""] = value.split(".");
    const result = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
    bridgeUint(result.toString(), positive, "APN_INVALID_INPUT");
    return result.toString();
}
export function bridgeAddress(value, code = "APN_PROVIDER_PROTOCOL") {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        bridgeFailure(code, "address_shape");
    try {
        return getAddress(value);
    }
    catch {
        return bridgeFailure(code, "address_checksum");
    }
}
export function bridgeHex(value, maxBytes = BRIDGE_MAX_CALLDATA_BYTES, exactBytes, code = "APN_PROVIDER_PROTOCOL") {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) || value.length > 2 + maxBytes * 2 ||
        (exactBytes !== undefined && value.length !== 2 + exactBytes * 2))
        bridgeFailure(code, "bounded_hex");
    return value.toLowerCase();
}
export function bridgeHash(value, code = "APN_STATE_CORRUPT") {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
        bridgeFailure(code, "hash_identity");
    return value;
}
export function bridgeChain(value, code = "APN_PROVIDER_PROTOCOL") {
    if (value !== 1 && value !== 8453 && value !== 42161)
        bridgeFailure(code, "chain_identity");
    return value;
}
export function bridgeCaip2(value) {
    if (typeof value !== "string" || !/^eip155:(?:1|8453|42161)$/u.test(value))
        bridgeFailure("APN_INVALID_INPUT", "bridge_chain_CAIP2");
    return bridgeChain(Number(value.slice(7)), "APN_INVALID_INPUT");
}
export function bridgeOpaque(value, code = "APN_PROVIDER_PROTOCOL") {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u.test(value))
        bridgeFailure(code, "bounded_identifier");
    return value;
}
export function bridgeIso(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        bridgeFailure("APN_STATE_CORRUPT", "timestamp");
    return value;
}
export function bridgeJson(value, maxBytes) {
    if (Buffer.byteLength(value, "utf8") > maxBytes)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "response_size");
    try {
        return JSON.parse(value);
    }
    catch {
        return bridgeFailure("APN_PROVIDER_PROTOCOL", "JSON_shape");
    }
}
export function validateBridgeRequest(value, code = "APN_INVALID_INPUT") {
    const r = bridgeExact(value, ["fromChainId", "toChainId", "fromToken", "toToken", "amountAtomic", "recipient", "minOutputAtomic", "maxNativeDebitWei", "maxRouteFeeAtomic", "slippageBps"], code);
    const from = bridgeChain(r.fromChainId, code), to = bridgeChain(r.toChainId, code);
    if (from === to || bridgeAddress(r.fromToken, code) !== BRIDGE_USDC[from] || bridgeAddress(r.toToken, code) !== BRIDGE_USDC[to])
        bridgeFailure(code, "canonical_USDC_pair");
    if (r.fromToken !== BRIDGE_USDC[from] || r.toToken !== BRIDGE_USDC[to] || bridgeAddress(r.recipient, code) !== r.recipient || r.recipient === BRIDGE_ZERO_ADDRESS)
        bridgeFailure(code, "canonical_addresses");
    const amount = bridgeUint(r.amountAtomic, true, code), minimum = bridgeUint(r.minOutputAtomic, true, code);
    bridgeUint(r.maxNativeDebitWei, true, code);
    bridgeUint(r.maxRouteFeeAtomic, false, code);
    if (minimum > amount || typeof r.slippageBps !== "number" || !Number.isInteger(r.slippageBps) || r.slippageBps < 0 || r.slippageBps > 1000)
        bridgeFailure(code, "output_or_slippage");
    return r;
}
export function bridgeSame(left, right) { return canonicalJson(left) === canonicalJson(right); }
//# sourceMappingURL=validation.js.map