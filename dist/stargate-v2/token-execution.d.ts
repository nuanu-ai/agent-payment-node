import { type Hex } from "viem";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address } from "../model.js";
import { StateStore } from "../state.js";
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
export declare const STARGATE_TOKEN_MECHANISM: Readonly<{
    provider: "stargate-v2";
    reference: `eip155:10:0x${string}/eip155:137:0x${string}`;
}>;
/** Exact OptionsBuilder.addExecutorNativeDropOption Type-3 wire encoding. */
export declare function encodeStargateNativeDrop(amountInput: string, recipientInput: Address): Hex;
export type StargateTokenPhase = "prepared" | "approved" | "allowance_submission_started" | "allowance_unknown_finality" | "allowance_submitted" | "allowance_observed" | "submission_started" | "unknown_finality" | "submitted" | "observed" | "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned";
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
export interface StargateTokenSourceReceipt {
    readonly transactionHash: Hex;
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly finality: "safe";
    readonly guid: Hex;
    readonly amountSentAtomic: string;
    readonly amountReceivedAtomic: string;
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
    readonly finality: "safe";
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
export interface StargateTokenOperation {
    readonly schemaVersion: "apn.stargate-v2-token-operation.v1";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly owner: Address;
    readonly recipient: Address;
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
    readonly finality: "safe";
    readonly logs: readonly StargateTokenRawLog[];
}
export interface StargateTokenExecutionPorts {
    readonly sourceCall: EvmRpcCall;
    readonly destinationCall: EvmRpcCall;
    readonly destinationBalances: (recipient: Address) => Promise<Readonly<{
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
    readonly reserveUsage: (operation: StargateTokenOperation) => Promise<void>;
    readonly followUsage: (operation: StargateTokenOperation, state: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert") => Promise<void>;
    readonly sendRawTransaction: (raw: Hex) => Promise<Hex>;
    readonly waitSourceReceipt: (transactionHash: Hex) => Promise<StargateTokenConfirmedReceipt | null>;
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
export declare function stargateV2TokenCanonicalReceipt(input: StargateTokenOperation): Readonly<{
    evidenceHash: string;
    schemaVersion: "apn.stargate-v2-token-receipt.v1";
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
    quoteHash: string;
    approvalTransactionHash: `0x${string}` | null;
    residualAllowanceAtomic: string;
    source: StargateTokenSourceReceipt;
    destination: StargateTokenDestinationEvidence;
}>;
