import { type EvmAssetSelection } from "./evm-asset.js";
import { type DirectEvmChainId } from "./evm-direct-networks.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { FeeEstimate, RpcReceipt } from "./ports.js";
import type { EvmBalanceSnapshot, EvmFeeQuote, EvmNativePrepareReads, EvmRpcBatchCall, EvmRpcCall, EvmRpcPort, EvmTransactionInput, EvmTransferEvidence } from "./evm-ports.js";
export declare class EvmRpc implements EvmRpcPort {
    private readonly call;
    private readonly rpcOrigin;
    private readonly maximumSignedBytes;
    private readonly batchCall?;
    constructor(call: EvmRpcCall, rpcOrigin: string, maximumSignedBytes?: number, batchCall?: EvmRpcBatchCall | undefined);
    prepareLineaNative(): EvmNativePrepareReads;
    prepareUnichainNative(): EvmNativePrepareReads;
    prepareUnichainUsdc(): EvmNativePrepareReads;
    preparePolygonUsdc(): EvmNativePrepareReads;
    prepareBnbNative(): EvmNativePrepareReads;
    prepareEthereumNative(): EvmNativePrepareReads;
    /** One prepare owns this bounded read session. No retry or scalar fallback follows a batch rejection. */
    private prepareNativeBatched;
    assertChain(chainId: DirectEvmChainId): Promise<void>;
    balance(address: Address, selection: EvmAssetSelection): Promise<EvmBalanceSnapshot>;
    nonce(chainId: DirectEvmChainId, address: Address, tag: "pending" | "latest"): Promise<string>;
    estimate(input: EvmTransactionInput): Promise<FeeEstimate>;
    feeQuote(chainId: DirectEvmChainId, economics: Economics): Promise<EvmFeeQuote>;
    receipt(chainId: DirectEvmChainId, transactionHash: Hex): Promise<RpcReceipt | null>;
    evidence(operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence>;
    confirmedAtNonce(chainId: DirectEvmChainId, address: Address, nonce: string, startBlock: string): Promise<Hex | null>;
}
