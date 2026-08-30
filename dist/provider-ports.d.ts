import type { Address, Hex } from "./model.js";
import type { ProviderCapabilitySnapshot, ProviderProfileRecord } from "./provider-profile.js";
export interface ForegroundAuthenticationPort {
    readIdentity(): Promise<string>;
    readChallengeResponse(): Promise<string>;
    confirmRebind(input: {
        readonly profile: string;
        readonly revision: number;
        readonly current_address: Address;
        readonly observed_address: Address;
        readonly current_capability_hash: string;
        readonly observed_capability_hash: string;
        readonly current_trust_class: ProviderProfileRecord["trust_class"];
        readonly observed_trust_class: ProviderProfileRecord["trust_class"];
    }): Promise<boolean>;
}
export interface ProviderLifecyclePort {
    connect(foreground: ForegroundAuthenticationPort): Promise<void>;
    probeStatus(): Promise<void>;
    logout(): Promise<void>;
}
export interface ProviderBalanceObservation {
    readonly address: Address;
    readonly account_binding_hash: string;
    readonly chain: "base";
    readonly asset: "USDC";
    readonly raw: string;
    readonly formatted: string;
    readonly decimals: 6;
    readonly observed_at: string;
}
export interface ProviderWalletReadPort {
    observeBalance(): Promise<ProviderBalanceObservation>;
    crossCheckAddress(expected: Address): Promise<void>;
}
export interface DirectExecutionPort {
    readonly mode: "local_raw_transaction_apn_submit" | "provider_atomic_send";
    assertCompatibleIntent?(input: {
        readonly amountAtomic: string;
        readonly amountDecimal: string;
        readonly recipient: Address;
    }): void;
    execute?(input: {
        readonly amountDecimal: string;
        readonly recipient: Address;
    }): Promise<{
        readonly disposition: "acknowledged";
        readonly transactionHash: Hex;
    } | {
        readonly disposition: "not_started";
        readonly reason: "provider_child_not_created" | "provider_binary_unavailable";
    } | {
        readonly disposition: "ambiguous";
        readonly reason: string;
    }>;
}
export interface X402ExecutionPort {
    readonly mode: "local_detached_eip3009_apn_paid_retry" | "provider_atomic_paid_fetch";
}
export interface EvidencePort {
    readonly owner: "apn" | "provider";
}
export interface ProviderProfileRepositoryPort {
    load(profileHash: string): Promise<ProviderProfileRecord | null>;
    save(profile: ProviderProfileRecord): Promise<void>;
}
export interface OperationRepositoryPort {
    readonly kind: "operation_repository";
}
export interface ReceiptRepositoryPort {
    readonly kind: "receipt_repository";
}
export interface ProviderAdapterBundle {
    readonly provider_id: string;
    readonly trust_class: ProviderProfileRecord["trust_class"];
    readonly capabilities: ProviderCapabilitySnapshot;
    readonly lifecycle: ProviderLifecyclePort;
    readonly reads: ProviderWalletReadPort;
    readonly direct?: DirectExecutionPort;
    readonly x402?: X402ExecutionPort;
    readonly evidence?: EvidencePort;
}
export interface ProviderRegistryPort {
    resolve(providerId: string): ProviderAdapterBundle;
}
