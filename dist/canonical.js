import { createHash } from "node:crypto";
import { ApnError } from "./errors.js";
export function canonicalJson(value) {
    return JSON.stringify(toCanonical(value));
}
function toCanonical(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number" && Number.isSafeInteger(value))
        return value;
    if (Array.isArray(value))
        return value.map(toCanonical);
    if (typeof value === "object") {
        const output = {};
        for (const key of Object.keys(value).sort()) {
            const item = value[key];
            if (item === undefined)
                continue;
            output[key] = toCanonical(item);
        }
        return output;
    }
    throw new ApnError("APN_INVALID_INPUT", "Canonical data contains an unsupported value.");
}
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
export function domainHash(domain, value) {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    return createHash("sha256").update(domain, "utf8").update(Buffer.from([0])).update(bytes).digest("hex");
}
export function hashObject(value) {
    return sha256(canonicalJson(value));
}
export function isPlainRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
export function exactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}
//# sourceMappingURL=canonical.js.map