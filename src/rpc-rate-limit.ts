import { ApnError } from "./errors.js";

/**
 * An HTTP 429 is the provider's rate limit, whatever transport first reported it as a protocol failure. The direct
 * transfer commands surface it as such, so a caller pauses and reruns the same idempotent command instead of
 * treating a busy public RPC as a broken one. Internal handling of the original error is unchanged.
 */
export function asRateLimited(error: unknown): unknown {
  if (!(error instanceof ApnError) || error.code !== "APN_RPC_PROTOCOL" || String(error.details?.httpStatus) !== "429") return error;
  return new ApnError("APN_RPC_RATE_LIMITED", "The RPC provider rate-limited this request.", error.details);
}

export async function reportingRateLimits<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { throw asRateLimited(error); }
}
