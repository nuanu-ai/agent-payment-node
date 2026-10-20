import { ApnError } from "./errors.js";

/**
 * A read that failed after this command already sent a money effect. The command then answers with the operation's saved
 * state (its sent hashes, phase and next observation step) instead of a bare error, and names the failed read here:
 * the error code, its constant reason and an HTTP status, never a message, URL or provider payload. It records nothing
 * as succeeded or failed on chain; only a later observation decides the effect.
 */
export interface PostEffectReadFailure {
  readonly code: string | null;
  readonly reason: string | null;
  readonly httpStatus: number | null;
}

export function postEffectReadFailure(error: unknown): PostEffectReadFailure {
  const apn = error instanceof ApnError ? error : null, details = apn?.details;
  const reason = [details?.reason, details?.transportReason].find((value) => typeof value === "string" && /^[A-Za-z_]{3,64}$/u.test(value));
  const status = typeof details?.httpStatus === "number" ? details.httpStatus
    : typeof details?.httpStatus === "string" && /^[1-5][0-9]{2}$/u.test(details.httpStatus) ? Number(details.httpStatus) : null;
  return { code: apn !== null && /^APN_[A-Z0-9_]{1,60}$/u.test(apn.code) ? apn.code : null, reason: (reason as string | undefined) ?? null,
    httpStatus: status !== null && Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : null };
}
