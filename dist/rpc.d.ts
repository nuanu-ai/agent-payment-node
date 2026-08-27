import type { Address, Hex } from "./model.js";
import type { BalanceSnapshot, FeeEstimate, RpcPort, RpcReceipt, X402PrepareEvidence } from "./ports.js";
export declare class HttpsBaseRpc implements RpcPort {
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
    private resolvePublicAddresses;
}
export { isPublicIp } from "./network-policy.js";
