import type { CHAIN_ID } from "./constants.js";

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type OperationState =
  | "awaiting_approval"
  | "signed_not_submitted"
  | "submitted_pending"
  | "unknown_finality"
  | "completed"
  | "failed_before_effect"
  | "failed_confirmed_revert"
  | "failed_proven_superseded";

export interface Economics {
  readonly nonceAtomic: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
  readonly maximumGasCostAtomic: string;
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
  readonly transactionData: Hex;
  readonly economics: Economics;
  readonly preparedAt: string;
  readonly preparedBlockNumberAtomic: string;
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
