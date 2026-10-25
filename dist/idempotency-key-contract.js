import { ApnError } from "./errors.js";
/**
 * One idempotency-key alphabet for every money family: a letter or digit, then letters, digits, ".", "_", ":" or "-".
 * Each command declares exactly one maximum length in its catalog. Help, the MCP schema, the CLI/MCP parser and the
 * family's own prepare read that same bound, so a key the parser admits is never refused later for its length.
 */
export const IDEMPOTENCY_KEY_128 = "8_to_128_safe_ascii_characters";
export const IDEMPOTENCY_KEY_200 = "8_to_200_safe_ascii_characters";
const MAXIMUM_BY_CONSTRAINT = new Map([[IDEMPOTENCY_KEY_128, 128], [IDEMPOTENCY_KEY_200, 200]]);
const PATTERN = Object.freeze({
    128: new RegExp(idempotencyKeyPattern(128), "u"),
    200: new RegExp(idempotencyKeyPattern(200), "u"),
});
export function idempotencyKeyPattern(maximum) {
    return `^[A-Za-z0-9][A-Za-z0-9._:-]{7,${maximum - 1}}$`;
}
export function isIdempotencyKey(value, maximum) {
    return typeof value === "string" && PATTERN[maximum].test(value);
}
export function declaredIdempotencyKeyMaximum(constraints) {
    const lengths = constraints.filter((constraint) => /^8_to_\d+_safe_ascii_characters$/u.test(constraint));
    const maximum = lengths.length === 1 ? MAXIMUM_BY_CONSTRAINT.get(lengths[0]) : undefined;
    if (maximum === undefined)
        throw new ApnError("APN_INTERNAL", "An idempotency key option must declare exactly one known maximum length.");
    return maximum;
}
//# sourceMappingURL=idempotency-key-contract.js.map