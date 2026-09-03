import type { Address, Hex, ProviderDirectBinding } from "./model.js";
import type { ProviderCapabilitySnapshot, ProviderProfileRecord } from "./provider-profile.js";
import type { ProviderX402RejectionShape } from "./provider-x402-rejection-shape.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";

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

export interface ProviderConnectOptions {
  readonly authenticationMethod?: string;
}

export type ProviderPermissionState =
  | "pending_consent"
  | "grant_committed_pending_profile"
  | "active"
  | "disabled"
  | "expired"
  | "revoked"
  | "drift_blocked";

export type ProviderRevocationFreshness =
  | "never_synced"
  | "confirmed_present"
  | "confirmed_absent"
  | "unverified";

export interface ProviderPermissionConnectIntent {
  readonly profile: string;
  readonly profileHash: string;
  readonly authenticationMethod: "browser";
  readonly idempotencyKey: string;
  readonly capAtomic: string;
  readonly expiresAtUnix: number;
}

export interface ProviderPermissionBinding {
  readonly owner_address: Address;
  readonly session_address: Address;
  readonly state: ProviderPermissionState;
  readonly revision: number;
  readonly requested_cap_atomic: string;
  readonly granted_cap_atomic: string;
  readonly starts_at_unix: number;
  readonly expires_at_unix: number;
  readonly grant_fingerprint: string;
  readonly last_foreground_sync_at?: string;
  readonly revocation_freshness: ProviderRevocationFreshness;
  readonly observed_at: string;
}

export interface ProviderPermissionLifecyclePort {
  connect(intent: ProviderPermissionConnectIntent): Promise<ProviderPermissionBinding>;
  activate(profileHash: string): Promise<ProviderPermissionBinding>;
  read(profileHash: string): Promise<ProviderPermissionBinding | null>;
  sync(profileHash: string, expectedRevision: number): Promise<ProviderPermissionBinding>;
  disable(profileHash: string, expectedRevision: number): Promise<ProviderPermissionBinding>;
  forget(profileHash: string, expectedRevision: number): Promise<{ readonly warning: string }>;
}

