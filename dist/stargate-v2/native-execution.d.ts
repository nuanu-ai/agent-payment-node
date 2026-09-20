import { type Hex } from "viem";
import type { EvmRpcCall } from "../evm-ports.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import { type StargateV2QuoteEvidence } from "./quote.js";
export type StargateNativePhase = "prepared" | "approved" | "submission_started" | "submitted" | "observed" | "unknown_finality";
export interface StargateNativeTransition {
    readonly phase: StargateNativePhase;
    readonly at: string;
    readonly reason: string;
}
export interface StargateNativeEnvelope {
    readonly chainId: 1;
    readonly from: Address;
    readonly to: Address;
    readonly data: Hex;
    readonly valueAtomic: string;
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
}
export interface StargateNativeOperation {
    readonly schemaVersion: "apn.stargate-v2-native-operation.v1";
    readonly operationId: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly idempotencyHash: string;
    readonly owner: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly maxNativeDebitAtomic: string;
    readonly sourcePool: Address;
    readonly destinationPool: Address;
    readonly sourceEid: 30101;
    readonly destinationEid: 30320;
    readonly quote: StargateV2QuoteEvidence;
    readonly sourceCodeHash: Hex;
    readonly destinationBalanceBeforeAtomic: string;
    readonly destinationCodeHash: Hex;
    readonly destinationBalanceBlock: {
        readonly numberAtomic: string;
        readonly hash: Hex;
    };
    readonly envelope: StargateNativeEnvelope;
    readonly totalValueAtomic: string;
    readonly maximumDebitAtomic: string;
    readonly preparedAt: string;
    readonly expiresAt: string;
    readonly phase: StargateNativePhase;
    readonly transitions: readonly StargateNativeTransition[];
    readonly transactionHash?: Hex;
    readonly guid?: Hex;
    readonly sourceReceipt?: StargateSourceReceipt;
    readonly destinationEvidence?: StargateDestinationEvidence;
    readonly integrityHash: string;
}
export interface StargateSourceReceipt {
    readonly transactionHash: Hex;
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly finality: "safe";
    readonly guid: Hex;
    readonly amountSentAtomic: string;
    readonly amountReceivedAtomic: string;
}
export type StargateDestinationEvidence = Readonly<{
    mode: "oft_received";
    emitter: Address;
    sourceTransactionHash: Hex;
    guid: Hex;
    sourceEid: 30101;
    destinationTransactionHash: Hex;
    logIndexAtomic: string;
    blockNumberAtomic: string;
    blockHash: Hex;
    finality: "safe";
    recipient: Address;
    amountReceivedAtomic: string;
}> | Readonly<{
    mode: "balance_delta";
    blockNumberAtomic: string;
    blockHash: Hex;
    finality: "safe";
    recipient: Address;
    balanceBeforeAtomic: string;
    balanceAfterAtomic: string;
    deltaAtomic: string;
}>;
export interface StargateNativePreparationRequest {
    readonly profile: string;
    readonly owner: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly maxNativeDebitAtomic: string;
    readonly idempotencyKey: string;
    readonly ttlMs?: number;
}
export interface StargatePreparedEnvelopeEvidence {
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly nativeBalanceAtomic: string;
}
export interface StargateRawLog {
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
}
export interface StargateConfirmedReceipt {
    readonly transactionHash: Hex;
    readonly status: "success" | "reverted";
    readonly blockNumberAtomic: string;
    readonly blockHash: Hex;
    readonly finality: "safe";
    readonly logs: readonly StargateRawLog[];
}
export interface StargateNativeExecutionPorts {
    readonly sourceCall: EvmRpcCall;
    readonly destinationCall: EvmRpcCall;
    readonly destinationBalance: (recipient: Address) => Promise<Readonly<{
        balanceAtomic: string;
        blockNumberAtomic: string;
        blockHash: Hex;
    }>>;
    readonly prepareEnvelope: (transaction: Readonly<{
        chainId: 1;
        from: Address;
        to: Address;
        data: Hex;
        valueAtomic: string;
    }>) => Promise<StargatePreparedEnvelopeEvidence>;
    readonly signer: Readonly<{
        kind: "imported_evm_signer";
        address: Address;
        signTransaction: (tx: StargateNativeEnvelope) => Promise<Hex>;
    }>;
    readonly signerIdentity: () => Promise<Readonly<{
        profile: string;
        address: Address;
    }>>;
    readonly approve: (operation: StargateNativeOperation) => Promise<void>;
    readonly sendRawTransaction: (raw: Hex) => Promise<Hex>;
    readonly waitSourceReceipt: (transactionHash: Hex) => Promise<StargateConfirmedReceipt | null>;
    readonly observeDestination: (input: Readonly<{
        sourceTransactionHash: Hex;
        guid: Hex;
        recipient: Address;
        sourceEid: 30101;
        destinationPool: Address;
        minimumAmountAtomic: string;
        balanceBeforeAtomic: string;
        fromBlockNumberAtomic: string;
        fromBlockHash: Hex;
    }>) => Promise<StargateDestinationEvidence | null>;
    readonly now?: () => number;
}
export interface StargateNativeJournal {
    load(operationId: string): Promise<StargateNativeOperation | null>;
    save(next: StargateNativeOperation): Promise<void>;
    withLock<T>(operationId: string, work: () => Promise<T>): Promise<T>;
    withOwnerChainLock<T>(owner: Address, chainId: number, work: () => Promise<T>): Promise<T>;
}
export declare class FileStargateNativeJournal implements StargateNativeJournal {
    private readonly root;
    private readonly locks;
    constructor(root: string, locks?: Pick<StateStore, "initialize" | "withLocks">);
    private path;
    withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
    withOwnerChainLock<T>(owner: Address, chainId: number, work: () => Promise<T>): Promise<T>;
    load(id: string): Promise<StargateNativeOperation | null>;
    save(nextInput: StargateNativeOperation): Promise<void>;
}
export declare class LocalStargateNativeSigner {
    private readonly state;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    identity(profileInput: string, expectedOwner?: Address): Promise<Readonly<{
        profile: string;
        address: Address;
    }>>;
    port(profileInput: string, expectedOwner: Address): Promise<StargateNativeExecutionPorts["signer"]>;
}
export declare function prepareStargateV2NativeEth(request: StargateNativePreparationRequest, ports: StargateNativeExecutionPorts, journal: StargateNativeJournal): Promise<StargateNativeOperation>;
export declare function executeStargateV2NativeEth(operationId: string, ports: StargateNativeExecutionPorts, journal: StargateNativeJournal): Promise<StargateNativeOperation>;
export interface StargateNativeCanonicalReceipt {
    readonly schemaVersion: "apn.stargate-v2-native-receipt.v1";
    readonly operationId: string;
    readonly profile: string;
    readonly route: Readonly<{
        sourceChainId: 1;
        sourceEid: 30101;
        sourcePool: Address;
        destinationChainId: 130;
        destinationEid: 30320;
        destinationPool: Address;
    }>;
    readonly owner: Address;
    readonly recipient: Address;
    readonly principalAtomic: string;
    readonly nativeMessageFeeAtomic: string;
    readonly totalValueAtomic: string;
    readonly maximumDebitAtomic: string;
    readonly quoteHash: string;
    readonly source: StargateSourceReceipt;
    readonly destination: StargateDestinationEvidence;
    readonly evidenceHash: string;
}
export declare function stargateV2NativeCanonicalReceipt(operationInput: StargateNativeOperation): StargateNativeCanonicalReceipt;
