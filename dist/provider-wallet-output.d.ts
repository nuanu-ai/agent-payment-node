import type { BalanceSnapshot } from "./ports.js";
import type { ProviderPermissionBinding } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
export declare function permissionBalance(profile: string, bound: ProviderProfileRecord, permission: ProviderPermissionBinding, owner: BalanceSnapshot, session: BalanceSnapshot): unknown;
export declare function publicProfile(profile: ProviderProfileRecord, reused: boolean): unknown;
