/**
 * An HTTP 429 is the provider's rate limit, whatever transport first reported it as a protocol failure. The direct
 * transfer commands surface it as such, so a caller pauses and reruns the same idempotent command instead of
 * treating a busy public RPC as a broken one. Internal handling of the original error is unchanged.
 */
export declare function asRateLimited(error: unknown): unknown;
export declare function reportingRateLimits<T>(work: () => Promise<T>): Promise<T>;
