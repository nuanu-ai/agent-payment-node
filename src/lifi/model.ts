import type { EvmChainId } from "../evm-asset.js";
import type { EvmFeeQuote } from "../evm-ports.js";
import type { Address, Economics, Hex } from "../model.js";

export type BridgeTool = "across" | "stargateV2";
export interface BridgeRouteRequest {
  readonly fromChainId: EvmChainId;
  readonly toChainId: EvmChainId;
  readonly fromToken: Address;
  readonly toToken: Address;
  readonly amountAtomic: string;
  readonly recipient: Address;
  readonly minOutputAtomic: string;
  readonly maxNativeDebitWei: string;
  readonly maxRouteFeeAtomic: string;
  readonly slippageBps: number;
}
export interface BridgeOwner {
  readonly profile: string;
  readonly profileHash: string;
  readonly address: Address;
  readonly walletBindingHash: string;
  readonly walletCreatedAt: string;
}
export interface BridgeProviderBinding {
  readonly providerId: "local";
  readonly accountBindingHash: string;
  readonly capabilityHash: string;
  readonly revision: number;
}
export interface BridgeFee {
  readonly name: string;
  readonly chainId: EvmChainId;
  readonly asset: Address | "native";
  readonly amountAtomic: string;
  readonly included: boolean;
}
export interface BridgeTransaction {
  readonly chainId: EvmChainId;
  readonly from: Address;
  readonly to: Address;
  readonly valueAtomic: string;
  readonly data: Hex;
  readonly gasLimitAtomic: string;
}
export interface BridgeMaterialization {
  readonly routeId: string;
  readonly stepId: string;
  readonly tool: BridgeTool;
  readonly request: BridgeRouteRequest;
  readonly sender: Address;
  readonly approvalAddress: Address;
  readonly quotedOutputAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly feeCosts: readonly BridgeFee[];
  readonly includedStepIdentities: readonly string[];
  readonly transaction: BridgeTransaction;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly routeHash: string;
  readonly stepHash: string;
  readonly materializedStepHash: string;
  readonly transactionDigest: string;
}
export interface AcrossCall {
  readonly kind: "across";
  readonly receiverAddress: Hex;
  readonly refundAddress: Hex;
  readonly sendingAssetId: Hex;
  readonly receivingAssetId: Hex;
  readonly outputAmountAtomic: string;
  readonly outputAmountMultiplier: string;
  readonly exclusiveRelayer: Hex;
  readonly quoteTimestamp: string;
  readonly fillDeadline: string;
  readonly exclusivityParameter: string;
  readonly message: "0x";
}
export interface StargateCall {
  readonly kind: "stargateV2";
  readonly assetId: 1;
  readonly dstEid: number;
  readonly receiverAddress: Hex;
  readonly amountLD: string;
  readonly minAmountLD: string;
  readonly nativeFee: string;
  readonly lzTokenFee: "0";
  readonly refundAddress: Address;
  readonly extraOptions: "0x";
  readonly composeMsg: "0x";
  readonly oftCmd: "0x";
}
export interface DecodedBridgeCall {
  readonly tool: BridgeTool;
  readonly selector: Hex;
  readonly transactionId: Hex;
  readonly bridgeName: "across" | "stargateV2";
  readonly integrator: "lifi-api";
  readonly referrer: Address;
  readonly sender: Address;
  readonly recipient: Address;
  readonly sourceChainId: EvmChainId;
  readonly destinationChainId: EvmChainId;
  readonly sourceToken: Address;
  readonly destinationToken: Address;
  readonly sourceAmountAtomic: string;
  readonly bridgeAmountAtomic: string;
  readonly feeAmountAtomic: string;
  readonly feeRecipient: Address;
  readonly minimumOutputAtomic: string;
  readonly sourceValueAtomic: string;
  readonly dataHash: string;
  readonly protocol: AcrossCall | StargateCall;
}

