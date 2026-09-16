import type { EvmChainId } from "../evm-asset.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address, Hex } from "../model.js";
import type { BridgeBlock, BridgeEnvelope, BridgeProtocolReceipt, BridgeTool, BridgeTransaction, BridgeTransactionProof } from "./model.js";
import type { BridgeRpcFactory, BridgeRpcPort } from "./ports.js";
export declare const BRIDGE_RPC_ENV: {
    readonly 1: "APN_ETHEREUM_RPC_URL";
    readonly 8453: "APN_BASE_RPC_URL";
    readonly 42161: "APN_ARBITRUM_RPC_URL";
};
export declare function bridgeRpcFactory(environment: Readonly<Record<string, string | undefined>>): BridgeRpcFactory;
export declare class BridgeRpc implements BridgeRpcPort {
    readonly chainId: EvmChainId;
    readonly origin: string;
    private readonly call;
    private readonly evm;
    constructor(chainId: EvmChainId, origin: string, call: EvmRpcCall);
    assertChain(): Promise<void>;
    block(tag: "latest" | "safe" | string): Promise<BridgeBlock>;
    deployment(tool: BridgeTool, peerChainId: EvmChainId, token: Address, block?: BridgeBlock): Promise<{
        chainId: 1 | 8453 | 42161;
        peerChainId: 1 | 8453 | 42161;
        tool: BridgeTool;
        block: BridgeBlock;
        rpcOrigin: string;
        contractHash: string;
        codeHash: string;
        configurationHash: string;
    }>;
    account(owner: Address, spender: Address, token: Address): Promise<{
        chainId: 1 | 8453 | 42161;
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
    prices(): Promise<{
        maxFeePerGasAtomic: string;
        maxPriorityFeePerGasAtomic: string;
    }>;
    estimate(transaction: BridgeTransaction): Promise<import("../ports.js").FeeEstimate>;
    feeQuote(envelope: Pick<BridgeEnvelope, "economics">): Promise<import("../evm-ports.js").EvmFeeQuote>;
    send(raw: Hex): Promise<Hex>;
    observe(hash: Hex, expected?: BridgeEnvelope): Promise<{
        transaction: BridgeTransactionProof;
        receipt: BridgeProtocolReceipt;
    } | null>;
    logs(input: Parameters<BridgeRpcPort["logs"]>[0]): Promise<{
        transactionHash: `0x${string}`;
        blockNumberAtomic: string;
        blockHash: `0x${string}`;
    }[]>;
    private recheck;
}
