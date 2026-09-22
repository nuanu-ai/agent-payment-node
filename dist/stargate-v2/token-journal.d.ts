import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import type { StargateTokenJournal, StargateTokenOperation, StargateTokenPhase } from "./token-model.js";
export declare class FileStargateTokenJournal implements StargateTokenJournal {
    private readonly root;
    private readonly locks;
    constructor(root: string, locks?: Pick<StateStore, "initialize" | "withLocks">);
    private path;
    withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
    withOwnerChainLock<T>(owner: Address, chainId: number, work: () => Promise<T>): Promise<T>;
    load(id: string): Promise<StargateTokenOperation | null>;
    save(nextInput: StargateTokenOperation): Promise<void>;
}
export declare function transition(op: StargateTokenOperation | Omit<StargateTokenOperation, "integrityHash">, phase: StargateTokenPhase, reason: string, at: number): StargateTokenOperation;
export declare function seal(value: Omit<StargateTokenOperation, "integrityHash"> | StargateTokenOperation): StargateTokenOperation;
export declare function validateRecord(value: unknown): StargateTokenOperation;
export declare function stargateV2TokenCanonicalReceipt(input: StargateTokenOperation): Readonly<{
    evidenceHash: string;
    feeApproval: Readonly<{
        readonly provenance: "exact_snapshot" | "owner_ceiling";
        readonly quotedMaxFeePerGasWei: string;
        readonly quotedMaxPriorityFeePerGasWei: string;
        readonly approvedMaxFeePerGasWei: string;
        readonly approvedMaxPriorityFeePerGasWei: string;
    }> | {
        provenance: "legacy_exact_snapshot";
        quotedMaxFeePerGasWei: string;
        quotedMaxPriorityFeePerGasWei: string;
        approvedMaxFeePerGasWei: string;
        approvedMaxPriorityFeePerGasWei: string;
    };
    bridgeSimulation: Readonly<{
        readonly mode: "exact_at_prepare" | "pending_post_approval";
        readonly prepareStatus: "succeeded" | "pending_post_approval";
        readonly gasCeilingAtomic: string;
    }> | {
        mode: "legacy_exact_at_prepare";
        prepareStatus: "legacy_succeeded";
        gasCeilingAtomic: string;
    };
    approvalTransactionHash: `0x${string}` | null;
    residualAllowanceAtomic: string;
    source: import("./token-model.js").StargateTokenSourceReceipt;
    destination: import("./token-model.js").StargateTokenDestinationEvidence;
    quoteLifecycle?: {
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
            readonly hash: import("viem").Hex;
        }> | null;
        postApprovalQuoteExpiresAt: string | null;
        postApprovalQuotedOutputAtomic: string | null;
        postApprovalQuotedNativeMessageFeeAtomic: string | null;
    };
    schemaVersion: "apn.stargate-v2-token-receipt.v2" | "apn.stargate-v2-token-receipt.v1";
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
}>;
