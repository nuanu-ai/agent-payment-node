import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Address } from "../model.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "../lifi/https.js";
import { type StargateConfirmedReceipt, type StargateNativeExecutionPorts, type StargatePreparedEnvelopeEvidence, type StargateNativeOperation } from "./native-execution.js";
import { type StargateScanCursor } from "./destination-scan.js";
import { type LegacyChainRead, type LegacyStargateStatus } from "../legacy/stargate-v2/status.js";
export type StargateRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getBalance" | "eth_getTransactionCount" | "eth_getCode" | "eth_call" | "eth_estimateGas" | "eth_maxPriorityFeePerGas" | "eth_sendRawTransaction" | "eth_getTransactionReceipt" | "eth_getTransactionByHash" | "eth_getLogs";
export declare class StargateJsonRpc {
    private readonly https;
    private sequence;
    readonly origin: string;
    private readonly endpoint;
    constructor(url: string, https?: Pick<BridgeHttps, "request">);
    batchCall(calls: readonly {
        readonly method: string;
        readonly params: readonly unknown[];
    }[]): Promise<readonly unknown[]>;
    call(method: string, params: readonly unknown[]): Promise<unknown>;
}
/** The source envelope reads: chain, head and balance first, so an unfunded known value is refused before eth_estimateGas. */
export declare function stargateNativeEnvelope(source: Pick<StargateJsonRpc, "call" | "batchCall">, sourceCall: (method: string, params: readonly unknown[]) => Promise<unknown>, prepareBatch: boolean, tx: Parameters<StargateNativeExecutionPorts["prepareEnvelope"]>[0]): Promise<StargatePreparedEnvelopeEvidence>;
export declare class StargateNativeService {
    private readonly state;
    private readonly environment;
    private readonly now;
    private readonly legacyRpc?;
    private source?;
    private destination?;
    private readonly journal;
    private readonly local;
    private readonly usage;
    constructor(state: StateStore, wrapping: WrappingSecretPort, environment: Readonly<Record<string, string | undefined>>, now?: () => number, legacyRpc?: ((url: string) => LegacyChainRead) | undefined);
    prepare(input: Readonly<{
        profile: string;
        amountAtomic: string;
        maxNativeDebitAtomic: string;
        idempotencyKey: string;
    }>): Promise<StargateNativeOperation>;
    execute(operationId: string): Promise<StargateNativeOperation>;
    observe(operationId: string): Promise<StargateNativeOperation>;
    /** A record of the unreleased native schema v1 is read by its frozen reader; its status may close it by a chain proof. */
    status(operationId: string): Promise<StargateNativeOperation | LegacyStargateStatus>;
    receipt(operationId: string): Promise<import("./native-record.js").StargateNativeCanonicalReceipt>;
    private required;
    private ports;
    private remote;
}
export declare function stargateDestinationBalance(rpc: Pick<StargateJsonRpc, "call">, recipient: Address, finalityTag: Parameters<StargateNativeExecutionPorts["destinationBalance"]>[1]): Promise<{
    balanceAtomic: string;
    blockNumberAtomic: string;
    blockHash: `0x${string}`;
}>;
export declare function confirmedStargateSourceReceipt(rpc: Pick<StargateJsonRpc, "call">, transactionHash: Hex, finalityTag: StargateConfirmedReceipt["finality"]): Promise<StargateConfirmedReceipt | null>;
/** BRDG-30: the GUID- and recipient-filtered OFTReceived is found by a resumable windowed scan up to the finality head,
 * never one ever-growing range from the prepare block. */
export declare function observeStargateDestination(rpc: Pick<StargateJsonRpc, "call">, input: Parameters<StargateNativeExecutionPorts["observeDestination"]>[0], cursor?: StargateScanCursor): Promise<{
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
