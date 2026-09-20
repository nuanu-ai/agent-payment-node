import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "../lifi/https.js";
import { type StargateConfirmedReceipt, type StargateNativeExecutionPorts, type StargateNativeOperation } from "./native-execution.js";
export type StargateRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getBalance" | "eth_getTransactionCount" | "eth_getCode" | "eth_call" | "eth_estimateGas" | "eth_maxPriorityFeePerGas" | "eth_sendRawTransaction" | "eth_getTransactionReceipt" | "eth_getTransactionByHash" | "eth_getLogs";
export declare class StargateJsonRpc {
    private readonly https;
    private sequence;
    readonly origin: string;
    private readonly endpoint;
    constructor(url: string, https?: Pick<BridgeHttps, "request">);
    call(method: string, params: readonly unknown[]): Promise<unknown>;
}
export declare class StargateNativeService {
    private readonly state;
    private readonly environment;
    private readonly now;
    private source?;
    private destination?;
    private readonly journal;
    private readonly local;
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, now?: () => number);
    prepare(input: Readonly<{
        profile: string;
        amountAtomic: string;
        maxNativeDebitAtomic: string;
        idempotencyKey: string;
    }>): Promise<StargateNativeOperation>;
    execute(operationId: string): Promise<StargateNativeOperation>;
    observe(operationId: string): Promise<StargateNativeOperation>;
    status(operationId: string): Promise<StargateNativeOperation>;
    receipt(operationId: string): Promise<import("./native-execution.js").StargateNativeCanonicalReceipt>;
    private required;
    private ports;
    private remote;
}
export declare function confirmedStargateSourceReceipt(rpc: Pick<StargateJsonRpc, "call">, transactionHash: Hex, finalityTag: StargateConfirmedReceipt["finality"]): Promise<StargateConfirmedReceipt | null>;
export declare function observeStargateDestination(rpc: Pick<StargateJsonRpc, "call">, input: Parameters<StargateNativeExecutionPorts["observeDestination"]>[0]): Promise<{
    mode: "oft_received";
    emitter: `0x${string}`;
    sourceTransactionHash: `0x${string}`;
    guid: `0x${string}`;
    sourceEid: 30101;
    recipient: `0x${string}`;
    destinationTransactionHash: `0x${string}`;
    logIndexAtomic: string;
    amountReceivedAtomic: string;
    blockNumberAtomic: string;
    blockHash: `0x${string}`;
    finality: import("./finality-policy.js").StargateV2FinalityTag;
    balanceBeforeAtomic?: never;
    balanceAfterAtomic?: never;
    deltaAtomic?: never;
} | {
    mode: "balance_delta";
    recipient: `0x${string}`;
    balanceBeforeAtomic: string;
    balanceAfterAtomic: string;
    deltaAtomic: string;
    blockNumberAtomic: string;
    blockHash: `0x${string}`;
    finality: import("./finality-policy.js").StargateV2FinalityTag;
    emitter?: never;
    sourceTransactionHash?: never;
    guid?: never;
    sourceEid?: never;
    destinationTransactionHash?: never;
    logIndexAtomic?: never;
    amountReceivedAtomic?: never;
} | null>;
