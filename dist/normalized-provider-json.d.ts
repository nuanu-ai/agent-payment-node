export type NormalizedProviderJson = null | boolean | number | string | readonly NormalizedProviderJson[] | {
    readonly [key: string]: NormalizedProviderJson;
};
export declare const NORMALIZED_PROVIDER_JSON_LIMITS: Readonly<{
    maxDepth: 16;
    maxNodes: 4096;
    maxArrayItems: 1024;
    maxObjectKeys: 256;
    maxStringBytes: 32768;
    maxCanonicalBytes: 262144;
}>;
/** Canonicalize one bounded, provider-neutral JSON value; provider-authored text is screened for secrets. */
export declare function canonicalizeNormalizedProviderJson(value: unknown): string;
/**
 * Canonicalize the paid seller body: the same bounds and canonical form, values kept verbatim except
 * known secret-bearing fields, which are redacted. Text heuristics would discard results the owner paid for.
 */
export declare function canonicalizeSellerResultJson(value: unknown): string;
export declare function isSafeNormalizedProviderJson(value: unknown): value is NormalizedProviderJson;
export declare function isProtectedNormalizedProviderKey(value: string): boolean;
