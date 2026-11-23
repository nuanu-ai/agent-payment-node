import type { Address } from "./model.js";
import type { PendingSmartAccountPermissionRecord } from "./metamask-smart-account-record.js";
/** The owner's ceiling: a Smart Account permission expires at most 24 hours after the connect that asks for it. */
export declare const SMART_ACCOUNT_PERMISSION_MAX_LIFETIME_SECONDS = 86400;
/**
 * A new connect intent: the expiry is Unix seconds no later than 24 hours after now. A value in milliseconds is
 * refused here too, because it lands far past that limit. Nothing is saved and MetaMask is not asked.
 */
export declare function assertNewPermissionLifetime(expiresAtUnix: number, nowUnix: number): void;
/** True for a pending intent, saved by APN 0.5.110 or earlier, whose window is longer than 24 hours. */
export declare function exceedsPermissionLifetime(startsAtUnix: number, expiresAtUnix: number): boolean;
/** What such an intent allows: a MetaMask review, the local cancel and a new connect within 24 hours. */
export declare function beyondCapPendingNextActions(profile: string, sessionAddress: Address, revision: number): readonly string[];
/** APN does not ask MetaMask for a pending intent longer than 24 hours; its next actions cancel it locally. */
export declare function assertPendingPermissionLifetime(profile: string, record: PendingSmartAccountPermissionRecord): void;
