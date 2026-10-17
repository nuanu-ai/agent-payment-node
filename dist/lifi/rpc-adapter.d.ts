import { type BridgeAuthorityCheck } from "./effect-authority.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock, BridgeDestinationTransactionProof, BridgeEnvelope, BridgeProtocolReceipt, BridgeTool, BridgeTransaction, BridgeTransactionProof } from "./model.js";
import type { BridgeObservationOptions, BridgeRpcPort } from "./ports.js";
import { type BridgeBatchCall } from "./rpc-observation.js";
import type { RpcReadSession } from "./rpc-session.js";
/**
 * The LI.FI rail's EVM reader. Every read is a planned JSON-RPC batch through the command session: one chain identity per
 * endpoint and session, mutable state at the moving head the transaction will execute against, inclusion proofs pinned to
 * block hashes. A transport without batches (a single-request `call`) reads the same planned items one by one.
 */
export declare class BridgeRpc implements BridgeRpcPort {
    readonly chainId: BridgeChainId;
    readonly origin: string;
    private readonly call;
    private readonly submit;
    private readonly batchCall;
    private readonly receipts;
    private commandLatestBlock?;
    private commandPrices?;
    private commandFeeInputs?;
    private readonly preparedEstimates;
    private readonly readSession;
    constructor(chainId: BridgeChainId, origin: string, call: EvmRpcCall, session?: RpcReadSession, oneAttempt?: EvmRpcCall, sessionCall?: (session: RpcReadSession) => EvmRpcCall, sessionBatchCall?: (session: RpcReadSession) => BridgeBatchCall, receipts?: Readonly<{
        reader: boolean;
        fallback: boolean;
    }>);
    readTelemetry(): import("./rpc-session.js").RpcReadTelemetry | null;
    assertChain(): Promise<void>;
    block(tag: "latest" | "safe" | string): Promise<BridgeBlock>;
    /** The light deployment check of one role at the moving head, with that head: one POST. */
    deploymentCheck(tool: BridgeTool, peerChainId: BridgeChainId, token: Address, role: "source" | "destination"): Promise<import("./model.js").BridgeDeploymentIdentity>;
    /** The source deployment check and the account snapshot in the same POST, at the same moving head. */
    checkedAccount(check: Readonly<{
        tool: BridgeTool;
        peerChainId: BridgeChainId;
    }>, owner: Address, spender: Address, token: Address, planned?: readonly BridgeTransaction[]): Promise<{
        account: {
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
        };
        deployment: import("./model.js").BridgeDeploymentIdentity;
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
    /**
     * One POST at the moving head: approval inclusion and foreground consent can change the account within one invocation,
     * so nothing here is cached and each guard predicate stands on its own answer. Prices, Base fee inputs and the planned
     * estimates are kept for this command so the envelope and fee quotes reuse them instead of reading again.
     */
    private readAccount;
    prices(): Promise<Readonly<{
        maxFeePerGasAtomic: string;
        maxPriorityFeePerGasAtomic: string;
    }>>;
    estimate(transaction: BridgeTransaction): Promise<{
        maxFeePerGasAtomic: string;
        maxPriorityFeePerGasAtomic: string;
        gasLimitAtomic: string;
    }>;
    feeQuote(envelope: Pick<BridgeEnvelope, "economics">): Promise<{
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
    feeQuotes(envelopes: readonly Pick<BridgeEnvelope, "economics">[]): Promise<({
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
    send(raw: Hex, beforeSend?: BridgeAuthorityCheck): Promise<Hex>;
    observe(hash: Hex, expected?: BridgeEnvelope, nativeDelivery?: Parameters<BridgeRpcPort["observe"]>[2], options?: BridgeObservationOptions): Promise<{
        transaction: BridgeTransactionProof;
        receipt: BridgeProtocolReceipt;
    } | null>;
    observeDestination(hash: Hex, nativeDelivery?: Parameters<NonNullable<BridgeRpcPort["observeDestination"]>>[1], options?: BridgeObservationOptions): Promise<{
        transaction: BridgeDestinationTransactionProof;
        receipt: BridgeProtocolReceipt;
    } | null>;
    private observation;
}
