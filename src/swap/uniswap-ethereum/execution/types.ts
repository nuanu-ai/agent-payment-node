import type { Hex } from "../../../model.js";
import type { SwapOperationRecord, SwapReceiptProof } from "../../model.js";
import type { UniswapTransactionEnvelope } from "../../uniswap-codec.js";

export interface UniswapOwnerAdmission {
  readonly profile: string;
  readonly profileHash: string;
  readonly account: string;
  readonly walletBindingHash: string;
  readonly walletCreatedAt: string;
  readonly admissionHash: string;
}

export interface UniswapOwnerAdmissionPort {
  /** Must fail closed when the profile/account is not presently admitted. */
  assert(operation: SwapOperationRecord): Promise<UniswapOwnerAdmission>;
}

export interface UniswapExecutionFreshness {
  readonly chainId: 1;
  readonly account: string;
  readonly nonce: string;
  readonly gasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
  readonly checkedAt: string;
}

export interface UniswapExecutionGuardPort {
  inspect(operation: SwapOperationRecord, envelope: UniswapTransactionEnvelope): Promise<UniswapExecutionFreshness>;
}

export interface UniswapExecutionApprovalRequest {
  readonly schemaVersion: "apn.uniswap-ethereum.execution-approval.v1";
  readonly operationId: string;
  readonly quoteHash: string;
  readonly account: string;
  readonly recipient: string;
  readonly inputAmountAtomic: string;
  readonly expectedOutputAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly slippageBps: number;
  readonly gasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
  readonly maximumGasCostAtomic: string;
  readonly expiresAt: string;
  readonly approvalHash: string;
}

export interface UniswapForegroundApprovalPort {
  confirm(request: UniswapExecutionApprovalRequest): Promise<{ readonly approved: boolean; readonly approvalHash: string }>;
}

export interface UniswapExecutionBinding {
  readonly schemaVersion: "apn.uniswap-ethereum.execution-binding.v1";
  readonly operationId: string;
  readonly operationIntegrityHash: string;
  readonly profileHash: string;
  readonly account: string;
  readonly walletBindingHash: string;
  readonly walletCreatedAt: string;
  readonly ownerAdmissionHash: string;
  readonly chainId: 1;
  readonly envelope: UniswapTransactionEnvelope;
  readonly envelopeHash: string;
  readonly nonce: string;
  readonly deadline: number;
  readonly quoteHash: string;
  readonly simulationRequestHash: string;
  readonly simulationResultHash: string;
  readonly policyDigest: string;
  readonly mechanismDigest: string;
  readonly protocolRegistryDigest: string;
  readonly approvalHash: string;
  readonly submissionMarkerHash: string;
  readonly bindingHash: string;
}

export type UniswapEffectPhase = "sealed" | "send_started" | "send_accepted" | "send_ambiguous";
export interface UniswapExecutionEffect {
  readonly schemaVersion: "apn.uniswap-ethereum.execution-effect.v1";
  readonly operationId: string;
  readonly profileHash: string;
  readonly bindingHash: string;
  readonly envelopeHash: string;
  readonly submissionMarkerHash: string;
  readonly rawTransaction: Hex;
  readonly transactionHash: Hex;
  readonly phase: UniswapEffectPhase;
  readonly sendAttempts: 0 | 1;
  readonly sealedAt: string;
  readonly updatedAt: string;
  readonly integrityHash: string;
}

export interface UniswapEffectStorePort {
  load(operation: SwapOperationRecord, binding: UniswapExecutionBinding): Promise<UniswapExecutionEffect | null>;
  seal(operation: SwapOperationRecord, binding: UniswapExecutionBinding, effect: UniswapExecutionEffect): Promise<UniswapExecutionEffect>;
  markSendStarted(operation: SwapOperationRecord, binding: UniswapExecutionBinding, now: Date): Promise<UniswapExecutionEffect>;
  markSendOutcome(operation: SwapOperationRecord, binding: UniswapExecutionBinding,
    phase: "send_accepted" | "send_ambiguous", now: Date): Promise<UniswapExecutionEffect>;
}

export interface UniswapExecutionSignerPort {
  sign(operation: SwapOperationRecord, binding: UniswapExecutionBinding,
    admission: UniswapOwnerAdmission, now: Date): Promise<UniswapExecutionEffect>;
}

export interface UniswapSingleSendPort {
  sendOnce(operation: SwapOperationRecord, binding: UniswapExecutionBinding, now: Date): Promise<
    { readonly kind: "submitted"; readonly transactionHash: Hex } |
    { readonly kind: "possible_send"; readonly transactionHash: Hex }>;
}

export interface UniswapReceiptObserverPort {
  observe(operation: SwapOperationRecord, binding: UniswapExecutionBinding, transactionHash: Hex): Promise<SwapReceiptProof | null>;
}
