/**
 * One idempotency-key alphabet for every money family: a letter or digit, then letters, digits, ".", "_", ":" or "-".
 * Each command declares exactly one maximum length in its catalog. Help, the MCP schema, the CLI/MCP parser and the
 * family's own prepare read that same bound, so a key the parser admits is never refused later for its length.
 */
export declare const IDEMPOTENCY_KEY_128 = "8_to_128_safe_ascii_characters";
export declare const IDEMPOTENCY_KEY_200 = "8_to_200_safe_ascii_characters";
export type IdempotencyKeyMaximum = 128 | 200;
export declare function idempotencyKeyPattern(maximum: IdempotencyKeyMaximum): string;
export declare function isIdempotencyKey(value: unknown, maximum: IdempotencyKeyMaximum): value is string;
export declare function declaredIdempotencyKeyMaximum(constraints: readonly string[]): IdempotencyKeyMaximum;
