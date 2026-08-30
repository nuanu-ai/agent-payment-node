import type { CHAIN_ID } from "./constants.js";
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type OperationState = "awaiting_approval" | "started" | "provider_acknowledged" | "evidence_pending" | "ambiguous_effect" | "signed_not_submitted" | "submitted_pending" | "unknown_finality" | "completed" | "failed_before_effect" | "failed_confirmed_revert" | "failed_proven_superseded";
export interface Economics {
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly maximumGasCostAtomic: string;
}
export interface ProviderDirectBinding {
    readonly schemaVersion: "apn.provider-direct.v1";
    readonly providerId: string;
    readonly profileRevision: number;
    readonly capabilityHash: string;
    readonly accountBindingHash: string;
    readonly executionMode: "provider_atomic_send";
    readonly executionOwner: "provider";
    readonly retryOwner: "apn_outer_no_replay_journal";
    readonly rpcBindingHash: string;
    readonly rpcOriginHash: string;
    readonly policy: {
        readonly identity: "apn.direct.foreground-approval.v1";
        readonly verdict: "foreground_approval_required";
        readonly foregroundApprovalRequired: true;
    };
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
    readonly chainId: typeof CHAIN_ID;
    readonly token: Address;
    readonly transactionData?: Hex;
    readonly economics?: Economics;
    readonly providerDirect?: ProviderDirectBinding;
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
