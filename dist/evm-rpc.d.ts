import { type EvmAssetSelection } from "./evm-asset.js";
import { type DirectEvmChainId } from "./evm-direct-networks.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { FeeEstimate, RpcReceipt } from "./ports.js";
import type { EvmBalanceSnapshot, EvmFeeQuote, EvmRpcCall, EvmRpcPort, EvmTransactionInput, EvmTransferEvidence } from "./evm-ports.js";
export declare class EvmRpc implements EvmRpcPort {
    private readonly call;
    private readonly rpcOrigin;
    private readonly maximumSignedBytes;
    constructor(call: EvmRpcCall, rpcOrigin: string, maximumSignedBytes?: number);
    assertChain(chainId: DirectEvmChainId): Promise<void>;
    balance(address: Address, selection: EvmAssetSelection): Promise<EvmBalanceSnapshot>;
    nonce(chainId: DirectEvmChainId, address: Address, tag: "pending" | "latest"): Promise<string>;
    estimate(input: EvmTransactionInput): Promise<FeeEstimate>;
    feeQuote(chainId: DirectEvmChainId, economics: Economics): Promise<EvmFeeQuote>;
    receipt(chainId: DirectEvmChainId, transactionHash: Hex): Promise<RpcReceipt | null>;
    evidence(operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence>;
    confirmedAtNonce(chainId: DirectEvmChainId, address: Address, nonce: string, startBlock: string): Promise<Hex | null>;
}
