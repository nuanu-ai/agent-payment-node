import type { EvmAsset, EvmAssetSelection } from "./evm-asset.js";
import type { DirectEvmChainId, DirectEvmQuoteFeeModel } from "./evm-direct-networks.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { FeeEstimate, RpcProvenance, RpcReceipt } from "./ports.js";
export interface EvmBalanceSnapshot extends RpcProvenance {
    readonly address: Address;
    readonly asset: EvmAsset;
    readonly assetAtomic: string;
    readonly nativeAtomic: string;
}
export interface EvmFeeQuote extends RpcProvenance {
    readonly chainId: DirectEvmChainId;
    readonly feeModel?: DirectEvmQuoteFeeModel;
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
    readonly chainId: DirectEvmChainId;
    readonly from: Address;
    readonly to: Address;
    readonly valueAtomic: string;
    readonly data: Hex;
}
export interface EvmRpcPort {
    assertChain(chainId: DirectEvmChainId): Promise<void>;
    balance(address: Address, selection: EvmAssetSelection): Promise<EvmBalanceSnapshot>;
    nonce(chainId: DirectEvmChainId, address: Address, tag: "pending" | "latest"): Promise<string>;
    estimate(input: EvmTransactionInput): Promise<FeeEstimate>;
    feeQuote(chainId: DirectEvmChainId, economics: Economics): Promise<EvmFeeQuote>;
    receipt(chainId: DirectEvmChainId, transactionHash: Hex): Promise<RpcReceipt | null>;
    evidence(operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence>;
    confirmedAtNonce(chainId: DirectEvmChainId, address: Address, nonce: string, startBlock: string): Promise<Hex | null>;
}
export type EvmRpcCall = (method: string, params: readonly unknown[]) => Promise<unknown>;
