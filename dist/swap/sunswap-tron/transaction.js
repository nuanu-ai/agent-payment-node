import { utils } from "tronweb";
import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress, tronHash, tronHex } from "../../tron/codec.js";
import { decodeSunSwapCalldata } from "./calldata.js";
import { SUNSWAP_V2_ROUTER } from "./catalog.js";
export function buildSunSwapUnsignedTransaction(input) {
    if (!isPlainRecord(input) || !exactKeys(input, ["owner", "recipient", "inputAmountAtomic", "minimumOutputAtomic", "deadlineSeconds",
        "maximumEnergy", "energyPriceSun", "maximumFeeLimitSun", "calldata", "callValueAtomic", "referenceBlockId", "timestampMs",
        "expirationMs", "feeLimitSun"]))
        invalid();
    validateEnergyBounds(input);
    tronHash(input.referenceBlockId);
    decodeSunSwapCalldata(input.calldata, input.callValueAtomic, { owner: input.owner, recipient: input.recipient,
        inputAmountAtomic: input.inputAmountAtomic, minimumOutputAtomic: input.minimumOutputAtomic, deadlineSeconds: input.deadlineSeconds });
    const timestamp = safe(input.timestampMs), expiration = safe(input.expirationMs), feeLimit = safe(input.feeLimitSun), callValue = safe(input.callValueAtomic);
    const deadlineMs = positive(input.deadlineSeconds) * 1000n;
    if (expiration <= timestamp || expiration - timestamp > 600_000 || deadlineMs < BigInt(timestamp) || deadlineMs > BigInt(expiration))
        invalid();
    const raw_data = {
        contract: [{ type: "TriggerSmartContract", parameter: { type_url: "type.googleapis.com/protocol.TriggerSmartContract",
                    value: { owner_address: tronHex(input.owner), contract_address: tronHex(SUNSWAP_V2_ROUTER), data: input.calldata.slice(2), call_value: callValue } } }],
        ref_block_bytes: input.referenceBlockId.slice(12, 16), ref_block_hash: input.referenceBlockId.slice(16, 32), timestamp, expiration, fee_limit: feeLimit,
    };
    try {
        const pb = utils.transaction.txJsonToPb({ visible: false, raw_data });
        const raw_data_hex = utils.transaction.txPbToRawDataHex(pb).toLowerCase();
        const txID = sha256(Buffer.from(raw_data_hex, "hex"));
        if (utils.transaction.txPbToTxID(pb).replace(/^0x/u, "").toLowerCase() !== txID)
            invalid();
        return { visible: false, txID, raw_data_hex, raw_data };
    }
    catch {
        return invalid();
    }
}
export function validateSunSwapUnsignedTransaction(value, intent) {
    const expected = buildSunSwapUnsignedTransaction(intent);
    if (!sameShape(value, expected) || canonicalJson(value) !== canonicalJson(expected)) {
        throw new ApnError("APN_WALLET_MISMATCH", "Unsigned SunSwap TriggerSmartContract drifted from the frozen intent.");
    }
    return expected;
}
export function validateEnergyBounds(input) {
    const energy = positive(input.maximumEnergy), price = positive(input.energyPriceSun), maximum = positive(input.maximumFeeLimitSun), fee = positive(input.feeLimitSun);
    if (fee > maximum || energy * price > fee)
        throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "SunSwap energy or fee_limit exceeds the frozen budget.");
}
export function sunSwapUnsignedPayloadHash(transaction) { return sha256(canonicalJson(transaction)); }
/**
 * Bandwidth java-tron charges for the signed transaction: the serialized Transaction (raw_data field and one
 * 65-byte signature field) plus the 64-byte MAX_RESULT_SIZE_IN_TX reserved for contract transactions.
 */
export function sunSwapMaximumBandwidthBytes(transaction) {
    const raw = BigInt(transaction.raw_data_hex.length / 2);
    let lengthBytes = 1n;
    for (let value = raw >> 7n; value > 0n; value >>= 7n)
        lengthBytes++;
    return 1n + lengthBytes + raw + 1n + 1n + 65n + 64n;
}
function positive(value) { if (!/^[1-9][0-9]{0,77}$/u.test(value))
    invalid(); return BigInt(value); }
function safe(value) { const number = positive(value); if (number > BigInt(Number.MAX_SAFE_INTEGER))
    invalid(); return Number(number); }
function invalid() { throw new ApnError("APN_INVALID_INPUT", "SunSwap unsigned transaction or resource bounds are invalid."); }
function sameShape(value, expected) {
    if (Array.isArray(expected)) {
        if (!Array.isArray(value) || value.length !== expected.length)
            return false;
        for (let index = 0; index < expected.length; index++)
            if (!Object.hasOwn(value, index) || !sameShape(value[index], expected[index]))
                return false;
        return true;
    }
    if (expected !== null && typeof expected === "object") {
        if (!isPlainRecord(value))
            return false;
        const keys = Object.keys(expected);
        if (!exactKeys(value, keys))
            return false;
        return keys.every((key) => sameShape(value[key], expected[key]));
    }
    return typeof value === typeof expected;
}
//# sourceMappingURL=transaction.js.map