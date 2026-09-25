import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock, BridgeDeploymentIdentity, BridgeDestinationTransactionProof, BridgeEnvelope, BridgeProtocolReceipt, BridgeTool, BridgeTransaction, BridgeTransactionProof } from "./model.js";
import type { BridgeRpcPort } from "./ports.js";
import type { RpcBatchReadItem, RpcReadSession } from "./rpc-session.js";
export declare class BridgeRpc implements BridgeRpcPort {
    readonly chainId: BridgeChainId;
    readonly origin: string;
    private readonly evm;
    private readonly call;
    private readonly submit;
    private readonly batchCall;
    private commandLatestBlock?;
    private commandPrices?;
    private commandFeeInputs?;
    private readonly preparedEstimates;
    private readonly readSession;
    constructor(chainId: BridgeChainId, origin: string, call: EvmRpcCall, session?: RpcReadSession, oneAttempt?: EvmRpcCall, sessionCall?: (session: RpcReadSession) => EvmRpcCall, sessionBatchCall?: (session: RpcReadSession) => (items: readonly Omit<RpcBatchReadItem, "batchAttempt">[], route?: "primary" | "archive" | "archive_deployment" | "receipt") => Promise<readonly unknown[]>);
    readTelemetry(): import("./rpc-session.js").RpcReadTelemetry | null;
    assertChain(): Promise<void>;
    block(tag: "latest" | "safe" | string): Promise<BridgeBlock>;
    deployment(tool: BridgeTool, peerChainId: BridgeChainId, token: Address, block?: BridgeBlock, exactHashPin?: boolean): Promise<{
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
        peerChainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
        tool: BridgeTool;
        block: BridgeBlock;
        rpcOrigin: string;
        contractHash: string;
        codeHash: string;
        configurationHash: string;
    }>;
    refreshDeployment(tool: BridgeTool, peerChainId: BridgeChainId, token: Address, frozen: BridgeDeploymentIdentity): Promise<{
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
        peerChainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
        tool: BridgeTool;
        block: BridgeBlock;
        rpcOrigin: string;
        contractHash: string;
        codeHash: string;
        configurationHash: string;
    }>;
    /** A native principal's balance is the native balance itself and its allowance is the constant zero: nothing is approved. */
    account(owner: Address, spender: Address, token: Address, planned?: readonly BridgeTransaction[]): Promise<{
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
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
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
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
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
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
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
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
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
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
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
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
        chainId: 1 | 56 | 8453 | 42161 | 59144 | 143;
    })[]>;
    send(raw: Hex): Promise<Hex>;
    private basePinnedFeeValues;
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