export interface ProviderLifecyclePort {
  readonly authenticationMethods?: readonly string[];
  connect(foreground: ForegroundAuthenticationPort, options?: ProviderConnectOptions): Promise<void>;
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

export interface ProviderProfileMigrationPort {
  upgrade(profile: ProviderProfileRecord): Promise<ProviderProfileRecord>;
}

export interface ProviderDirectPrepareInput {
  readonly operationId: string;
  readonly profileHash: string;
  readonly profileRevision: number;
  readonly sender: Address;
  readonly recipient: Address;
  readonly amountAtomic: string;
  readonly amountDecimal: string;
  readonly rpcUrl: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
}

export interface ProviderDelegatedDirectPreparation {
  readonly permissionRevision: number;
  readonly rootGrantFingerprint: string;
  readonly sessionAddress: Address;
  readonly delegationManager: Address;
  readonly permissionExpiresAtUnix: number;
}

export interface ProviderDirectExecutionInput extends ProviderDirectPrepareInput {
  readonly requestHash: string;
  readonly fingerprint: string;
  readonly binding: ProviderDirectBinding;
}

export interface DirectExecutionPort {
  readonly mode: "local_raw_transaction_apn_submit" | "provider_atomic_send" | "delegated_session_transaction";
  prepare?(input: ProviderDirectPrepareInput): Promise<ProviderDelegatedDirectPreparation>;
  preflight?(input: ProviderDirectExecutionInput): Promise<void>;
  assertCompatibleIntent?(input: {
    readonly amountAtomic: string;
    readonly amountDecimal: string;
    readonly recipient: Address;
  }): void;
  execute?(input: ProviderDirectExecutionInput): Promise<
    | { readonly disposition: "acknowledged"; readonly transactionHash: Hex }
    | { readonly disposition: "pending"; readonly recoveryToken: string; readonly providerState: string }
    | { readonly disposition: "rejected"; readonly reason: "provider_denied" | "provider_expired" }
    | { readonly disposition: "not_started"; readonly reason: "provider_child_not_created" | "provider_binary_unavailable" }
    | { readonly disposition: "ambiguous"; readonly reason: string }
  >;
  observe?(input: {
    readonly recoveryToken: string;
    readonly sender: Address;
    readonly waitSeconds?: number;
  }): Promise<
    | { readonly disposition: "acknowledged"; readonly transactionHash: Hex }
    | { readonly disposition: "pending"; readonly recoveryToken: string; readonly providerState: string }
    | { readonly disposition: "rejected"; readonly reason: "provider_denied" | "provider_expired" }
    | { readonly disposition: "ambiguous"; readonly reason: string }
  >;
}

export interface X402ExecutionPort {
  readonly mode:
    | "local_detached_eip3009_apn_paid_retry"
    | "provider_detached_eip3009_apn_paid_retry"
    | "provider_atomic_paid_fetch";
  assertCompatibleIntent?(input: { readonly amountAtomic: string }): void;
  prime?(): Promise<void>;
  execute?(input: {
    readonly url: string;
    readonly amountAtomic: string;
    readonly correlationId: string;
    readonly requestDigest: string;
  }): Promise<
    | { readonly disposition: "not_started"; readonly reason: "provider_child_not_created" | "provider_binary_unavailable" }
    | { readonly disposition: "ambiguous"; readonly reason: string; readonly invocation?: ProviderX402Invocation }
    | { readonly disposition: "seller_result"; readonly invocation: ProviderX402Invocation; readonly result: ProviderX402SellerResult }
  >;
}

export interface X402DelegatedMaterialBinding {
  readonly schemaVersion: "apn.x402.delegated-material-binding.v1";
  readonly method: "erc7710";
  readonly providerId: string;
  readonly profileRevision: number;
  readonly capabilityHash: string;
  readonly accountBindingHash: string;
  readonly permissionRevision: number;
  readonly rootGrantFingerprint: string;
  readonly sessionAddress: Address;
  readonly delegationManager: Address;
  readonly facilitatorAddresses: readonly Address[];
  readonly effectiveExpiryUnix: string;
  readonly rpcOriginHash: string;
}

export interface X402MaterialPrepareInput {
  readonly profile: string;
  readonly profileHash: string;
  readonly profileRevision: number;
  readonly capabilityHash: string;
  readonly accountBindingHash: string;
  readonly wallet: Address;
  readonly token: Address;
  readonly payee: Address;
  readonly amountAtomic: string;
  readonly capAtomic: string;
  readonly offerHash: string;
  readonly requirements: Readonly<Record<string, unknown>>;
  readonly facilitatorAddresses: readonly Address[];
  readonly preparedAtUnix: string;
  readonly maxTimeoutSeconds: number;
  readonly rpcOriginHash: string;
}

export interface X402SealedPaymentMaterial {
  readonly materialHash: string;
  readonly contextHash?: string;
  readonly paymentPayloadHash: string;
  readonly paymentHeaderHash: string;
  readonly paymentHeader: string;
}

export interface X402PaymentMaterialPort {
  readonly method: "erc7710";
  prepare(input: X402MaterialPrepareInput): Promise<X402DelegatedMaterialBinding>;
  materialize(operation: X402OperationRecord): Promise<X402SealedPaymentMaterial>;
  recover(operation: X402OperationRecord): Promise<X402SealedPaymentMaterial>;
  markExposed(operation: X402OperationRecord): Promise<void>;
}

export interface X402SigningIntent {
  readonly sender: Address;
  readonly chainId: "8453";
  readonly token: Address;
  readonly tokenDomain: { readonly name: string; readonly version: string };
  readonly authorization: {
    readonly from: Address;
    readonly to: Address;
    readonly value: string;
    readonly validAfter: "0";
    readonly validBefore: string;
    readonly nonce: Hex;
  };
  readonly humanIntent: string;
}

export type X402SigningResult =
  | { readonly disposition: "signed"; readonly signature: Hex }
  | { readonly disposition: "pending"; readonly recoveryToken: string; readonly providerState: string }
  | { readonly disposition: "rejected"; readonly reason: "provider_denied" | "provider_expired" }
  | { readonly disposition: "ambiguous"; readonly reason: string };

export interface X402SigningPort {
  readonly mode: "provider_detached_eip3009_apn_paid_retry";
  request(input: X402SigningIntent): Promise<X402SigningResult>;
  observe(input: {
    readonly recoveryToken: string;
    readonly sender: Address;
    readonly waitSeconds?: number;
  }): Promise<X402SigningResult>;
}

export interface ProviderX402Invocation {
  readonly correlation_id: string;
  readonly request_digest: string;
  readonly intent_binding_hash: string;
  readonly child_identity_hash: string;
  readonly output_sha256: string;
  readonly output_byte_length: string;
  readonly rejection_shape?: ProviderX402RejectionShape;
}

export interface ProviderX402SellerResult {
  readonly classification: "normalized_provider_json";
  readonly http_status: string;
  readonly payment_made?: true;
  readonly amount_paid_atomic?: string;
  readonly canonical_json: string;
  readonly byte_length: string;
  readonly sha256: string;
}

export interface EvidencePort {
  readonly owner: "apn" | "provider";
}

export interface ProviderProfileRepositoryPort {
  load(profileHash: string): Promise<ProviderProfileRecord | null>;
  save(profile: ProviderProfileRecord): Promise<void>;
  remove(profileHash: string): Promise<void>;
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
  readonly x402Signer?: X402SigningPort;
  readonly x402Material?: X402PaymentMaterialPort;
  readonly evidence?: EvidencePort;
  readonly permissions?: ProviderPermissionLifecyclePort;
  readonly profileMigration?: ProviderProfileMigrationPort;
}

export interface ProviderRegistryPort {
  resolve(providerId: string): ProviderAdapterBundle;
}
