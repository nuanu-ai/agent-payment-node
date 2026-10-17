import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
/** Steps 1 and 2: exact stored keys and the stored seal recomputed over the stored body. Returns the record unchanged. */
export function sealedStoredRecord(value, spec, fail) {
    if (!isPlainRecord(value) || !exactKeys(value, [...spec.keys, ...(spec.optionalKeys ?? []).filter((key) => Object.hasOwn(value, key))]) ||
        !spec.keys.includes(spec.sealField))
        return fail("stored_record_shape");
    const { [spec.sealField]: seal, ...body } = value;
    if (typeof seal !== "string" || spec.seal(body) !== seal)
        return fail("stored_record_seal");
    return value;
}
/**
 * Every expected field must equal the stored one. Pass the operation's own record (its custody, account, recipient)
 * or a protocol table row, never an owner constant. EVM addresses compare case-insensitively, because some records
 * store the lowercase form and others the checksum form of the same address; everything else compares canonically.
 */
export function assertStoredFieldsEqual(stored, expected, fail) {
    if (!isPlainRecord(stored))
        fail("stored_record_shape");
    for (const [key, value] of Object.entries(expected)) {
        if (!Object.hasOwn(stored, key) || !sameStoredValue(stored[key], value)) {
            fail("stored_record_binding");
        }
    }
}
/**
 * Step 3: the protocol row a stored record names. Current rows serve new prepares and old records alike; a frozen
 * legacy row (an owner-named reference, a retired route) serves only records that already name it. Null when unknown.
 */
export function protocolRow(key, current, legacy = {}) {
    if (Object.hasOwn(current, key))
        return { row: current[key], legacy: false };
    if (Object.hasOwn(legacy, key))
        return { row: legacy[key], legacy: true };
    return null;
}
function sameStoredValue(left, right) {
    const evm = /^0x[0-9a-fA-F]{40}$/u;
    if (typeof left === "string" && typeof right === "string" && evm.test(left) && evm.test(right))
        return left.toLowerCase() === right.toLowerCase();
    return canonicalJson(left) === canonicalJson(right);
}
//# sourceMappingURL=stored-record-binding.js.map