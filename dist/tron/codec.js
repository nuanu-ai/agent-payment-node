import { utils } from "tronweb";
import { isPlainRecord } from "../canonical.js";
import { atomic } from "../chain-policy.js";
import { ApnError } from "../errors.js";
export { TRON_GENESIS, TRON_USDT, TRON_USDT_HEX, TRON_TRANSFER_TOPIC } from "./constants.js";
export function tronAddress(value) {
    try {
        let bytes;
        if (/^41[a-fA-F0-9]{40}$/u.test(value))
            bytes = [...Buffer.from(value, "hex")];
        else if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/u.test(value))
            bytes = utils.crypto.decodeBase58Address(value);
        else
            invalidAddress();
        if (!bytes || bytes.length !== 21 || bytes[0] !== 0x41)
            invalidAddress();
        const address = utils.crypto.getBase58CheckAddress(bytes);
        if (value.startsWith("T") && address !== value)
            invalidAddress();
        if (utils.address.toHex(address).toLowerCase() !== Buffer.from(bytes).toString("hex"))
            invalidAddress();
        return address;
    }
    catch {
        return invalidAddress();
    }
}
export function tronHex(value) { return utils.address.toHex(tronAddress(value)).toLowerCase(); }
export function tronWord(value) { return tronHex(value).slice(2).padStart(64, "0"); }
export function tronTransferData(recipient, amount) {
    return `a9059cbb${tronWord(recipient)}${atomic(amount, true).toString(16).padStart(64, "0")}`;
}
export function tronRecord(value) {
    if (!isPlainRecord(value))
        tronProtocolFailure();
    return value;
}
export function tronArray(value, maximum = 64) {
    if (!Array.isArray(value) || value.length > maximum)
        tronProtocolFailure();
    return value;
}
export function tronAtomic(value, omittedZero = false) {
    if (value === undefined && omittedZero)
        return 0n;
    if (typeof value === "number" && !Number.isSafeInteger(value))
        tronProtocolFailure();
    if (typeof value !== "number" && typeof value !== "bigint" && typeof value !== "string")
        tronProtocolFailure();
    try {
        return atomic(String(value));
    }
    catch {
        return tronProtocolFailure();
    }
}
export function tronSafeNumber(value) {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
        throw new ApnError("APN_INVALID_INPUT", "The TRON protobuf builder requires an exact safe integer.");
    return Number(value);
}
export function tronHash(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
        tronProtocolFailure();
    return value;
}
export function tronProtocolFailure() { throw new ApnError("APN_RPC_PROTOCOL", "TRON evidence has an invalid shape or semantic binding."); }
export function tronReprepare() { throw new ApnError("APN_REPREPARE_REQUIRED", "The frozen TRON transaction, resource window or funding is no longer valid."); }
function invalidAddress() { throw new ApnError("APN_INVALID_INPUT", "Use a canonical TRON base58check address or 42-digit hex address beginning with 41."); }
//# sourceMappingURL=codec.js.map