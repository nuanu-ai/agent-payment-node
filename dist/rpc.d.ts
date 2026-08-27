import type { Address, Hex } from "./model.js";
import type { BalanceSnapshot, FeeEstimate, RpcPort, RpcReceipt, X402AuthorizationState, X402AuthorizationUsedLogs, X402BlockReference, X402PrepareEvidence, X402RpcBlock, X402RpcHead, X402RpcPort, X402RpcReceipt } from "./ports.js";
export declare class HttpsBaseRpc implements RpcPort, X402RpcPort {
    readonly endpoint: URL;
    readonly rpcOrigin: string;
    private sequence;
    private pinnedAddresses;
    constructor(endpoint: string);
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
    getPendingNonce(address: Address): Promise<string>;
    estimateDirectTransfer(input: {
        readonly from: Address;
        readonly to: Address;
        readonly data: Hex;
    }): Promise<FeeEstimate>;
    submitRawTransaction(rawTransaction: Hex): Promise<Hex>;
    getReceipt(transactionHash: Hex): Promise<RpcReceipt | null>;
    getLatestConfirmedNonce(address: Address): Promise<string>;
    getConfirmedTransactionAtNonce(address: Address, nonceAtomic: string, startBlockNumberAtomic: string): Promise<Hex | null>;
    private call;
    private callX402Logs;
    private resolvePublicAddresses;
}
export declare function classifyX402LogAvailabilityMessage(message: string): "pruned" | "range_unavailable" | null;
export { isPublicIp } from "./network-policy.js";
