import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { type RelayEffectJournal } from "./effect-journal.js";
export interface RelaySignedApproval {
    readonly rawTransaction: Hex;
    readonly transactionHash: Hex;
}
export interface RelayApprovalCustodyPort {
    load(op: RelayUnsignedOperation): Promise<RelaySignedApproval | null>;
    seal(op: RelayUnsignedOperation, signed: RelaySignedApproval): Promise<void>;
}
/** Reuses the existing AES-GCM encrypted wallet secret and hash-bound direct-effect slot. */
export declare class RelayEncryptedApprovalCustody implements RelayApprovalCustodyPort {
    private readonly state;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    /** Hold the wallet mutation lock through a local retirement transition. A
     * damaged or unreadable envelope must not be treated as empty custody. */
    withNoMaterial<T>(op: RelayUnsignedOperation, action: () => Promise<T>): Promise<T>;
    load(op: RelayUnsignedOperation): Promise<RelaySignedApproval | null>;
    private loadLocked;
    seal(op: RelayUnsignedOperation, signed: RelaySignedApproval): Promise<void>;
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
}
export interface RelayApprovalPorts {
    now(): Date;
    activePolicy(profile: "default"): Promise<ActiveAssetPolicy | null>;
    publicAccount(profile: "default"): Promise<string | null>;
    dailyUsage(account: string, now: Date): Promise<string>;
    /** External owner gate. It must validate a durable Relay requestId binding; no default exists here. */
    executionAdmission(op: RelayUnsignedOperation): Promise<null | Readonly<{
        requestId: string;
        operationIntegrityHash: string;
        quoteDigest: string;
    }>>;
    sign(op: RelayUnsignedOperation): Promise<Hex>;
    send(rawTransaction: Hex): Promise<string>;
    observe(transactionHash: Hex): Promise<RelayApprovalObservation | null>;
    readonly custody: RelayApprovalCustodyPort;
}
/** A resumed call never signs again and never sends after `submitting` is durable. */
export declare class RelayApprovalEffectService {
    private readonly state;
    private readonly ports;
    private readonly operations;
    private readonly effects;
    constructor(state: StateStore, ports: RelayApprovalPorts);
    run(operationId: string): Promise<RelayEffectJournal>;
    private assertEnvelope;
    private revalidate;
}
export declare function verifySigned(op: RelayUnsignedOperation, raw: Hex, claimedHash?: string): Promise<RelaySignedApproval>;
export declare function verifyApprovalObservation(op: RelayUnsignedOperation, hash: Hex, value: RelayApprovalObservation): "pending" | "confirmed" | "failed";
