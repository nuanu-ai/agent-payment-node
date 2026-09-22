import type { BridgeChainId } from "./chains.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import { BridgeHttps } from "./https.js";
import type { BridgeBlock, BridgeDestinationTransactionProof, BridgeEnvelope, BridgeProtocolReceipt, BridgeTool, BridgeTransaction, BridgeTransactionProof } from "./model.js";
import type { BridgeRpcFactory, BridgeRpcPort } from "./ports.js";
import { RpcReadSession, type RpcBatchReadItem } from "./rpc-session.js";
export { RpcReadSession } from "./rpc-session.js";
export type { RpcBatchReadItem, RpcReadSessionOptions, RpcReadTelemetry } from "./rpc-session.js";
export declare const BRIDGE_RPC_ENV: {
    readonly 1: "APN_ETHEREUM_RPC_URL";
    readonly 56: "APN_BNB_RPC_URL";
    readonly 8453: "APN_BASE_RPC_URL";
    readonly 143: "APN_MONAD_RPC_URL";
    readonly 42161: "APN_ARBITRUM_RPC_URL";
    readonly 59144: "APN_LINEA_RPC_URL";
};
export declare function bridgeRpcCall(chainId: BridgeChainId, environment: Readonly<Record<string, string | undefined>>, options?: {
    readonly transport?: Pick<BridgeHttps, "request">;
    readonly wait?: (milliseconds: number) => Promise<void>;
}): {
    readonly origin: string;
    readonly call: EvmRpcCall;
    readonly attempt: EvmRpcCall;
    readonly sessionCall: (session: RpcReadSession) => EvmRpcCall;
    readonly sessionBatchCall: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment" | "receipt") => Promise<readonly unknown[]>;
};
export declare function bridgeRpcFactory(environment: Readonly<Record<string, string | undefined>>, options?: {
    readonly transport?: Pick<BridgeHttps, "request">;
    readonly wait?: (milliseconds: number) => Promise<void>;
}): BridgeRpcFactory;
export declare class BridgeRpc implements BridgeRpcPort {
    readonly chainId: BridgeChainId;
    readonly origin: string;
    private readonly evm;
    private readonly call;
    private readonly batchCall;
    private commandLatestBlock?;
    private commandPrices?;
    private commandFeeInputs?;
    private readonly preparedEstimates;
    constructor(chainId: BridgeChainId, origin: string, call: EvmRpcCall, session?: RpcReadSession, oneAttempt?: EvmRpcCall, sessionCall?: (session: RpcReadSession) => EvmRpcCall, sessionBatchCall?: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment" | "receipt") => Promise<readonly unknown[]>);
    assertChain(): Promise<void>;
    block(tag: "latest" | "safe" | string): Promise<BridgeBlock>;
    deployment(tool: BridgeTool, peerChainId: BridgeChainId, token: Address, block?: BridgeBlock): Promise<{
        chainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
        peerChainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
        tool: BridgeTool;
        block: BridgeBlock;
        rpcOrigin: string;
        contractHash: string;
        codeHash: string;
        configurationHash: string;
    }>;
    /** A native principal's balance is the native balance itself and its allowance is the constant zero: nothing is approved. */
    account(owner: Address, spender: Address, token: Address, planned?: readonly BridgeTransaction[]): Promise<{
        chainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
        rpcOrigin: string;
        block: BridgeBlock;
        owner: `0x${string}`;
        token: `0x${string}`;
        spender: `0x${string}`;
        balanceAtomic: string;
        nativeBalanceWei: string;
        allowanceAtomic: string;
        latestNonceAtomic: string;
        pendingNonceAtomic: string;
    }>;
    prices(): Promise<Readonly<{
        maxFeePerGasAtomic: string;
        maxPriorityFeePerGasAtomic: string;
    }>>;
    estimate(transaction: BridgeTransaction): Promise<import("../ports.js").FeeEstimate>;
    feeQuote(envelope: Pick<BridgeEnvelope, "economics">): Promise<import("../evm-ports.js").EvmFeeQuote | {
        l1DataFeeUpperWei: string;
        operatorFeeUpperWei: string;
        maximumExecutionFeeWei: string;
        totalQuoteWei: string;
        totalFeeEnforcedOnchain: false;
        blockNumberAtomic: string;
        blockHash: `0x${string}`;
        rpcOrigin: string;
        observedAt: string;
        feeModel: "arbitrum-inclusive";
        chainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
    } | {
        l1DataFeeUpperWei: string;
        operatorFeeUpperWei: string;
        maximumExecutionFeeWei: string;
        totalQuoteWei: string;
        totalFeeEnforcedOnchain: false;
        blockNumberAtomic: string;
        blockHash: `0x${string}`;
        rpcOrigin: string;
        observedAt: string;
        feeModel: "monad-gas-limit";
        chainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
    } | {
        l1DataFeeUpperWei: string;
        operatorFeeUpperWei: string;
        maximumExecutionFeeWei: string;
        totalQuoteWei: string;
        totalFeeEnforcedOnchain: false;
        blockNumberAtomic: string;
        blockHash: `0x${string}`;
        rpcOrigin: string;
        observedAt: string;
        chainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
    }>;
    feeQuotes(envelopes: readonly Pick<BridgeEnvelope, "economics">[]): Promise<import("../evm-ports.js").EvmFeeQuote[] | ({
        l1DataFeeUpperWei: string;
        operatorFeeUpperWei: string;
        maximumExecutionFeeWei: string;
        totalQuoteWei: string;
        totalFeeEnforcedOnchain: false;
        blockNumberAtomic: string;
        blockHash: `0x${string}`;
        rpcOrigin: string;
        observedAt: string;
        feeModel: "arbitrum-inclusive";
        chainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
    } | {
        l1DataFeeUpperWei: string;
        operatorFeeUpperWei: string;
        maximumExecutionFeeWei: string;
        totalQuoteWei: string;
        totalFeeEnforcedOnchain: false;
        blockNumberAtomic: string;
        blockHash: `0x${string}`;
        rpcOrigin: string;
        observedAt: string;
        feeModel: "monad-gas-limit";
        chainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
    } | {
        l1DataFeeUpperWei: string;
        operatorFeeUpperWei: string;
        maximumExecutionFeeWei: string;
        totalQuoteWei: string;
        totalFeeEnforcedOnchain: false;
        blockNumberAtomic: string;
        blockHash: `0x${string}`;
        rpcOrigin: string;
        observedAt: string;
        chainId: 1 | 8453 | 42161 | 56 | 59144 | 143;
    })[]>;
    send(raw: Hex): Promise<Hex>;
    observe(hash: Hex, expected?: BridgeEnvelope, nativeDelivery?: Parameters<BridgeRpcPort["observe"]>[2]): Promise<{
        transaction: BridgeTransactionProof;
        receipt: BridgeProtocolReceipt;
    } | null>;
    observeDestination(hash: Hex, nativeDelivery?: Parameters<NonNullable<BridgeRpcPort["observeDestination"]>>[1]): Promise<{
        transaction: BridgeDestinationTransactionProof;
        receipt: BridgeProtocolReceipt;
    } | null>;
    private observeCanonical;
    private recheck;
}
