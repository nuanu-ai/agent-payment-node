import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { type RelayEffectJournal } from "./effect-journal.js";
import type { EvmUnsentOutcome } from "../evm-unsent-outcome.js";
export interface RelaySignedApproval {
    readonly rawTransaction: Hex;
    readonly transactionHash: Hex;
}
export interface RelayApprovalCustodyPort {
    load(op: RelayUnsignedOperation): Promise<RelaySignedApproval | null>;
    seal(op: RelayUnsignedOperation, signed: RelaySignedApproval): Promise<void>;
    /** Only after the journal records the sealed bytes as never landing. */
    discard?(op: RelayUnsignedOperation): Promise<void>;
}
/** Production source runtimes always provide it; injected test ports may omit it. */
export type RelayUnsentOutcomePort = (input: Readonly<{
    account: string;
    nonce: bigint;
    transactionHash: string;
}>) => Promise<EvmUnsentOutcome>;
/** Signed nonce of saved bytes; the bytes were verified against the frozen envelope when sealed. */
export declare function relaySignedNonce(raw: string): bigint;
/** Reuses the existing AES-GCM encrypted wallet secret and hash-bound direct-effect slot of the operation's own
 * profile (an operation prepared under `default` keeps its slots in the `default` envelope; nothing moves). */
export declare class RelayEncryptedApprovalCustody implements RelayApprovalCustodyPort {
    private readonly state;
    private readonly profile;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort, profile: string);
    private owned;
    /** Hold the wallet mutation lock through a local retirement transition. A
     * damaged or unreadable envelope must not be treated as empty custody. */
    withNoMaterial<T>(op: RelayUnsignedOperation, action: () => Promise<T>): Promise<T>;
    load(op: RelayUnsignedOperation): Promise<RelaySignedApproval | null>;
    private loadLocked;
    seal(op: RelayUnsignedOperation, signed: RelaySignedApproval): Promise<void>;
    discard(op: RelayUnsignedOperation): Promise<void>;
    private sealLocked;
}
export interface RelayApprovalObservation {
    readonly transaction: Readonly<{
        hash: string;
        from: string;
        to: string | null;
        input: string;
        chainId: number;
    }>;
    readonly receipt: Readonly<{
        transactionHash: string;
        status: "success" | "reverted";
        blockNumber: bigint;
        blockHash: string;
        logs: readonly Readonly<{
            address: string;
            topics: readonly string[];
            data: string;
            transactionHash: string;
            blockHash: string;
        }>[];
    }>;
    /** Hash of the canonical block at receipt.blockNumber from a fresh read. */
    readonly canonicalBlockHash: string;
    /** False while the receipt is only included (confirmed below the latest head); absent means finalized. */
    readonly finalized?: boolean;
}
export interface RelayApprovalPorts {
    now(): Date;
    activePolicy(profile: string): Promise<ActiveAssetPolicy | null>;
    publicAccount(profile: string): Promise<string | null>;
    dailyUsage(account: string, now: Date): Promise<string>;
    /** External owner gate. It must validate a durable Relay requestId binding; no default exists here. */
    executionAdmission(op: RelayUnsignedOperation): Promise<null | Readonly<{
        requestId: string;
        operationIntegrityHash: string;
        quoteDigest: string;
    }>>;
    /** Fresh source state before signing and again before the first submission. */
    funding(op: RelayUnsignedOperation): Promise<Readonly<{
        chainId: number;
        nativeBalanceWei: bigint;
        tokenBalanceAtomic: bigint;
        allowanceAtomic: bigint;
        baseFeePerGasWei: bigint;
        nextNonce: bigint;
    }>>;
    sign(op: RelayUnsignedOperation): Promise<Hex>;
    send(rawTransaction: Hex): Promise<string>;
    observe(transactionHash: Hex): Promise<RelayApprovalObservation | null>;
    readonly custody: RelayApprovalCustodyPort;
    readonly unsentOutcome?: RelayUnsentOutcomePort;
}
/** A resumed call never signs again and never sends after `submitting` is durable. */
export declare class RelayApprovalEffectService {
    private readonly state;
    private readonly ports;
    private readonly operations;
    private readonly effects;
    constructor(state: StateStore, ports: RelayApprovalPorts);
    /** The operation is found only under the caller's explicit profile; no profile is assumed. */
    run(profile: string, operationId: string): Promise<RelayEffectJournal>;
    private assertEnvelope;
    private revalidate;
}
export declare function verifySigned(op: RelayUnsignedOperation, raw: Hex, claimedHash?: string, expectedNonce?: bigint): Promise<RelaySignedApproval>;
export declare function verifyApprovalObservation(op: RelayUnsignedOperation, hash: Hex, value: RelayApprovalObservation): "pending" | "confirmed" | "failed";
/** The shared frozen-envelope rule: the signed `gas × maxFeePerGas` within the consented ceiling bounds spend. */
export declare function relayEnvelopeFeeAdmitted(baseFeePerGasWei: bigint, envelope: Readonly<{
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
}>): boolean;
