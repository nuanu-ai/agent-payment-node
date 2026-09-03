import { BASE_USDC, CHAIN_CAIP2, USDC_DECIMALS } from "./constants.js";
import type { Address, WalletRecord } from "./model.js";
export declare const PROVIDER_PROFILE_VERSION: "apn.provider-profile.v1";
export declare const PROVIDER_CAPABILITY_VERSION: "apn.provider-capability.v1";
export declare const LOCAL_PROVIDER_ID: "local";
export type ProviderTrustClass = "local_software_wallet" | "provider_managed_non_custodial_tee" | "provider_managed_non_custodial_signer" | "external_owner_delegated_local_session";
export type DirectExecutionMode = "local_raw_transaction_apn_submit" | "provider_atomic_send" | "delegated_session_transaction";
export type X402ExecutionMode = "local_detached_eip3009_apn_paid_retry" | "provider_detached_eip3009_apn_paid_retry" | "provider_atomic_paid_fetch" | "delegated_erc7710_apn_paid_retry";
export type ProviderProfileState = "bound" | "drift_blocked" | "rebind_pending";
export interface ProviderPermissionCapability {
    readonly available: true;
    readonly protocol: "erc7715";
    readonly consent: "foreground_browser";
    readonly owner_custody: "external_metamask";
    readonly session_custody: "encrypted_local_apn";
    readonly provider_revoke: "unavailable_unproved";
}
export interface ProviderCapabilitySnapshot {
    readonly schema_version: typeof PROVIDER_CAPABILITY_VERSION;
    readonly network: {
        readonly caip2: typeof CHAIN_CAIP2;
        readonly chain: "base";
    };
    readonly asset: {
        readonly symbol: "USDC";
        readonly contract: typeof BASE_USDC;
        readonly decimals: typeof USDC_DECIMALS;
    };
    readonly lifecycle: {
        readonly connect: boolean;
        readonly status: boolean;
        readonly logout: boolean;
    };
    readonly read: {
        readonly address: boolean;
        readonly balance: boolean;
        readonly funding_guidance: boolean;
    };
    readonly direct: {
        readonly available: boolean;
        readonly mode: DirectExecutionMode;
        readonly execution_owner: "apn" | "provider";
        readonly retry_owner: "apn_operation_state" | "apn_outer_no_replay_journal";
    };
    readonly x402: {
        readonly available: boolean;
        readonly mode: X402ExecutionMode;
        readonly execution_owner: "apn" | "provider";
        readonly retry_owner: "apn_state_machine" | "apn_outer_no_replay_journal";
    };
    readonly evidence: {
        readonly available: boolean;
        readonly owner: "apn" | "provider";
    };
    readonly permission?: ProviderPermissionCapability;
}
export interface ProviderDrift {
    readonly state: ProviderProfileState;
    readonly reason: "none" | "identity_changed" | "capability_changed" | "identity_and_capability_changed";
    readonly observed_address?: Address;
    readonly observed_account_binding_hash?: string;
    readonly observed_capability_hash?: string;
    readonly observed_at?: string;
}
export interface ProviderProfileRecord {
    readonly schema_version: typeof PROVIDER_PROFILE_VERSION;
    readonly profile: string;
    readonly profile_hash: string;
    readonly provider_id: string;
    readonly public_address: Address;
    readonly account_binding_hash: string;
    readonly trust_class: ProviderTrustClass;
    readonly revision: number;
    readonly capability_snapshot: ProviderCapabilitySnapshot;
    readonly capability_hash: string;
    readonly observed_at: string;
    readonly drift: ProviderDrift;
}
export interface ProviderBindingObservation {
    readonly address: Address;
    readonly accountBindingHash: string;
    readonly capabilityHash: string;
    readonly observedAt: string;
    readonly trustClass: ProviderTrustClass;
}
export declare function localCapabilitySnapshot(): ProviderCapabilitySnapshot;
export declare function lifecycleReadOnlyCapabilitySnapshot(): ProviderCapabilitySnapshot;
export declare function coinbaseDirectCapabilitySnapshot(): ProviderCapabilitySnapshot;
export declare function metamaskReadOnlyCapabilitySnapshot(): ProviderCapabilitySnapshot;
export declare function metamaskDirectCapabilitySnapshot(): ProviderCapabilitySnapshot;
export declare function metamaskSmartAccountLegacyCapabilitySnapshot(): ProviderCapabilitySnapshot;
export declare function metamaskSmartAccountCapabilitySnapshot(): ProviderCapabilitySnapshot;
export declare function capabilityHash(snapshot: ProviderCapabilitySnapshot): string;
export declare function accountBindingHash(providerId: string, address: Address): string;
export declare function markProviderProfileDrift(profile: ProviderProfileRecord, observed: ProviderBindingObservation): ProviderProfileRecord;
export declare function projectLegacyLocalProfile(wallet: WalletRecord): ProviderProfileRecord;
export declare function validateProviderProfile(value: unknown): ProviderProfileRecord;
