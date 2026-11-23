import { ApnError } from "./errors.js";
import type { PendingSmartAccountPermissionRecord } from "./metamask-smart-account-record.js";

/** The owner's ceiling: a Smart Account permission expires at most 24 hours after the connect that asks for it. */
export const SMART_ACCOUNT_PERMISSION_MAX_LIFETIME_SECONDS = 86_400;

/**
 * A new connect intent: the expiry is Unix seconds no later than 24 hours after now. A value in milliseconds is
 * refused here too, because it lands far past that limit. Nothing is saved and MetaMask is not asked.
 */
export function assertNewPermissionLifetime(expiresAtUnix: number, nowUnix: number): void {
  const latest = nowUnix + SMART_ACCOUNT_PERMISSION_MAX_LIFETIME_SECONDS;
  if (expiresAtUnix <= latest) return;
  throw new ApnError("APN_INVALID_INPUT",
    `Permission expiry must be Unix seconds at most 24 hours from now: no later than ${latest} (${new Date(latest * 1000).toISOString()}).`,
    { reason: "permission_expiry_beyond_cap", latest_expires_at_unix: String(latest) });
}

/**
 * A pending intent saved by APN 0.5.110 or earlier may ask for a longer permission. APN does not ask MetaMask for it;
 * the next actions cancel it locally so a new connect within 24 hours can start.
 */
export function assertPendingPermissionLifetime(profile: string, record: PendingSmartAccountPermissionRecord): void {
  if (record.requested_expires_at_unix - record.starts_at_unix <= SMART_ACCOUNT_PERMISSION_MAX_LIFETIME_SECONDS) return;
  throw new ApnError("APN_INVALID_INPUT",
    "This pending permission intent asks for more than 24 hours, and APN no longer requests such a permission.", {
      reason: "permission_expiry_beyond_cap",
      nextActions: [
        `In MetaMask, check whether a permission for session ${record.session_address} was granted, and revoke it there if it is not wanted.`,
        `Then cancel only the local pending intent with apn wallet permission forget --profile ${profile} --expected-revision ${record.revision}.`,
        "Start a new wallet connect with an expiry at most 24 hours from now and a new idempotency key.",
      ],
    });
}