export interface BridgeBlock {
  readonly numberAtomic: string;
  readonly hash: Hex;
  readonly timestampAtomic: string;
}
export interface BridgeDeploymentContract {
  readonly chainId: EvmChainId;
  readonly peerChainId: EvmChainId;
  readonly tool: BridgeTool;
  readonly diamond: Address;
  readonly feeForwarder: Address;
  readonly feeRecipient: Address;
  readonly token: Address;
  readonly protocolEmitter: Address;
  readonly endpointId: number | null;
  readonly quoteTimeBufferAtomic: string | null;
  readonly fillDeadlineBufferAtomic: string | null;
  readonly code: readonly { readonly address: Address; readonly codeHash: Hex }[];
  readonly reads: readonly {
    readonly kind: "call" | "storage";
    readonly address: Address;
    readonly data: Hex;
    readonly expected: Hex;
  }[];
}
export interface BridgeDeploymentIdentity {
  readonly chainId: EvmChainId;
  readonly peerChainId: EvmChainId;
  readonly tool: BridgeTool;
  readonly block: BridgeBlock;
  readonly rpcOrigin: string;
  readonly contractHash: string;
  readonly codeHash: string;
  readonly configurationHash: string;
}
export interface BridgeLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}
/** Pure protocol decoders receive logs only after the RPC adapter verifies membership. */
export interface BridgeProtocolReceipt {
  readonly chainId: EvmChainId;
  readonly transactionHash: Hex;
  readonly blockNumberAtomic: string;
  readonly blockHash: Hex;
  readonly logs: readonly BridgeLog[];
}
export interface AcrossCorrelation {
  readonly kind: "across";
  readonly depositId: string;
  readonly originChainId: EvmChainId;
  readonly destinationChainId: EvmChainId;
  readonly inputToken: Hex;
  readonly outputToken: Hex;
  readonly inputAmountAtomic: string;
  readonly outputAmountAtomic: string;
  readonly depositor: Hex;
  readonly recipient: Hex;
  readonly exclusiveRelayer: Hex;
  readonly quoteTimestamp: string;
  readonly fillDeadline: string;
  readonly exclusivityDeadline: string;
  readonly message: "0x";
}
export interface StargateCorrelation {
  readonly kind: "stargateV2";
  readonly guid: Hex;
  readonly sourceEid: number;
  readonly destinationEid: number;
  readonly sender: Address;
  readonly recipient: Address;
  readonly amountSentAtomic: string;
  readonly amountReceivedAtomic: string;
}
export interface BridgeSourceProof {
  readonly tool: BridgeTool;
  readonly chainId: EvmChainId;
  readonly transactionHash: Hex;
  readonly blockNumberAtomic: string;
  readonly blockHash: Hex;
  readonly sourceAmountAtomic: string;
  readonly bridgeAmountAtomic: string;
  readonly feeForwardedAtomic: string;
  readonly logsHash: string;
  readonly correlation: AcrossCorrelation | StargateCorrelation;
}
export interface BridgeDestinationProof {
  readonly tool: BridgeTool;
  readonly chainId: EvmChainId;
  readonly transactionHash: Hex;
  readonly blockNumberAtomic: string;
  readonly blockHash: Hex;
  readonly recipient: Address;
  readonly token: Address;
  readonly amountAtomic: string;
  readonly correlationHash: string;
  readonly logsHash: string;
  readonly fillType: 0 | 1 | 2 | null;
  readonly relayerCredit: Hex | null;
  readonly repaymentChainIdAtomic: string | null;
}

export interface BridgeEnvelope {
  readonly role: "approval" | "bridge";
  readonly chainId: EvmChainId;
  readonly from: Address;
  readonly to: Address;
  readonly valueAtomic: string;
  readonly data: Hex;
  readonly economics: Economics;
  readonly feeQuote: EvmFeeQuote;
  readonly provisionalGas: boolean;
  readonly envelopeHash: string;
}
export interface BridgeTransactionProof {
  readonly chainId: EvmChainId;
  readonly transactionHash: Hex;
  readonly block: BridgeBlock;
  readonly safeBlock: BridgeBlock | null;
  readonly rpcOrigin: string;
  readonly from: Address;
  readonly to: Address;
  readonly nonceAtomic: string;
  readonly valueAtomic: string;
  readonly dataHash: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
  readonly gasUsedAtomic: string;
  readonly effectiveGasPriceAtomic: string;
  readonly executionFeeWei: string;
  readonly l1DataFeeWei: string;
  readonly operatorFeeWei: string;
  readonly actualTotalFeeWei: string;
  readonly blobFeeWei: string;
  readonly feeEvidence: BridgeFeeEvidence;
  readonly status: "success" | "reverted";
  readonly logsHash: string;
}
export interface BridgeFeeEvidence {
  readonly receiptHash: string;
  readonly ruleHash: string;
  readonly arbitrumPosterGasAtomic: string | null;
  readonly baseOracle: null | {
    readonly oracle: Address; readonly from: Address; readonly callData: Hex; readonly rawReturn: Hex;
    readonly blockHash: Hex; readonly requireCanonical: true; readonly version: "1.6.0"; readonly regime: "jovian";
    readonly scalarAtomic: string; readonly constantWei: string;
  };
}
export interface BridgeAccountSnapshot {
  readonly chainId: EvmChainId;
  readonly rpcOrigin: string;
  readonly block: BridgeBlock;
  readonly owner: Address;
  readonly token: Address;
  readonly spender: Address;
  readonly balanceAtomic: string;
  readonly nativeBalanceWei: string;
  readonly allowanceAtomic: string;
  readonly latestNonceAtomic: string;
  readonly pendingNonceAtomic: string;
}
export interface BridgeResidualAllowance {
  readonly amountAtomic: string;
  readonly block: BridgeBlock;
  readonly rpcOrigin: string;
}
export interface BridgeProviderObservation {
  readonly status: "not_found" | "pending" | "completed_observed" | "partial_observed" | "refund_observed" | "failed_observed" | "unknown";
  readonly destinationTransactionHash: Hex | null;
  readonly observedAt: string;
  readonly responseHash: string | null;
}
export interface BridgeDestinationScan {
  readonly startBlock: BridgeBlock;
  readonly nextBlockAtomic: string;
  readonly previousEndBlock: BridgeBlock | null;
}
