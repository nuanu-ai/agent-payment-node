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
/** Row data, never a baked literal: `name`/`version` are re-validated against the named registry row. */
export interface GaslessTokenDomain {
    readonly name: string;
    readonly version: string;
    readonly chainId: GaslessChainId;
    readonly verifyingContract: Address;
    readonly domainSeparator: Hex;
}
/** A row's claim about one token implementation's storage. Never protocol knowledge, so it is proved before any use. */
export interface GaslessBalanceLayout {
    /** The token implementation the claim describes; must be the implementation the chain is verified to run. */
    readonly implementationHash: Hex;
    /** Solidity mapping base slot of `balanceOf` in that implementation. */
    readonly mappingSlotAtomic: string;
}
/**
 * One admitted asset on one chain. `decimals`, `domain`, the code hashes and `paymaster` are all asserted against the
 * chain before every effect; `symbol` is display-only; `balanceLayout` is proved before any state override uses it.
 */
export interface GaslessAsset {
    readonly chainId: GaslessChainId;
    readonly token: Address;
    readonly symbol: string;
    readonly decimals: number;
    readonly domain: GaslessTokenDomain;
    readonly paymaster: Address;
    readonly wrappedNativeToken: Address;
    readonly implementation: Address;
    readonly implementationHash: Hex;
    /** Null when the row makes no layout claim, which fails every path that would need one. */
    readonly balanceLayout: GaslessBalanceLayout | null;
    readonly code: readonly {
        readonly address: Address;
        readonly codeHash: Hex;
    }[];
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
    /** Every asset this chain admits. The first entry is the row's default `token`. */
    readonly assets: readonly GaslessAsset[];
    readonly code: readonly {
        readonly address: Address;
        readonly codeHash: Hex;
    }[];
    readonly reads: readonly {
        readonly kind: "call" | "storage";
        readonly address: Address;
        readonly data: Hex;
        readonly expected: Hex;
    }[];
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
/** Prices a UserOperation is signed with: v4 chooses them after approval within the fee cap, earlier wires use the intent's. */
export type GaslessFees = Pick<GaslessGas, "maxFeePerGas" | "maxPriorityFeePerGas">;
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
/** Frozen owner activation for local Base or Ethereum USDC. Absent on historical journals. */
export interface GaslessAllowlistBinding {
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly activationDigest: string;
    readonly chain: "eip155:8453" | "eip155:1";
    readonly token: Address;
    readonly mechanism: Readonly<{
        provider: "local";
        reference: string;
    }>;
    readonly reservationId: string;
}
export interface GaslessIntent {
    /** Absent on legacy journals; never reinterpret their signed wire or hash. */
    readonly wireVersion?: "apn.gasless-wire.v2" | "apn.gasless-wire.v3" | "apn.gasless-wire.v4";
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
    readonly allowlist?: GaslessAllowlistBinding;
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
    readonly factory?: Address;
    readonly factoryData?: "0x";
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
export interface GaslessEstimate extends Pick<GaslessGas, "verificationGasLimit" | "callGasLimit" | "paymasterVerificationGasLimit" | "paymasterPostOpGasLimit" | "preVerificationGas"> {
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
export interface GaslessPermissionInvalidation {
    readonly chainId: GaslessChainId;
    readonly intentHash: string;
    readonly bootstrapMaterialHash: string;
    readonly protocolHash: string;
    readonly safeBlock: GaslessBlock;
    readonly headBlock: GaslessBlock;
    readonly safeAccount: GaslessAccountState;
    readonly headAccount: GaslessAccountState;
    /** Present together only for a known final seal whose EntryPoint nonce is invalidated. */
    readonly userOperationMaterialHash?: string;
    readonly userOperationHash?: Hex;
}
export interface GaslessObservationSource {
    readonly policy: "apn.gasless.observation-rpc.v1";
    readonly environmentName: string;
    readonly rpcOrigin: string;
    readonly rpcEndpointHash: string;
    readonly intentHash: string;
    readonly initialBlock: GaslessBlock;
}
export interface GaslessObservation {
    readonly status: "not_found" | "pending" | "safe" | "unresolved" | "permissions_invalidated";
    readonly transactionHash: Hex | null;
    readonly settlement: GaslessSettlement | null;
    readonly cursor: GaslessCursor;
    readonly evidenceHash: string | null;
    readonly reason: string | null;
    readonly permissionInvalidation?: GaslessPermissionInvalidation;
    readonly source?: GaslessObservationSource;
}
