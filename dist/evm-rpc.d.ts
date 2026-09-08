import { type EvmAssetSelection, type EvmChainId } from "./evm-asset.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { FeeEstimate, RpcReceipt } from "./ports.js";
import type { EvmBalanceSnapshot, EvmFeeQuote, EvmRpcCall, EvmRpcPort, EvmTransactionInput, EvmTransferEvidence } from "./evm-ports.js";
export declare class EvmRpc implements EvmRpcPort {
    private readonly call;
    private readonly rpcOrigin;
    constructor(call: EvmRpcCall, rpcOrigin: string);
    assertChain(chainId: EvmChainId): Promise<void>;
    balance(address: Address, selection: EvmAssetSelection): Promise<EvmBalanceSnapshot>;
    nonce(chainId: EvmChainId, address: Address, tag: "pending" | "latest"): Promise<string>;
    estimate(input: EvmTransactionInput): Promise<FeeEstimate>;
    feeQuote(chainId: EvmChainId, economics: Economics): Promise<EvmFeeQuote>;
    receipt(chainId: EvmChainId, transactionHash: Hex): Promise<RpcReceipt | null>;
    evidence(operation: OperationRecord, receipt: RpcReceipt): Promise<EvmTransferEvidence>;
    confirmedAtNonce(chainId: EvmChainId, address: Address, nonce: string, startBlock: string): Promise<Hex | null>;
}
