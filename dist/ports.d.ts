import type { Address, Hex } from "./model.js";
import type { EvmRpcPort, EvmTransferEvidence } from "./evm-ports.js";
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
    readonly operation: "wallet.describe" | "wallet.ensure" | "wallet.import" | "directTransfer.approveAndSign" | "effectMaterial.get" | "directTransfer.signedMaterial.get" | "x402Exact.approveAndAuthorize" | "x402Exact.authorizationMaterial.get";
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
    /** The selected token's balance (the name predates tokens other than USDC). */
    readonly usdcAtomic: string;
    /** keccak(domain(name, version, chainId, token)): binds the seller's name and version without reading them. */
    readonly domainSeparator: Hex;
    readonly rpcOriginHash: string;
    readonly observedAt: string;
    /** The operation's proof tag: `safe` on the released chains, `finalized` elsewhere. */
    readonly queriedTag: "safe" | "finalized";
    /**
     * Read in the same pinned batch for every token other than the released USDC pairs: `decimals()` and
     * `authorizationState(payer, nonce)` of the fresh nonce, which an EIP-3009 token answers with a canonical false.
     */
    readonly tokenFacts?: {
        readonly decimals: number;
        readonly nonceUnused: true;
    };
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
    readonly evmEvidence?: EvmTransferEvidence;
    readonly transactionHash: Hex;
    readonly status: "success" | "reverted";
    readonly blockNumberAtomic: string;
    readonly blockHash?: Hex;
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
    /** Timestamp of the block the state was read at; it proves when an EIP-3009 validBefore has passed. */
    readonly blockTimestamp: string;
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
    assertX402Chain?(chainId: number): Promise<{
        readonly chainId: number;
        readonly rpcOrigin: string;
    }>;
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
        /** Optional recipient topic, so a busy payer's other transfers neither count against nor overflow the log bound. */
        readonly to?: Address;
        readonly fromBlock: string;
        readonly toBlock: string;
    }): Promise<X402TransferLogs>;
}
export interface RpcPort {
    /** Arm the command-scoped public BNB transport cap before any direct BNB network read. */
    /** Arms this command's physical POST cap; a direct EVM step passes the cap derived from its read plan. */
    armEvmDirectRpcGuard?(maxPhysicalRequests?: number): void;
    /** The same endpoint bound to one x402 network and token; its eth_chainId must later prove the chain. */
    forX402Network?(chainId: number, token: Address): RpcPort & X402RpcPort;
    readonly evm?: EvmRpcPort;
    assertBaseChain(): Promise<{
        readonly chainId: 8453;
        readonly rpcOrigin: string;
    }>;
    getBalances(address: Address): Promise<BalanceSnapshot>;
    /** `nonce` is the fresh authorization nonce; it is probed only for tokens outside the released USDC pairs. */
    getX402PrepareEvidence(address: Address, nonce?: Hex): Promise<X402PrepareEvidence>;
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
    /** Bounded read-only Base RPC used by the Coinbase gasless observer. */
    coinbaseGaslessCall?(method: "eth_chainId" | "eth_getTransactionCount" | "eth_getBlockByNumber" | "eth_getBalance" | "eth_getCode" | "eth_getStorageAt" | "eth_call" | "eth_getTransactionByHash" | "eth_getTransactionReceipt", params: readonly unknown[]): Promise<unknown>;
    coinbaseGaslessLogs?(filter: Readonly<Record<string, unknown>>): Promise<readonly unknown[]>;
}
