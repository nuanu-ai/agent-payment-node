import { ApnError } from "./errors.js";
import type { Address } from "./model.js";
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
    { reason: "permission_expiry_beyond_cap", latest_expires_at_unix: String(latest),
      nextActions: ["Run the same wallet connect again with a --permission-expires-at in Unix seconds no later than latest_expires_at_unix."] });
}

/** True for a pending intent, saved by APN 0.5.110 or earlier, whose window is longer than 24 hours. */
export function exceedsPermissionLifetime(startsAtUnix: number, expiresAtUnix: number): boolean {
  return expiresAtUnix - startsAtUnix > SMART_ACCOUNT_PERMISSION_MAX_LIFETIME_SECONDS;
}

/** What such an intent allows: a MetaMask review, the local cancel and a new connect within 24 hours. */
export function beyondCapPendingNextActions(profile: string, sessionAddress: Address, revision: number): readonly string[] {
  return [
    `In MetaMask, check whether a permission for session ${sessionAddress} was granted, and revoke it there if it is not wanted.`,
    `Then cancel only the local pending intent with apn wallet permission forget --profile ${profile} --expected-revision ${revision}.`,
    "Start a new wallet connect with an expiry at most 24 hours from now and a new idempotency key.",
  ];
}

/** APN does not ask MetaMask for a pending intent longer than 24 hours; its next actions cancel it locally. */
export function assertPendingPermissionLifetime(profile: string, record: PendingSmartAccountPermissionRecord): void {
  if (!exceedsPermissionLifetime(record.starts_at_unix, record.requested_expires_at_unix)) return;
  throw new ApnError("APN_INVALID_INPUT",
    "This pending permission intent asks for more than 24 hours, and APN no longer requests such a permission.", {
      reason: "permission_expiry_beyond_cap",
      nextActions: beyondCapPendingNextActions(profile, record.session_address, record.revision),
    });
}
