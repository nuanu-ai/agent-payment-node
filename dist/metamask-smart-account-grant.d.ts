import { ApnError } from "./errors.js";
import type { Address, Hex } from "./model.js";
export interface SmartAccountPermissionRequestShape {
    readonly sessionAddress: Address;
    readonly capAtomic: string;
    readonly startsAtUnix: number;
    readonly expiresAtUnix: number;
    readonly nowUnix: number;
}
export interface SmartAccountProviderObservation {
    readonly owner_address: Address;
    readonly chain_id: Hex;
    readonly account_code: Hex;
    readonly supported_permissions: unknown;
    readonly permission_responses: readonly unknown[];
}
export interface ValidatedSmartAccountGrant {
    readonly ownerAddress: Address;
    readonly grantedCapAtomic: string;
    readonly grantedExpiresAtUnix: number;
    readonly context: Hex;
    readonly grantFingerprint: string;
    readonly delegationManager: Address;
    readonly permissionResponse: Readonly<Record<string, unknown>>;
}
export declare const BASE_CHAIN_HEX: "0x2105";
/**
 * The account is MetaMask's own but its official Base Smart Account is not enabled yet: a setup step the owner takes, not an
 * unsupported path, so the next step is to enable it and retry the same intent, never another custody (QA 0.5.70).
 */
export declare function smartAccountInactive(): ApnError;
export declare function smartAccountEnvironment(): import("@metamask/smart-accounts-kit").SmartAccountsEnvironment;
export declare function validateSmartAccountObservation(value: unknown, request: SmartAccountPermissionRequestShape): ValidatedSmartAccountGrant;
export declare function assertSmartAccountPreflight(value: unknown): SmartAccountProviderObservation;
