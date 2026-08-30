import type { Address, Hex } from "./model.js";
export type { HttpGetRequest, HttpObservation, HttpPort } from "./x402-model.js";
export interface ClockPort {
    now(): Date;
}
export interface IdPort {
    next(): string;
}
export interface WaitPort {
    nowMs(): number;
    wait(milliseconds: number): Promise<"elapsed" | "interrupted">;
}
export interface NativeRequest {
    readonly version: "apn.native.v1";
    readonly requestId: string;
    readonly operation: "wallet.describe" | "wallet.ensure" | "directTransfer.approveAndSign" | "effectMaterial.get" | "x402Exact.approveAndAuthorize" | "x402Exact.authorizationMaterial.get";
    readonly payload: Readonly<Record<string, unknown>>;
}
export interface NativePort {
    request(request: NativeRequest): Promise<unknown>;
}
export interface RpcProvenance {
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly observedAt: string;
    readonly rpcOrigin: string;
}
export interface BalanceSnapshot extends RpcProvenance {
    readonly address: Address;
    readonly ethAtomic: string;
    readonly usdcAtomic: string;
}
export interface FeeEstimate {
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
}
export interface X402PrepareEvidence {
    readonly address: Address;
    readonly usdcAtomic: string;
    readonly tokenName: string;
    readonly tokenVersion: string;
    readonly domainSeparator: Hex;
    readonly rpcOriginHash: string;
    readonly observedAt: string;
    readonly queriedTag: "safe";
    readonly block: {
        readonly number: string;
        readonly hash: Hex;
        readonly timestamp: string;
    };
}
export interface RpcLog {
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
}
export interface RpcReceipt {
    readonly transactionHash: Hex;
    readonly status: "success" | "reverted";
    readonly blockNumberAtomic: string;
    readonly logs: readonly RpcLog[];
    readonly observedAt: string;
    readonly rpcOrigin: string;
}
export interface X402RpcHead {
    readonly queriedTag: "safe" | "finalized";
    readonly number: string;
    readonly hash: Hex;
    readonly timestamp: string;
    readonly observedAt: string;
    readonly rpcOrigin: string;
}
export interface X402RpcBlock {
    readonly queriedTag: "number";
    readonly number: string;
    readonly hash: Hex;
    readonly timestamp: string;
    readonly observedAt: string;
    readonly rpcOrigin: string;
}
export interface X402RpcLog {
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly transactionHash: Hex;
    readonly logIndex: string;
}
export interface X402RpcReceipt {
    readonly transactionHash: Hex;
    readonly status: "success" | "reverted";
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly logs: readonly X402RpcLog[];
    readonly observedAt: string;
    readonly rpcOrigin: string;
}
export type X402BlockReference = {
    readonly tag: "safe" | "finalized";
} | {
    readonly number: string;
};
export interface X402AuthorizationState {
    readonly value: boolean;
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly blockTag: "safe" | "finalized" | "number";
    readonly observedAt: string;
    readonly rpcOrigin: string;
}
export type X402AuthorizationUsedLogs = {
    readonly kind: "complete";
    readonly logs: readonly X402RpcLog[];
} | {
    readonly kind: "pruned";
} | {
    readonly kind: "range_unavailable";
};
export type X402TransferLogs = {
    readonly kind: "complete";
    readonly logs: readonly X402RpcLog[];
} | {
    readonly kind: "pruned";
} | {
    readonly kind: "range_unavailable";
};
/** Read-only x402 RPC surface. It intentionally has no transaction submission method. */
export interface X402RpcPort {
    withTotalTimeout?(milliseconds: number): X402RpcPort;
    assertBaseChain(): Promise<{
        readonly chainId: 8453;
        readonly rpcOrigin: string;
    }>;
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
}
export interface RpcPort {
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
}
