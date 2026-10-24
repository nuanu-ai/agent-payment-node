import type { ProviderAdapterBundle, ProviderPendingPermissionBinding, ProviderPermissionBinding } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
/**
 * What a pending consent intent allows next. While it is live: the exact retry, or cancelling it after a MetaMask review.
 * Once expired the exact connect is refused before consent, so only the review, the local cancel and a new intent remain
 * (QA 0.5.72). Forget removes only the local intent; MetaMask-side authority is reviewed and revoked there.
 */
export declare function pendingPermissionNextActions(profile: string, permission: ProviderPendingPermissionBinding, nowUnix: number): readonly string[];
export declare function publicPendingPermissionProfile(profile: string, adapter: ProviderAdapterBundle, permission: ProviderPendingPermissionBinding, nowUnix: number): unknown;
export declare function publicPermissionProfile(profile: ProviderProfileRecord, permission: ProviderPermissionBinding, reused: boolean): unknown;
