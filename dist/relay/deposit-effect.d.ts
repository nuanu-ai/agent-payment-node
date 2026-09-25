import { type Hex } from "viem";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { type RelayEffectJournal } from "./effect-journal.js";
import { type RelayApprovalObservation } from "./approval-effect.js";
export interface RelaySignedDeposit {
    readonly rawTransaction: Hex;
    readonly transactionHash: Hex;
}
export interface RelayDepositCustodyPort {
    /** Durable, operation-bound storage. An unreadable or missing sealed value must fail closed. */
    load(op: RelayUnsignedOperation): Promise<RelaySignedDeposit | null>;
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
    }>;
    readonly canonicalBlockHash: string;
}
export interface RelayDepositPorts {
    now(): Date;
    activePolicy(profile: "default"): Promise<ActiveAssetPolicy | null>;
    publicAccount(profile: "default"): Promise<string | null>;
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
        currentMaxFeePerGasWei: bigint;
        nextNonce: bigint;
    }>>;
    observeApproval(hash: Hex): Promise<RelayApprovalObservation | null>;
    sign(op: RelayUnsignedOperation): Promise<Hex>;
    readonly custody: RelayDepositCustodyPort;
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
    run(operationId: string): Promise<RelayEffectJournal>;
    private assertEnvelope;
    private revalidate;
}
