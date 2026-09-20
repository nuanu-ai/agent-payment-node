import { type Hex } from "viem";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import { type StargateV2FinalityPolicyProvenance, type StargateV2FinalityTag, type StargateV2RouteFinalityPolicy } from "./finality-policy.js";
import { type StargateV2QuoteEvidence } from "./quote.js";
export declare const STARGATE_TOKEN_SOURCE_CHAIN: 10;
export declare const STARGATE_TOKEN_DESTINATION_CHAIN: 137;
export declare const STARGATE_TOKEN_SOURCE_EID: 30111;
export declare const STARGATE_TOKEN_DESTINATION_EID: 30109;
export declare const STARGATE_TOKEN_SOURCE_TOKEN: `0x${string}`;
export declare const STARGATE_TOKEN_DESTINATION_TOKEN: `0x${string}`;
export declare const STARGATE_TOKEN_SOURCE_POOL: `0x${string}`;
export declare const STARGATE_TOKEN_DESTINATION_POOL: `0x${string}`;
/** Official LayerZero Optimism mainnet Executor at lz-address-book commit 7c800d6. */
export declare const STARGATE_TOKEN_SOURCE_EXECUTOR: `0x${string}`;
export declare const STARGATE_TOKEN_DESTINATION_EXECUTOR: `0x${string}`;
export declare const LAYERZERO_ENDPOINT_V2: `0x${string}`;
export declare const STARGATE_TOKEN_SOURCE_MESSAGING: `0x${string}`;
export declare const STARGATE_TOKEN_DESTINATION_MESSAGING: `0x${string}`;
export declare const STARGATE_TOKEN_SOURCE_MESSAGING_CODE_HASH: Hex;
export declare const STARGATE_TOKEN_DESTINATION_MESSAGING_CODE_HASH: Hex;
export declare const STARGATE_TOKEN_MECHANISM: Readonly<{
    provider: "stargate-v2";
    reference: `eip155:10:0x${string}/eip155:137:0x${string}`;
}>;
export declare const STARGATE_TOKEN_APPROVAL_FINALITY_WINDOW_MS: number;
export declare const STARGATE_TOKEN_POST_APPROVAL_QUOTE_TTL_MS = 60000;
export declare const STARGATE_TOKEN_MAX_BRIDGE_GAS = 5000000n;
/** Exact OptionsBuilder.addExecutorNativeDropOption Type-3 wire encoding. */
export declare function encodeStargateNativeDrop(amountInput: string, recipientInput: Address): Hex;
export type StargateTokenPhase = "prepared" | "approved" | "allowance_submission_started" | "allowance_unknown_finality" | "allowance_submitted" | "allowance_observed" | "post_approval_quote_bound" | "submission_started" | "unknown_finality" | "submitted" | "observed" | "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned";
export type StargateTokenUsageState = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert";
export interface StargateTokenTransition {
    readonly phase: StargateTokenPhase;
    readonly at: string;
    readonly reason: string;
}
export interface StargateTokenEnvelope {
    readonly chainId: 10;
    readonly from: Address;
    readonly to: Address;
    readonly data: Hex;
    readonly valueAtomic: string;
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
}
export interface StargateTokenPacketBinding {
    readonly srcEid: 30111;
    readonly sender: Hex;
    readonly nonceAtomic: string;
    readonly dstEid: 30109;
    readonly receiver: Hex;
}
export interface StargateTokenSourceReceipt {
    readonly transactionHash: Hex;
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly finality: StargateV2FinalityTag;
    readonly guid: Hex;
    readonly amountSentAtomic: string;
    readonly amountReceivedAtomic: string;
    readonly packet?: StargateTokenPacketBinding;
}
export interface StargateTokenDestinationEvidence {
    readonly emitter: Address;
    readonly sourceTransactionHash: Hex;
    readonly guid: Hex;
    readonly sourceEid: 30111;
    readonly destinationTransactionHash: Hex;
    readonly logIndexAtomic: string;
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly finality: StargateV2FinalityTag;
    readonly recipient: Address;
    readonly amountReceivedAtomic: string;
    readonly tokenBalanceBeforeAtomic: string;
    readonly tokenBalanceAfterAtomic: string;
    readonly tokenDeltaAtomic: string;
    readonly nativeBalanceBeforeAtomic: string;
    readonly nativeBalanceAfterAtomic: string;
    readonly nativeDeltaAtomic: string;
    readonly nativeDrop?: Readonly<{
        readonly executor: Address;
        readonly nonceAtomic: string;
        readonly success: true;
        readonly transactionHash?: Hex;
        readonly blockNumberAtomic?: string;
        readonly blockHash?: Hex;
        readonly logIndexAtomic?: string;
    }>;
    readonly packetDelivery?: Readonly<{
        readonly endpoint: Address;
        readonly tokenMessaging: Address;
        readonly nonceAtomic: string;
        readonly transactionHash: Hex;
        readonly blockNumberAtomic: string;
        readonly blockHash: Hex;
        readonly logIndexAtomic: string;
    }>;
}
export interface StargateTokenPolicyBinding {
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly mechanism: Readonly<{
        readonly provider: string;
        readonly reference: string;
    }>;
}
export interface StargateTokenPostApprovalQuote {
    readonly schemaVersion: "apn.stargate-v2-token-post-approval-quote.v1";
    readonly quotedAt: string;
    readonly expiresAt: string;
    readonly quote: StargateV2QuoteEvidence;
    readonly ownerApprovedMinimumOutputAtomic: string;
    readonly ownerApprovedMaximumQuoteLossAtomic: string;
    readonly quoteBlock: Readonly<{
        readonly numberAtomic: string;
        readonly hash: Hex;
    }>;
    readonly finalityPolicy: StargateV2RouteFinalityPolicy;
    readonly executorNativeCapAtomic: string;
    readonly sourceCodeHash: Hex;
    readonly destinationCodeHash: Hex;
    readonly sourceTokenCodeHash: Hex;
    readonly destinationTokenCodeHash: Hex;
    readonly policy: StargateTokenPolicyBinding;
    readonly sourceSnapshot: Readonly<{
        readonly tokenBalanceAtomic: string;
        readonly nativeBalanceAtomic: string;
        readonly allowanceAtomic: string;
        readonly nonceAtomic: string;
        readonly quotedMaxFeePerGasWei: string;
        readonly quotedMaxPriorityFeePerGasWei: string;
    }>;
    readonly destinationSnapshot: Readonly<{
        readonly tokenBalanceAtomic: string;
        readonly nativeBalanceAtomic: string;
        readonly blockNumberAtomic: string;
        readonly blockHash: Hex;
    }>;
    readonly bridgeEstimateGasAtomic: string;
    readonly sendEnvelope: StargateTokenEnvelope;
    readonly maximumDebitAtomic: string;
    readonly snapshotHash: string;
}
export interface StargateTokenOperation {
    readonly schemaVersion: "apn.stargate-v2-token-operation.v1" | "apn.stargate-v2-token-operation.v2" | "apn.stargate-v2-token-operation.v3" | "apn.stargate-v2-token-operation.v4" | "apn.stargate-v2-token-operation.v5";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly owner: Address;
    readonly recipient: Address;
    readonly finalityPolicy: StargateV2RouteFinalityPolicy;
    readonly finalityPolicyProvenance: StargateV2FinalityPolicyProvenance;
    readonly amountAtomic: string;
    readonly nativeDropAtomic: string;
    readonly maxNativeDebitAtomic: string;
    readonly minOutputAtomic: string;
    readonly sourceToken: Address;
    readonly destinationToken: Address;
    readonly sourcePool: Address;
    readonly destinationPool: Address;
    readonly sourceEid: 30111;
    readonly destinationEid: 30109;
    readonly executor: Address;
    readonly executorNativeCapAtomic: string;
    readonly options: Hex;
    readonly quote: StargateV2QuoteEvidence;
    readonly sourceCodeHash: Hex;
    readonly destinationCodeHash: Hex;
    readonly sourceTokenCodeHash: Hex;
    readonly destinationTokenCodeHash: Hex;
    readonly policy: StargateTokenPolicyBinding;
    readonly destinationTokenBalanceBeforeAtomic: string;
    readonly destinationNativeBalanceBeforeAtomic: string;
    readonly destinationBalanceBlock: {
        readonly numberAtomic: string;
        readonly hash: Hex;
    };
    readonly initialAllowanceAtomic: string;
    readonly allowanceRequired: boolean;
    readonly approvalEnvelope?: StargateTokenEnvelope;
    readonly feeApproval?: Readonly<{
        readonly provenance: "exact_snapshot" | "owner_ceiling";
        readonly quotedMaxFeePerGasWei: string;
        readonly quotedMaxPriorityFeePerGasWei: string;
        readonly approvedMaxFeePerGasWei: string;
        readonly approvedMaxPriorityFeePerGasWei: string;
    }>;
    readonly bridgeSimulation?: Readonly<{
        readonly mode: "exact_at_prepare" | "pending_post_approval";
        readonly prepareStatus: "succeeded" | "pending_post_approval";
        readonly gasCeilingAtomic: string;
    }>;
    readonly approvalFinalityWindowMs?: number;
    readonly approvalSubmissionStartedAt?: string;
    readonly approvalFinalityDeadline?: string;
    readonly postApprovalQuote?: StargateTokenPostApprovalQuote;
    readonly sendEnvelope: StargateTokenEnvelope;
    readonly maximumDebitAtomic: string;
    readonly preparedAt: string;
    readonly expiresAt: string;
    readonly phase: StargateTokenPhase;
    readonly transitions: readonly StargateTokenTransition[];
    readonly approvalTransactionHash?: Hex;
    readonly transactionHash?: Hex;
    readonly residualAllowanceAtomic?: string;
    readonly sourceReceipt?: StargateTokenSourceReceipt;
    readonly destinationEvidence?: StargateTokenDestinationEvidence;
    readonly cleanupEnvelope?: StargateTokenEnvelope;
    readonly cleanupTransactionHash?: Hex;
    readonly cleanupReason?: string;
    readonly usageState?: StargateTokenUsageState;
    /** Durable desired ledger transition. Presence means the idempotent ledger call still needs reconciliation. */
    readonly usageTarget?: StargateTokenUsageState;
    readonly integrityHash: string;
}
export interface StargateTokenPreparationRequest {
    readonly profile: string;
    readonly owner: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly nativeDropAtomic: string;
    readonly minOutputAtomic: string;
    readonly maxNativeDebitAtomic: string;
    readonly idempotencyKey: string;
    readonly maxFeePerGasWei?: string;
    readonly maxPriorityFeePerGasWei?: string;
    readonly ttlMs?: number;
}
export interface StargateTokenPreparedEnvelope {
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly nativeBalanceAtomic: string;
}
export interface StargateTokenRawLog {
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
}
export interface StargateTokenConfirmedReceipt {
    readonly transactionHash: Hex;
    readonly status: "success" | "reverted";
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly finality: StargateV2FinalityTag;
    readonly logs: readonly StargateTokenRawLog[];
}
export interface StargateTokenExecutionPorts {
    readonly sourceCall: EvmRpcCall;
    readonly destinationCall: EvmRpcCall;
    readonly destinationBalances: (recipient: Address, finalityTag: StargateV2FinalityTag) => Promise<Readonly<{
        tokenAtomic: string;
        nativeAtomic: string;
        blockNumberAtomic: string;
        blockHash: Hex;
    }>>;
    readonly prepareEnvelope: (transaction: Readonly<{
        chainId: 10;
        from: Address;
        to: Address;
        data: Hex;
        valueAtomic: string;
        nonceAtomic?: string;
    }>) => Promise<StargateTokenPreparedEnvelope>;
    readonly signer: Readonly<{
        kind: "imported_evm_signer";
        address: Address;
        signTransaction: (tx: StargateTokenEnvelope) => Promise<Hex>;
    }>;
    readonly signerIdentity: () => Promise<Readonly<{
        profile: string;
        address: Address;
    }>>;
    readonly approve: (operation: StargateTokenOperation) => Promise<void>;
    readonly approveCleanup: (operation: StargateTokenOperation) => Promise<void>;
    readonly admitPolicy: (input: Readonly<{
        profile: string;
        owner: Address;
        amountAtomic: string;
        operationId: string;
    }>) => Promise<StargateTokenPolicyBinding>;
    readonly confirmPolicy: (operation: StargateTokenOperation) => Promise<void>;
    readonly reserveUsage: (operation: StargateTokenOperation) => Promise<StargateTokenUsageState>;
    readonly followUsage: (operation: StargateTokenOperation, state: Exclude<StargateTokenUsageState, "reserved">) => Promise<StargateTokenUsageState>;
    readonly sendRawTransaction: (raw: Hex) => Promise<Hex>;
    readonly waitSourceReceipt: (transactionHash: Hex, finalityTag: StargateV2FinalityTag) => Promise<StargateTokenConfirmedReceipt | null>;
    readonly observeDestination: (input: Readonly<{
        sourceTransactionHash: Hex;
        guid: Hex;
        recipient: Address;
        sourceEid: 30111;
        destinationPool: Address;
        minimumAmountAtomic: string;
        tokenBalanceBeforeAtomic: string;
        nativeBalanceBeforeAtomic: string;
        nativeDropAtomic: string;
        fromBlockNumberAtomic: string;
        fromBlockHash: Hex;
        sourcePacket?: StargateTokenPacketBinding;
        finalityTag: StargateV2FinalityTag;
    }>) => Promise<StargateTokenDestinationEvidence | null>;
    readonly now?: () => number;
}
export interface StargateTokenJournal {
    load(id: string): Promise<StargateTokenOperation | null>;
    save(op: StargateTokenOperation): Promise<void>;
    withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
    withOwnerChainLock<T>(owner: Address, chainId: number, work: () => Promise<T>): Promise<T>;
}
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
export declare function prepareStargateV2Token(request: StargateTokenPreparationRequest, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
export declare function executeStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
/** Network observation only: it may advance an attempted effect and can never sign or broadcast. */
export declare function observeStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
/** Explicit foreground cleanup. Observation remains separate and never invokes this signer path. */
export declare function cleanupStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
/** Local ledger reconciliation for status/recovery callers; this never signs, broadcasts, or performs RPC. */
export declare function reconcileStargateV2TokenUsage(id: string, ports: Pick<StargateTokenExecutionPorts, "reserveUsage" | "followUsage">, journal: StargateTokenJournal): Promise<StargateTokenOperation>;
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
    source: StargateTokenSourceReceipt;
    destination: StargateTokenDestinationEvidence;
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
            readonly hash: Hex;
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
    policy: StargateTokenPolicyBinding;
    finalityPolicy: StargateV2RouteFinalityPolicy;
    quoteHash: string;
}>;
