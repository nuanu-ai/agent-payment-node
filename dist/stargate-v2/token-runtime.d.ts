import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Address } from "../model.js";
import type { StateStore } from "../state.js";
import { StargateJsonRpc, confirmedStargateSourceReceipt } from "./native-runtime.js";
import { type StargateTokenDestinationEvidence, type StargateTokenExecutionPorts, type StargateTokenOperation } from "./token-execution.js";
import { type StargateScanCursor } from "./destination-scan.js";
import { type LegacyChainRead, type LegacyStargateStatus } from "../legacy/stargate-v2/status.js";
export declare class StargateTokenService {
    private readonly state;
    private readonly env;
    private readonly now;
    private readonly legacyRpc?;
    private source?;
    private destination?;
    private readonly journal;
    private readonly local;
    private readonly usage;
    constructor(state: StateStore, wrapping: WrappingSecretPort, env: Readonly<Record<string, string | undefined>>, now?: () => number, legacyRpc?: ((url: string) => LegacyChainRead) | undefined);
    prepare(input: Readonly<{
        profile: string;
        amountAtomic: string;
        nativeDropAtomic: string;
        minOutputAtomic: string;
        maxNativeDebitAtomic: string;
        idempotencyKey: string;
        maxFeePerGasWei?: string;
        maxPriorityFeePerGasWei?: string;
    }>): Promise<StargateTokenOperation>;
    execute(id: string): Promise<StargateTokenOperation>;
    cleanup(id: string): Promise<StargateTokenOperation>;
    observe(id: string): Promise<StargateTokenOperation>;
    /** A record of an unreleased token schema (v1..v4) is read by its frozen reader; its status may close it by a chain proof. */
    status(id: string): Promise<StargateTokenOperation | LegacyStargateStatus>;
    receipt(id: string): Promise<Readonly<{
        evidenceHash: string;
        schemaVersion: "apn.stargate-v2-token-receipt.v2";
        operationId: string;
        profile: string;
        route: {
            sourceChainId: number;
            sourceEid: number;
            sourcePool: `0x${string}`;
            sourceToken: `0x${string}`;
            destinationChainId: number;
            destinationEid: number;
            destinationPool: `0x${string}`;
            destinationToken: `0x${string}`;
        };
        owner: `0x${string}`;
        recipient: `0x${string}`;
        principalAtomic: string;
        minimumOutputAtomic: string;
        nativeDropAtomic: string;
        nativeMessageFeeAtomic: string;
        maximumDebitAtomic: string;
        options: `0x${string}`;
        executor: `0x${string}`;
        executorNativeCapAtomic: string;
        policy: import("./token-model.js").StargateTokenPolicyBinding;
        finalityPolicy: import("./finality-policy.js").StargateV2RouteFinalityPolicy;
        quoteHash: string;
        quoteLifecycle: {
            ownerApprovedMinimumOutputAtomic: string;
            ownerApprovedMaximumQuoteLossAtomic: string;
            initialQuotedOutputAtomic: string;
            initialQuotedNativeMessageFeeAtomic: string;
            prepareQuoteHash: string;
            prepareExpiresAt: string;
            approvalFinalityWindowMs: number;
            approvalSubmissionStartedAt: string | null;
            approvalFinalityDeadline: string | null;
            postApprovalQuoteHash: string | null;
            postApprovalQuoteBlock: Readonly<{
                readonly numberAtomic: string;
                readonly hash: Hex;
            }> | null;
            postApprovalQuoteExpiresAt: string | null;
            postApprovalQuotedOutputAtomic: string | null;
            postApprovalQuotedNativeMessageFeeAtomic: string | null;
        };
        feeApproval: Readonly<{
            readonly provenance: "exact_snapshot" | "owner_ceiling";
            readonly quotedMaxFeePerGasWei: string;
            readonly quotedMaxPriorityFeePerGasWei: string;
            readonly approvedMaxFeePerGasWei: string;
            readonly approvedMaxPriorityFeePerGasWei: string;
        }>;
        bridgeSimulation: Readonly<{
            readonly mode: "exact_at_prepare" | "pending_post_approval";
            readonly prepareStatus: "succeeded" | "pending_post_approval";
            readonly gasCeilingAtomic: string;
        }>;
        approvalTransactionHash: `0x${string}` | null;
        residualAllowanceAtomic: string;
        source: import("./token-model.js").StargateTokenSourceReceipt;
        destination: StargateTokenDestinationEvidence;
    }>>;
    private reconciled;
    private required;
    private ports;
    private reserveUsage;
    private followUsage;
    private remote;
}
/** BRDG-31: the source proof is the pinned pool's OFTSent and the endpoint's PacketSent naming the pinned TokenMessaging as
 * sender (checked in sourceReceipt); TokenMessaging's runtime code is not re-read after the send. */
export declare function confirmedStargateTokenSourceReceipt(rpc: Pick<StargateJsonRpc, "call">, transactionHash: Hex, finalityTag: Parameters<typeof confirmedStargateSourceReceipt>[2]): Promise<import("./native-execution.js").StargateConfirmedReceipt | null>;
/** BRDG-30/31: the GUID- and recipient-filtered OFTReceived from the pinned pool, found by a resumable windowed scan, at
 * the destination finality head, is the delivery proof; PacketDelivered (and the native drop when the Executor applied it
 * in the same transaction) come from that transaction's receipt, so a redelivery by any caller still proves it. */
export declare function observeStargateTokenDestination(rpc: Pick<StargateJsonRpc, "call">, input: Parameters<StargateTokenExecutionPorts["observeDestination"]>[0], tokenAt?: (rpc: StargateJsonRpc, token: Address, account: Address, tag: string) => Promise<bigint>, cursor?: StargateScanCursor): Promise<StargateTokenDestinationEvidence | null>;
