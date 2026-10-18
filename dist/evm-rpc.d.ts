import { type EvmAssetSelection } from "./evm-asset.js";
import { type DirectEvmChainId } from "./evm-direct-networks.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { FeeEstimate, RpcReceipt } from "./ports.js";
import type { EvmBalanceSnapshot, EvmDirectReads, EvmFeeQuote, EvmRpcBatchCall, EvmRpcCall, EvmRpcPort, EvmTransactionInput, EvmTransferEvidence } from "./evm-ports.js";
import type { FinalizedBatchRead } from "./evm-finalized-proof.js";
export declare class EvmRpc implements EvmRpcPort {
    private readonly call;
    private readonly rpcOrigin;
    private readonly maximumSignedBytes;
    private readonly batchCall?;
    /** The endpoint's IP is pinned for this instance, so its chain id is proven once and cannot change afterwards. */
    private verifiedChain;
    constructor(call: EvmRpcCall, rpcOrigin: string, maximumSignedBytes?: number, batchCall?: EvmRpcBatchCall | undefined);
    /** One batched read session for one direct transfer step; see `evmDirectReads` for its POST plan. */
    directReads(chainId: DirectEvmChainId): EvmDirectReads;
    /** Independent reads in one POST when the transport batches; the chain id joins the first POST of this instance. */
    private read;
    assertChain(chainId: DirectEvmChainId): Promise<void>;
    balance(address: Address, selection: EvmAssetSelection): Promise<EvmBalanceSnapshot>;
    nonce(chainId: DirectEvmChainId, address: Address, tag: "pending" | "latest"): Promise<string>;
    estimate(input: EvmTransactionInput): Promise<FeeEstimate>;
    feeQuote(chainId: DirectEvmChainId, economics: Economics): Promise<EvmFeeQuote>;
    receipt(chainId: DirectEvmChainId, transactionHash: Hex): Promise<RpcReceipt | null>;
    /** Bounded read-only transport for the native fee observer. */
    nativeFeeRead(method: "eth_getTransactionReceipt" | "eth_getTransactionByHash" | "eth_getBlockByNumber" | "eth_call", params: readonly unknown[]): Promise<unknown>;
    /** One POST after the receipt: its block, the transaction and, where finality is `safe`, the safe head. */
    evidence(operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence>;
    /**
     * The never-lands proof's batches on one network, each one POST. This instance proves the endpoint's chain id once, in
     * its first POST (P2), so the proof's own chain-id row is answered from that proof instead of being read again.
     */
    finalizedBatch(chainId: DirectEvmChainId): FinalizedBatchRead;
}
