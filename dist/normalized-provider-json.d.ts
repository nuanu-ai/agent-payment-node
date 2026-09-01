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
/** Canonicalize one bounded, provider-neutral seller JSON value. */
export declare function canonicalizeNormalizedProviderJson(value: unknown): string;
export declare function isSafeNormalizedProviderJson(value: unknown): value is NormalizedProviderJson;
export declare function isProtectedNormalizedProviderKey(value: string): boolean;
