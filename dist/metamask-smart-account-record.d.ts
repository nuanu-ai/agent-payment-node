import type { Address, Hex } from "./model.js";
import type { ProviderPermissionBinding, ProviderPermissionState, ProviderRevocationFreshness } from "./provider-ports.js";
export declare const SMART_ACCOUNT_PERMISSION_RECORD_VERSION: "apn.metamask-smart-account-permission.v1";
export declare const METAMASK_SMART_ACCOUNT_PROVIDER_ID: "metamask-smart-account";
interface PermissionRecordBase {
    readonly schema_version: typeof SMART_ACCOUNT_PERMISSION_RECORD_VERSION;
    readonly profile: string;
    readonly profile_hash: string;
    readonly provider_id: typeof METAMASK_SMART_ACCOUNT_PROVIDER_ID;
    readonly idempotency_hash: string;
    readonly intent_fingerprint: string;
    readonly phase: ProviderPermissionState;
    readonly revision: number;
    readonly requested_cap_atomic: string;
    readonly requested_expires_at_unix: number;
    readonly starts_at_unix: number;
    readonly session_address: Address;
    readonly session_private_key: Hex;
    readonly created_at: string;
    readonly updated_at: string;
    readonly max_observed_unix: number;
    readonly revocation_freshness: ProviderRevocationFreshness;
    readonly last_foreground_sync_at?: string;
}
export interface PendingSmartAccountPermissionRecord extends PermissionRecordBase {
    readonly phase: "pending_consent";
}
export interface GrantedSmartAccountPermissionRecord extends PermissionRecordBase {
    readonly phase: "grant_committed_pending_profile" | "active" | "disabled" | "expired" | "revoked" | "drift_blocked";
    readonly owner_address: Address;
    readonly granted_cap_atomic: string;
    readonly granted_expires_at_unix: number;
    readonly grant_context: Hex;
    readonly grant_fingerprint: string;
    readonly delegation_manager: Address;
    readonly permission_response: Readonly<Record<string, unknown>>;
}
export type SmartAccountPermissionRecord = PendingSmartAccountPermissionRecord | GrantedSmartAccountPermissionRecord;
export declare function validateSmartAccountPermissionRecord(value: unknown): SmartAccountPermissionRecord;
export declare function isGrantedPermissionRecord(record: SmartAccountPermissionRecord): record is GrantedSmartAccountPermissionRecord;
export declare function projectPermissionBinding(record: GrantedSmartAccountPermissionRecord, nowUnix: number): ProviderPermissionBinding;
export {};
