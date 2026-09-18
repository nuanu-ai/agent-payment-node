import type { DirectEvmChainId } from "./evm-direct-networks.js";
import type { EvmDirectBinding } from "./evm-direct.js";
import type { EvmTransferEvidence } from "./evm-ports.js";
import type { DirectAllowlistBinding } from "./direct-allowlist-gate.js";
import type { DirectAssetUsageLease } from "./direct-asset-usage.js";
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type OperationState = "awaiting_approval" | "started" | "provider_pending" | "provider_acknowledged" | "evidence_pending" | "ambiguous_effect" | "signed_not_submitted" | "submitted_pending" | "unknown_finality" | "abandoned_unknown" | "completed" | "failed_before_effect" | "failed_provider_rejected" | "failed_confirmed_revert" | "failed_proven_superseded";
export interface Economics {
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly maximumGasCostAtomic: string;
}
interface ProviderDirectBindingBase {
    readonly schemaVersion: "apn.provider-direct.v1";
    readonly providerId: string;
    readonly profileRevision: number;
    readonly capabilityHash: string;
    readonly accountBindingHash: string;
    readonly rpcBindingHash: string;
    readonly rpcOriginHash: string;
    readonly policy: {
        readonly identity: "apn.direct.foreground-approval.v1";
        readonly verdict: "foreground_approval_required";
        readonly foregroundApprovalRequired: true;
    };
}
export interface ProviderAtomicDirectBinding extends ProviderDirectBindingBase {
    readonly executionMode: "provider_atomic_send";
    readonly executionOwner: "provider";
    readonly retryOwner: "apn_outer_no_replay_journal";
    readonly coinbaseGasless?: CoinbaseGaslessBinding;
}
export interface CoinbaseGaslessBlock {
    readonly numberAtomic: string;
    readonly hash: Hex;
    readonly timestampAtomic: string;
}
export interface CoinbaseGaslessBinding {
    readonly schemaVersion: "apn.coinbase-gasless.v1";
    readonly chainId: 8453;
    readonly token: Address;
    readonly grossAtomic: string;
    readonly netAtomic: string;
    readonly feeAtomic: "0";
    readonly maxFeeAtomic: string;
    readonly minReceivedAtomic: string;
    readonly senderNativeDebitWei: "0";
    readonly sponsorship: "coinbase_cdp_paymaster";
    readonly exclusiveAccountUseRequired: true;
    readonly awalPackage: "awal";
    readonly awalVersion: "2.12.1";
    readonly awalCommand: "send_base_usdc";
    readonly rpcOrigin: string;
    readonly safeBlock: CoinbaseGaslessBlock;
    readonly entryPoint: Address;
    readonly entryPointCodeHash: Hex;
    readonly accountCodeHash: Hex;
    readonly accountImplementation: Address;
    readonly accountImplementationCodeHash: Hex;
}
export interface CoinbaseGaslessLocator {
    readonly schemaVersion: "apn.coinbase-gasless-locator.v1";
    readonly hash: Hex;
    readonly provenance: "awal_success_transaction_hash_field" | "awal_error_text_hint";
}
export interface CoinbaseGaslessCursor {
    readonly nextBlockAtomic: string;
    readonly previousEndBlock: CoinbaseGaslessBlock | null;
}
export interface CoinbaseGaslessSettlement {
    readonly schemaVersion: "apn.coinbase-gasless-settlement.v1";
    readonly userOperationHash: Hex;
    readonly transactionHash: Hex;
    readonly nonceAtomic: string;
    readonly paymaster: Address;
    readonly paymasterCodeHash: Hex;
    readonly block: CoinbaseGaslessBlock;
    readonly safeBlock: CoinbaseGaslessBlock;
    readonly evidenceHash: string;
    readonly grossAtomic: string;
    readonly netAtomic: string;
    readonly feeAtomic: "0";
    readonly senderNativeDebitWei: "0";
}
export interface ProviderDelegatedDirectBinding extends ProviderDirectBindingBase {
    readonly executionMode: "delegated_session_transaction";
    readonly executionOwner: "apn";
    readonly retryOwner: "apn_operation_state";
    readonly permissionRevision: number;
    readonly rootGrantFingerprint: string;
    readonly sessionAddress: Address;
    readonly delegationManager: Address;
    readonly permissionExpiresAtUnix: number;
    readonly coinbaseGasless?: never;
}
export type ProviderDirectBinding = ProviderAtomicDirectBinding | ProviderDelegatedDirectBinding;
export interface ProviderEffectReference {
    readonly schemaVersion: "apn.provider-effect-reference.v1";
    readonly kind: "transaction";
    readonly recoveryToken: string;
    readonly providerState: string;
}
export interface Transition {
    readonly sequence: string;
    readonly at: string;
    readonly state: OperationState;
    readonly terminal: boolean;
    readonly reason: string;
    readonly proofClass: string;
    readonly previousHash: string;
    readonly hash: string;
}
export interface OperationRecord {
    readonly schemaVersion: "apn.state.v1";
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly requestHash: string;
    readonly fingerprint: string;
    readonly walletAddress: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly amountDecimal: string;
    /** The legacy Base USDC and provider paths use 8453; an explicit EVM asset transfer uses its direct network. */
    readonly chainId: DirectEvmChainId;
    readonly token: Address;
    readonly evm?: EvmDirectBinding;
    /** Owner allowlist revision frozen at prepare; writes can never add, change or drop it. Absent on records written before the gate. */
    readonly allowlist?: DirectAllowlistBinding;
    /** The shared usage reservation, written once with `started` before anything is signed. */
    readonly allowlistLease?: DirectAssetUsageLease;
    readonly transactionData?: Hex;
    readonly economics?: Economics;
    readonly providerDirect?: ProviderDirectBinding;
    readonly providerEffect?: ProviderEffectReference;
    readonly coinbaseGaslessLocator?: CoinbaseGaslessLocator;
    readonly coinbaseGaslessCursor?: CoinbaseGaslessCursor;
    readonly coinbaseGaslessSettlement?: CoinbaseGaslessSettlement;
    readonly preparedAt: string;
    readonly preparedBlockNumberAtomic?: string;
    readonly expiresAt: string;
    readonly state: OperationState;
    readonly terminal: boolean;
    readonly reason: string;
    readonly proofClass: string;
    readonly transactionHash?: Hex;
    readonly rawTransactionHash?: Hex;
    readonly lastSubmissionAt?: string;
    readonly transitions: readonly Transition[];
    readonly integrityHash: string;
}
export interface WalletRecord {
    readonly schemaVersion: "apn.state.v1";
    readonly profile: string;
    readonly profileHash: string;
    readonly address: Address;
    readonly createdAt: string;
    readonly bindingHash: string;
    readonly integrityHash: string;
}
export interface ReceiptRecord {
    readonly evm?: EvmDirectBinding;
    readonly amountAtomic?: string;
    readonly evmEvidence?: EvmTransferEvidence;
    readonly coinbaseGaslessSettlement?: CoinbaseGaslessSettlement;
    readonly schemaVersion: "apn.state.v1";
    readonly operationId: string;
    readonly state: OperationState;
    readonly terminal: boolean;
    readonly reason: string;
    readonly proofClass: string;
    readonly transactionHash?: Hex;
    readonly blockNumberAtomic?: string;
    readonly exactTransferLog?: boolean;
    readonly createdAt: string;
    readonly operationIntegrityHash: string;
    readonly integrityHash: string;
}
export {};
