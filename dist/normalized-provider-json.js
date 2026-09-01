export const NORMALIZED_PROVIDER_JSON_LIMITS = Object.freeze({
    maxDepth: 16,
    maxNodes: 4096,
    maxArrayItems: 1024,
    maxObjectKeys: 256,
    maxStringBytes: 32_768,
    maxCanonicalBytes: 262_144,
});
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PROTECTED_KEY = /(?:authorization|cookie|credential|email|mnemonic|otp|passphrase|password|paymentheader|privatekey|rawtransaction|reusableauthorization|seedphrase|session|signature|signedtransaction|token|wrappingsecret)/iu;
const PROTECTED_TEXT = [
    /\bBearer\s+\S+/iu,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
    /(?:^|[;\s])(?:cookie|session|sid)\s*=\s*[^;\s]+/iu,
    /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/iu,
    /(?:^|\s)(?:otp|one[- ]time code)\s*[:=]?\s*[0-9]{6}(?:\s|$)/iu,
    /^(?:[0-9]{6})$/u,
    /(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\)[^\s]*/u,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /^(?=.{28,}$)(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])[A-Za-z0-9_-]+$/u,
];
/** Canonicalize one bounded, provider-neutral seller JSON value. */
export function canonicalizeNormalizedProviderJson(value) {
    const state = { nodes: 0, bytes: 0, output: [], path: new WeakSet() };
    appendValue(value, 0, state);
    return state.output.join("");
}
export function isSafeNormalizedProviderJson(value) {
    try {
        canonicalizeNormalizedProviderJson(value);
        return true;
    }
    catch {
        return false;
    }
}
function appendValue(value, depth, state) {
    if (depth > NORMALIZED_PROVIDER_JSON_LIMITS.maxDepth)
        invalid();
    state.nodes += 1;
    if (state.nodes > NORMALIZED_PROVIDER_JSON_LIMITS.maxNodes)
        invalid();
    if (value === null)
        return append("null", state);
    if (typeof value === "boolean")
        return append(value ? "true" : "false", state);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            invalid();
        return append(JSON.stringify(value), state);
    }
    if (typeof value === "string") {
        validateText(value);
        return append(JSON.stringify(value), state);
    }
    if (typeof value !== "object")
        invalid();
    if (state.path.has(value))
        invalid();
    state.path.add(value);
    try {
        if (Array.isArray(value))
            appendArray(value, depth, state);
        else
            appendObject(value, depth, state);
    }
    finally {
        state.path.delete(value);
    }
}
function appendArray(value, depth, state) {
    if (value.length > NORMALIZED_PROVIDER_JSON_LIMITS.maxArrayItems)
        invalid();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length"))
        invalid();
    append("[", state);
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
            invalid();
        if (index > 0)
            append(",", state);
        appendValue(descriptor.value, depth + 1, state);
    }
    append("]", state);
}
function appendObject(value, depth, state) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        invalid();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string"))
        invalid();
    const keys = ownKeys;
    if (keys.length > NORMALIZED_PROVIDER_JSON_LIMITS.maxObjectKeys)
        invalid();
    const entries = [];
    for (const key of keys) {
        if (isProtectedNormalizedProviderKey(key))
            invalid();
        validateText(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
            invalid();
        entries.push({ key, value: descriptor.value });
    }
    entries.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    append("{", state);
    entries.forEach((entry, index) => {
        if (index > 0)
            append(",", state);
        append(JSON.stringify(entry.key), state);
        append(":", state);
        appendValue(entry.value, depth + 1, state);
    });
    append("}", state);
}
function validateText(value) {
    if (Buffer.byteLength(value, "utf8") > NORMALIZED_PROVIDER_JSON_LIMITS.maxStringBytes)
        invalid();
    if (PROTECTED_TEXT.some((pattern) => pattern.test(value)))
        invalid();
}
function compactKey(value) {
    return value.replace(/[^a-z0-9]/giu, "");
}
export function isProtectedNormalizedProviderKey(value) {
    return DANGEROUS_KEYS.has(value) || PROTECTED_KEY.test(compactKey(value));
}
function append(value, state) {
    if (value === undefined)
        invalid();
    state.bytes += Buffer.byteLength(value, "utf8");
    if (state.bytes > NORMALIZED_PROVIDER_JSON_LIMITS.maxCanonicalBytes)
        invalid();
    state.output.push(value);
}
function invalid() {
    throw new TypeError("Invalid normalized provider JSON.");
}
//# sourceMappingURL=normalized-provider-json.js.map