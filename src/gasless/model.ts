import type { Address, Hex } from "../model.js";

export type GaslessChainId = 1 | 10 | 130 | 137 | 8453 | 42161 | 43114;
export interface GaslessRequest {
  readonly chainId: GaslessChainId;
  readonly recipient: Address;
  readonly grossAtomic: string;
  readonly maxFeeAtomic: string;
  readonly minReceivedAtomic: string;
}
export interface GaslessOwner {
  readonly profile: string;
  readonly profileHash: string;
  readonly address: Address;
  readonly walletBindingHash: string;
  readonly walletCreatedAt: string;
}
export interface GaslessProviderBinding {
  readonly providerId: "local";
  readonly accountBindingHash: string;
  readonly capabilityHash: string;
  readonly revision: number;
}
export interface GaslessBlock {
  readonly numberAtomic: string;
  readonly hash: Hex;
  readonly timestampAtomic: string;
}
export interface GaslessTokenDomain {
  readonly name: "USD Coin" | "USDC";
  readonly version: "2";
  readonly chainId: GaslessChainId;
  readonly verifyingContract: Address;
  readonly domainSeparator: Hex;
}
export interface GaslessDeployment {
  readonly chainId: GaslessChainId;
  readonly network: string;
  readonly rpcEnv: string;
  readonly bundlerEnv: string;
  readonly publicBundlerUrl: string;
  readonly token: Address;
  readonly tokenDomain: GaslessTokenDomain;
  readonly paymaster: Address;
  readonly entryPoint: Address;
  readonly delegate: Address;
  readonly code: readonly { readonly address: Address; readonly codeHash: Hex }[];
  readonly reads: readonly { readonly kind: "call" | "storage"; readonly address: Address;
    readonly data: Hex; readonly expected: Hex }[];
  readonly evidenceHash: string;
}
export interface GaslessGas {
  readonly verificationGasLimit: string;
  readonly callGasLimit: string;
  readonly paymasterVerificationGasLimit: string;
  readonly paymasterPostOpGasLimit: string;
  readonly preVerificationGas: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
}
export interface GaslessFeeConfiguration {
  readonly additionalGasCharge: string;
  readonly feeSpread: string;
  readonly nativeTokenPrice: string;
}
export interface GaslessAccountState {
  readonly owner: Address;
  readonly balanceAtomic: string;
  readonly nativeBalanceWei: string;
  readonly allowanceAtomic: string;
  readonly permitNonceAtomic: string;
  readonly entryPointNonceAtomic: string;
  readonly eoaNonceAtomic: string;
  readonly pendingEoaNonceAtomic: string;
  readonly delegation: "empty" | "expected";
}
export interface GaslessSnapshot extends GaslessAccountState {
  readonly chainId: GaslessChainId;
  readonly rpcOrigin: string;
  readonly rpcEndpointHash: string;
  readonly bundlerOrigin: string;
  readonly bundlerEndpointHash: string;
  readonly block: GaslessBlock;
  readonly protocolHash: string;
  readonly token: Address;
  readonly feeConfiguration: GaslessFeeConfiguration;
  readonly baseFeePerGas: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
}
export interface GaslessIntent {
  readonly profile: string;
  readonly request: GaslessRequest;
  readonly owner: GaslessOwner;
  readonly providerBinding: GaslessProviderBinding;
  readonly initialSnapshot: GaslessSnapshot;
  readonly gas: GaslessGas;
  readonly token: Address;
  readonly tokenDomain: GaslessTokenDomain;
  readonly paymaster: Address;
  readonly entryPoint: Address;
  readonly delegate: Address;
  readonly feeCapAtomic: string;
  readonly recipientAtomic: string;
  readonly callData: Hex;
  readonly unsignedEnvelopeHash: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly policyHash: string;
}
/** Exact JSON-RPC representation. No signed bytes are stored in the operation journal. */
export interface GaslessAuthorization {
  readonly chainId: Hex;
  readonly address: Address;
  readonly nonce: Hex;
  readonly yParity: Hex;
  readonly r: Hex;
  readonly s: Hex;
}
export interface GaslessUserOperation {
  readonly sender: Address;
  readonly nonce: Hex;
  readonly factory: Address;
  readonly factoryData: "0x";
  readonly callData: Hex;
  readonly callGasLimit: Hex;
  readonly verificationGasLimit: Hex;
  readonly preVerificationGas: Hex;
  readonly maxFeePerGas: Hex;
  readonly maxPriorityFeePerGas: Hex;
  readonly paymaster: Address;
  readonly paymasterVerificationGasLimit: Hex;
  readonly paymasterPostOpGasLimit: Hex;
  readonly paymasterData: Hex;
  readonly signature: Hex;
  readonly eip7702Auth?: GaslessAuthorization;
}
export interface GaslessEstimate extends Pick<GaslessGas, "verificationGasLimit" | "callGasLimit" |
  "paymasterVerificationGasLimit" | "paymasterPostOpGasLimit" | "preVerificationGas"> {
  readonly responseHash: string;
}
export interface GaslessCursor {
  readonly startBlock: GaslessBlock;
  readonly nextBlockAtomic: string;
  readonly previousEndBlock: GaslessBlock | null;
}
export interface GaslessLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly logIndexAtomic: string;
}
/** The adapter authenticates outer transaction, block membership and complete log set first. */
export interface GaslessProtocolReceipt {
  readonly chainId: GaslessChainId;
  readonly transactionHash: Hex;
  readonly block: GaslessBlock;
  readonly logs: readonly GaslessLog[];
}
export interface GaslessAccounting {
  readonly success: boolean;
  readonly branch: "sponsored" | "post_op_reverted" | "prefund_too_low";
  readonly prefundAtomic: string;
  readonly refundAtomic: string;
  readonly feeAtomic: string;
  readonly deliveredAtomic: string;
  readonly logsHash: string;
}
export interface GaslessSettlement {
  readonly chainId: GaslessChainId;
  readonly userOperationHash: Hex;
  readonly transactionHash: Hex;
  readonly block: GaslessBlock;
  readonly safeBlock: GaslessBlock;
  readonly outerSender: Address;
  readonly transactionProofHash: string;
  readonly receiptHash: string;
  readonly protocolHash: string;
  readonly effectAccount: GaslessAccountState;
  readonly safeAccount: GaslessAccountState;
  readonly accounting: GaslessAccounting;
}
export interface GaslessEffectIdentity {
  readonly bootstrapMaterialHash: string | null;
  readonly userOperationMaterialHash: string | null;
  readonly userOperationHash: Hex | null;
}
export interface GaslessObservation {
  readonly status: "not_found" | "pending" | "safe" | "unresolved";
  readonly transactionHash: Hex | null;
  readonly settlement: GaslessSettlement | null;
  readonly cursor: GaslessCursor;
  readonly evidenceHash: string | null;
  readonly reason: string | null;
}
