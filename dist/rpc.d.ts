import type { EvmChainId } from "./evm-asset.js";
import { EvmRpc } from "./evm-rpc.js";
import type { Address, Hex } from "./model.js";
import type { BalanceSnapshot, FeeEstimate, RpcPort, RpcReceipt, X402AuthorizationState, X402AuthorizationUsedLogs, X402BlockReference, X402PrepareEvidence, X402RpcBlock, X402RpcHead, X402RpcPort, X402RpcReceipt, X402TransferLogs } from "./ports.js";
export type ReadOnlyRpcBatchCall = {
    readonly method: string;
    readonly params: readonly unknown[];
};
export declare class HttpsBaseRpc implements RpcPort, X402RpcPort {
    readonly evm: EvmRpc;
    readonly endpoint: URL;
    readonly rpcOrigin: string;
    private sequence;
    private readonly x402ChainId;
    private pinnedAddresses;
    private readonly totalDeadlineMs;
    constructor(endpoint: string, options?: {
        readonly totalDeadlineMs?: number;
        readonly x402ChainId?: EvmChainId;
    });
    withTotalTimeout(milliseconds: number): X402RpcPort;
    forX402Network(chainId: EvmChainId): HttpsBaseRpc;
    assertX402Chain(chainId: EvmChainId): Promise<{
        readonly chainId: EvmChainId;
        readonly rpcOrigin: string;
    }>;
    assertBaseChain(): Promise<{
        readonly chainId: 8453;
        readonly rpcOrigin: string;
    }>;
    getBalances(address: Address): Promise<BalanceSnapshot>;
    getX402PrepareEvidence(address: Address): Promise<X402PrepareEvidence>;
    getX402Head(tag: "safe" | "finalized"): Promise<X402RpcHead>;
    getX402Block(number: string): Promise<X402RpcBlock>;
    getX402Receipt(transactionHash: Hex): Promise<X402RpcReceipt | null>;
    getX402AuthorizationState(authorizer: Address, nonce: Hex, block: X402BlockReference): Promise<X402AuthorizationState>;
    getX402AuthorizationUsedLogs(input: {
        readonly authorizer: Address;
        readonly nonce: Hex;
        readonly fromBlock: string;
        readonly toBlock: string;
    }): Promise<X402AuthorizationUsedLogs>;
    getX402TransferLogs(input: {
        readonly from: Address;
        readonly fromBlock: string;
        readonly toBlock: string;
    }): Promise<X402TransferLogs>;
    getPendingNonce(address: Address): Promise<string>;
    estimateDirectTransfer(input: {
        readonly from: Address;
        readonly to: Address;
        readonly data: Hex;
    }): Promise<FeeEstimate>;
    estimateTransaction(input: {
        readonly from: Address;
        readonly to: Address;
        readonly data: Hex;
    }): Promise<FeeEstimate>;
    submitRawTransaction(rawTransaction: Hex): Promise<Hex>;
    getReceipt(transactionHash: Hex): Promise<RpcReceipt | null>;
    getLatestConfirmedNonce(address: Address): Promise<string>;
    getConfirmedTransactionAtNonce(address: Address, nonceAtomic: string, startBlockNumberAtomic: string): Promise<Hex | null>;
    coinbaseGaslessCall(method: Parameters<NonNullable<RpcPort["coinbaseGaslessCall"]>>[0], params: readonly unknown[]): Promise<unknown>;
    coinbaseGaslessLogs(filter: Readonly<Record<string, unknown>>): Promise<readonly unknown[]>;
    private call;
    batchCall(calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]>;
    private callX402Logs;
    private resolvePublicAddresses;
    private remainingTimeoutMs;
}
export declare function parseRpcResultEnvelope(raw: string, id: string): unknown;
export declare function parseRpcBatchResultEnvelope(raw: string, ids: readonly number[]): readonly unknown[];
export declare function parseRpcLogEnvelope(raw: string, id: string): {
    readonly kind: "complete";
    readonly value: unknown;
} | {
    readonly kind: "pruned";
} | {
    readonly kind: "range_unavailable";
};
export declare function classifyX402LogAvailabilityMessage(message: string): "pruned" | "range_unavailable" | null;
export { isPublicIp } from "./network-policy.js";
export declare function acceptRpcHttpBody(status: number | undefined, allowJsonRpcClientError: boolean): boolean;
