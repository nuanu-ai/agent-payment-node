import type { Address, Hex } from "./model.js";
import type { ProviderCapabilitySnapshot, ProviderProfileRecord } from "./provider-profile.js";
import type { ProviderX402RejectionShape } from "./provider-x402-rejection-shape.js";

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
    readonly sender: Address;
  }): Promise<
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
  readonly evidence?: EvidencePort;
}

export interface ProviderRegistryPort {
  resolve(providerId: string): ProviderAdapterBundle;
}
