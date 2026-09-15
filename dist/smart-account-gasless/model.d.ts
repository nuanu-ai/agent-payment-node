import type { Address, Hex } from "../model.js";
import type { SmartAccountGaslessFailure, SmartAccountGaslessReason } from "./reasons.js";
export declare const SA_CHAIN_ID: 8453;
export declare const SA_TTL_MS = 300000;
export declare const SA_MIN_REMAINING_MS = 30000;
export declare const SA_MAX_UINT: bigint;
export declare const SA_ZERO_ADDRESS: Address;
export declare const SA_PROTOCOL_NAMES: readonly ["manager", "value", "amount", "calldata", "timestamp", "redeemer", "period", "nonce", "delegate"];
export type SmartAccountGaslessProtocolName = typeof SA_PROTOCOL_NAMES[number];
export type SmartAccountGaslessPins = Readonly<Record<SmartAccountGaslessProtocolName, {
    readonly address: Address;
    readonly codeHash: Hex;
}>>;
export interface SmartAccountGaslessRequest {
    readonly chainId: typeof SA_CHAIN_ID;
    readonly recipient: Address;
    readonly grossAtomic: string;
    readonly maxFeeAtomic: string;
    readonly minReceivedAtomic: string;
}
export interface SmartAccountGaslessProfileIdentity {
    readonly profile: string;
    readonly profileHash: string;
    readonly address: Address;
    readonly accountBindingHash: string;
    readonly capabilityHash: string;
    readonly revision: number;
}
/** Only public identities cross the custody boundary; the committed root encoding stays encrypted. */
export interface SmartAccountGaslessBinding {
    readonly providerId: "metamask-smart-account";
    readonly trustClass: "external_owner_delegated_local_session";
    readonly profileHash: string;
    readonly ownerAddress: Address;
    readonly sessionAddress: Address;
    readonly accountBindingHash: string;
    readonly capabilityHash: string;
    readonly profileRevision: number;
    readonly permissionRevision: number;
    readonly rootGrantFingerprint: string;
    readonly encodedRootHash: string;
    readonly rootDelegationHash: Hex;
    readonly delegationManager: Address;
    readonly rootCapAtomic: string;
    readonly rootStartsAtUnix: number;
    readonly rootExpiresAtUnix: number;
    readonly periodTerms: Hex;
    readonly rootNonceAtomic: string;
}
export interface SmartAccountGaslessBlock {
    readonly numberAtomic: string;
    readonly hash: Hex;
    readonly timestampAtomic: string;
}
export interface SmartAccountGaslessChainState {
    readonly ownerAddress: Address;
    readonly sessionAddress: Address;
    readonly ownerCodeHash: Hex;
    readonly sessionCodeHash: Hex;
    readonly protocolCodeHashes: Readonly<Record<SmartAccountGaslessProtocolName, Hex>>;
    readonly tokenProxyCodeHash: Hex;
    readonly tokenImplementationAddress: Address;
    readonly tokenImplementationCodeHash: Hex;
    readonly tokenDomainSeparator: Hex;
    readonly tokenDecimals: 6;
    readonly usdcBalanceAtomic: string;
    readonly ownerNativeBalanceWei: string;
    readonly sessionNativeBalanceWei: string;
    readonly availableAtomic: string;
    readonly allowancePeriodAtomic: string;
    readonly allowanceIsNewPeriod: boolean;
    readonly currentNonceAtomic: string;
}
export interface SmartAccountGaslessSnapshot {
    readonly chainId: typeof SA_CHAIN_ID;
    readonly endpointOrigin: string;
    readonly endpointHash: string;
    readonly observedAt: string;
    readonly preparationBlock: SmartAccountGaslessBlock;
    readonly safeBlock: SmartAccountGaslessBlock;
    readonly safeState: SmartAccountGaslessChainState;
}
export interface SmartAccountGaslessProviderBinding {
    readonly endpointOrigin: string;
    readonly endpointHash: string;
    readonly facilitatorAddresses: readonly Address[];
    readonly supportedResponseHash: string;
    readonly observedAt: string;
}
export interface SmartAccountGaslessRequirements {
    readonly scheme: "exact";
    readonly network: "eip155:8453";
    readonly asset: Address;
    readonly amount: string;
    readonly payTo: Address;
    readonly maxTimeoutSeconds: number;
    readonly extra: {
        readonly assetTransferMethod: "erc7710";
        readonly facilitatorAddresses: readonly Address[];
    };
}
/** Private transport material; never embed this type in a public operation or receipt. */
export interface SmartAccountGaslessPayload {
    readonly x402Version: 2;
    readonly accepted: SmartAccountGaslessRequirements;
    readonly payload: {
        readonly delegationManager: Address;
        readonly delegator: Address;
        readonly permissionContext: Hex;
    };
}
export interface SmartAccountGaslessIntent {
    readonly profile: string;
    readonly request: SmartAccountGaslessRequest;
    readonly binding: SmartAccountGaslessBinding;
    readonly token: Address;
    readonly decimals: 6;
    readonly deploymentEvidenceHash: string;
    readonly provider: SmartAccountGaslessProviderBinding;
    readonly initialSnapshot: SmartAccountGaslessSnapshot;
    readonly requirements: SmartAccountGaslessRequirements;
    readonly preparedAt: string;
    readonly expiresAt: string;
    readonly afterUnix: number;
    readonly beforeUnix: number;
    readonly policyHash: string;
}
export interface SmartAccountGaslessMaterialHashes {
    readonly encodedRootHash: string;
    readonly encodedChildHash: string;
    readonly permissionContextHash: string;
    readonly payloadHash: string;
    readonly requirementsHash: string;
    readonly materialHash: string;
    readonly rootDelegationHash: Hex;
    readonly childDelegationHash: Hex;
}
export interface SmartAccountGaslessMaterialDescriptor extends SmartAccountGaslessMaterialHashes {
    readonly sealedAt: string;
}
export interface SmartAccountGaslessSealedMaterial {
    readonly descriptor: SmartAccountGaslessMaterialDescriptor;
    readonly paymentPayload: SmartAccountGaslessPayload;
    readonly phase: "sealed" | "exposed";
}
export interface SmartAccountGaslessApproval {
    readonly fingerprint: string;
    readonly approvedAt: string;
    readonly expiresAt: string;
}
export interface SmartAccountGaslessVerification {
    readonly observedAt: string;
    readonly payer: Address;
    readonly isValid: true;
    readonly responseHash: string;
}
export interface SmartAccountGaslessProviderSettlement {
    readonly observedAt: string;
    readonly transactionHash: Hex | null;
    readonly responseHash: string;
}
export interface SmartAccountGaslessCursor {
    readonly startBlock: SmartAccountGaslessBlock;
    readonly nextBlockAtomic: string;
    readonly previousEndBlock: SmartAccountGaslessBlock | null;
    readonly expiryBlock: SmartAccountGaslessBlock | null;
    readonly candidateHashes: readonly Hex[];
    readonly transferAnomalies: readonly Hex[];
    readonly childScanComplete: boolean;
    readonly transferScanComplete: boolean;
}
export interface SmartAccountGaslessObservation {
    readonly observedAt: string;
    readonly phase: "pending" | "unavailable" | "invalid" | "reorg" | "success" | "expired_unused";
    readonly reason: SmartAccountGaslessReason | null;
    readonly candidateTxHash: Hex | null;
    readonly evidenceHash: string | null;
    readonly source?: SmartAccountGaslessObservationSource;
}
/** Redacted identity of an owner-named observation RPC; the URL itself is never stored. */
export interface SmartAccountGaslessObservationSource {
    readonly environmentName: string;
    readonly endpointOrigin: string;
    readonly endpointHash: string;
}
export interface SmartAccountGaslessSettlement {
    readonly observedAt: string;
    readonly source: "rpc_discovered" | "provider_hint";
    readonly txHash: Hex;
    readonly transactionBlock: SmartAccountGaslessBlock;
    readonly finalityBlock: SmartAccountGaslessBlock;
    readonly finality: "safe" | "finalized";
    readonly outerSender: Address;
    readonly transactionProofHash: string;
    readonly receiptHash: string;
    readonly contextHash: string;
    readonly protocolHash: string;
    readonly rootDelegationHash: Hex;
    readonly childDelegationHash: Hex;
    readonly childSpentAtomic: string;
    readonly debitAtomic: string;
    readonly deliveredAtomic: string;
    readonly feeAtomic: "0";
    readonly refundAtomic: "0";
    readonly unusedGrossAtomic: "0";
    readonly ownerNativeDebitWei: "0";
    readonly sessionNativeDebitWei: "0";
}
export interface SmartAccountGaslessUnusedProof {
    readonly observedAt: string;
    readonly startBlock: SmartAccountGaslessBlock;
    readonly expiryBlock: SmartAccountGaslessBlock;
    readonly finalityBlock: SmartAccountGaslessBlock;
    readonly childDelegationHash: Hex;
    readonly childSpentAtomic: "0";
    readonly childScanHash: string;
    readonly transferScanHash: string;
    readonly anchorsHash: string;
    readonly protocolHash: string;
}
export interface SmartAccountGaslessRpcObservation {
    readonly cursor: SmartAccountGaslessCursor;
    readonly observation: SmartAccountGaslessObservation;
    readonly settlement: SmartAccountGaslessSettlement | null;
    readonly unusedProof: SmartAccountGaslessUnusedProof | null;
}
export type SmartAccountGaslessState = "awaiting_approval" | "execution_pending" | "material_pending" | "material_sealed" | "exposure_pending" | "verified_pending" | "dispatch_pending" | "submitted_pending" | "unknown_finality" | "failed_before_effect" | "expired_unused" | "completed";
export interface SmartAccountGaslessMutable {
    readonly state: SmartAccountGaslessState;
    readonly approval: SmartAccountGaslessApproval | null;
    readonly material: SmartAccountGaslessMaterialDescriptor | null;
    readonly signingAttempts: 0 | 1;
    readonly exposureAttempts: 0 | 1;
    readonly submissionAttempts: 0 | 1;
    readonly exposureStartedAt: string | null;
    readonly dispatchStartedAt: string | null;
    readonly verification: SmartAccountGaslessVerification | null;
    readonly providerSettlement: SmartAccountGaslessProviderSettlement | null;
    readonly cursor: SmartAccountGaslessCursor;
    readonly observation: SmartAccountGaslessObservation | null;
    readonly settlement: SmartAccountGaslessSettlement | null;
    readonly unusedProof: SmartAccountGaslessUnusedProof | null;
    readonly failure: SmartAccountGaslessFailure | null;
}
