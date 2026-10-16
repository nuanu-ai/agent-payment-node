import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { type RelayEffectJournal } from "./effect-journal.js";
import { type RelayApprovalObservation, type RelayUnsentOutcomePort } from "./approval-effect.js";
export interface RelaySignedDeposit {
    readonly rawTransaction: Hex;
    readonly transactionHash: Hex;
}
export interface RelayDepositCustodyPort {
    /** Durable, operation-bound storage. An unreadable or missing sealed value must fail closed. */
    load(op: RelayUnsignedOperation): Promise<RelaySignedDeposit | null>;
    seal(op: RelayUnsignedOperation, signed: RelaySignedDeposit): Promise<void>;
    /** Only after the journal records the sealed bytes as never landing. */
    discard?(op: RelayUnsignedOperation): Promise<void>;
}
/** Encrypted, hash-bound signed material for the one permitted deposit attempt, in the operation's own profile envelope. */
export declare class RelayEncryptedDepositCustody implements RelayDepositCustodyPort {
    private readonly state;
    private readonly profile;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort, profile: string);
    private owned;
    load(op: RelayUnsignedOperation): Promise<RelaySignedDeposit | null>;
    discard(op: RelayUnsignedOperation): Promise<void>;
    seal(op: RelayUnsignedOperation, signed: RelaySignedDeposit): Promise<void>;
}
export interface RelayDepositObservation {
    readonly transaction: Readonly<{
        hash: string;
        from: string;
        to: string | null;
        input: string;
        value: bigint;
        chainId: number;
    }>;
    readonly receipt: Readonly<{
        transactionHash: string;
        status: "success" | "reverted";
        blockNumber: bigint;
        blockHash: string;
        actualFee?: import("./source-fee-proof.js").RelayBaseReceiptFee;
    }>;
    readonly canonicalBlockHash: string;
}
export interface RelayDepositPorts {
    now(): Date;
    activePolicy(profile: string): Promise<ActiveAssetPolicy | null>;
    publicAccount(profile: string): Promise<string | null>;
    dailyUsage(account: string, now: Date): Promise<string>;
    executionAdmission(op: RelayUnsignedOperation): Promise<null | Readonly<{
        requestId: string;
        operationIntegrityHash: string;
        quoteDigest: string;
    }>>;
    /** Fresh canonical Ethereum state. The adapter must fail closed if chain or block cannot be verified. */
    funding(op: RelayUnsignedOperation): Promise<Readonly<{
        chainId: number;
        nativeBalanceWei: bigint;
        tokenBalanceAtomic: bigint;
        allowanceAtomic: bigint;
        baseFeePerGasWei: bigint;
        nextNonce: bigint;
    }>>;
    observeApproval(hash: Hex): Promise<RelayApprovalObservation | null>;
    sign(op: RelayUnsignedOperation): Promise<Hex>;
    readonly custody: RelayDepositCustodyPort;
    readonly unsentOutcome?: RelayUnsentOutcomePort;
    send(rawTransaction: Hex): Promise<string>;
    observe(hash: Hex): Promise<RelayDepositObservation | null>;
}
export declare function verifyDepositObservation(op: RelayUnsignedOperation, hash: Hex, value: RelayDepositObservation): "confirmed" | "failed";
export declare class RelayDepositEffectService {
    private readonly state;
    private readonly ports;
    private readonly operations;
    private readonly effects;
    constructor(state: StateStore, ports: RelayDepositPorts);
    /** The operation is found only under the caller's explicit profile; no profile is assumed. */
    run(profile: string, operationId: string): Promise<RelayEffectJournal>;
    private assertEnvelope;
    private revalidate;
}
