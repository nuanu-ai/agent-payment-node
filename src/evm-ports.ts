import type { EvmAsset, EvmAssetSelection, EvmChainId } from "./evm-asset.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { FeeEstimate, RpcProvenance, RpcReceipt } from "./ports.js";

export interface EvmBalanceSnapshot extends RpcProvenance {
  readonly address: Address;
  readonly asset: EvmAsset;
  readonly assetAtomic: string;
  readonly nativeAtomic: string;
}

export interface EvmFeeQuote extends RpcProvenance {
  readonly chainId: EvmChainId;
  readonly feeModel?: "arbitrum-inclusive";
  readonly l1DataFeeUpperWei: string;
  readonly operatorFeeUpperWei: string;
  readonly maximumExecutionFeeWei: string;
  readonly totalQuoteWei: string;
  readonly totalFeeEnforcedOnchain: false;
}

export interface EvmTransferEvidence {
  readonly blockHash: Hex;
  readonly transactionVerified: boolean;
  readonly tokenBalanceDeltasVerified: boolean;
  readonly senderDeltaAtomic?: string;
  readonly recipientDeltaAtomic?: string;
  readonly safeBlockNumberAtomic?: string;
  readonly safeBlockHash?: Hex;
}

export interface EvmTransactionInput {
  readonly chainId: EvmChainId;
  readonly from: Address;
  readonly to: Address;
  readonly valueAtomic: string;
  readonly data: Hex;
}

export interface EvmRpcPort {
  assertChain(chainId: EvmChainId): Promise<void>;
  balance(address: Address, selection: EvmAssetSelection): Promise<EvmBalanceSnapshot>;
  nonce(chainId: EvmChainId, address: Address, tag: "pending" | "latest"): Promise<string>;
  estimate(input: EvmTransactionInput): Promise<FeeEstimate>;
  feeQuote(chainId: EvmChainId, economics: Economics): Promise<EvmFeeQuote>;
  receipt(chainId: EvmChainId, transactionHash: Hex): Promise<RpcReceipt | null>;
  evidence(operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence>;
  confirmedAtNonce(chainId: EvmChainId, address: Address, nonce: string, startBlock: string): Promise<Hex | null>;
}

export type EvmRpcCall = (method: string, params: readonly unknown[]) => Promise<unknown>;
