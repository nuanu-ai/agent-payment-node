import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { SecureStateStore } from "../secure-state-store.js";
export type ArbitrumEffectRole = "approval" | "deposit";
export type ArbitrumEffectPhase = "pending" | "signing_started" | "sealed" | "submitting" | "submitted" | "unknown_finality" | "confirmed" | "failed" | "approval_skipped";
export interface ArbitrumApprovalSkipProof {
    readonly proofClass: "canonical_allowance_observation";
    readonly operationIntegrityHash: string;
    readonly policyDigest: string;
    readonly policyRevision: number;
    readonly token: string;
    readonly owner: string;
    readonly spender: string;
    readonly amountAtomic: string;
    readonly allowanceAtomic: string;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly observedAt: string;
}
export type ArbitrumVerifiedAllowanceRead = Omit<ArbitrumApprovalSkipProof, "proofClass" | "operationIntegrityHash" | "token" | "owner" | "spender" | "amountAtomic">;
export interface ArbitrumEffectAttempt {
    readonly marker: string;
    readonly markedAt: string;
    readonly rawTransaction: string | null;
    readonly transactionHash: string | null;
    readonly nonce: string | null;
    readonly submittingAt: string | null;
    readonly observationDigest: string | null;
}
export interface ArbitrumSourceEffect {
    readonly role: ArbitrumEffectRole;
    readonly phase: ArbitrumEffectPhase;
    readonly attempt: ArbitrumEffectAttempt | null;
    readonly skipProof?: ArbitrumApprovalSkipProof;
}
export interface ArbitrumSourceEffectJournal {
    readonly schemaVersion: "apn.relay-arbitrum-source-effect-journal.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly quoteDigest: string;
    readonly orderId: string;
    readonly owner: string;
    readonly approvalEnvelopeHash: string;
    readonly depositEnvelopeHash: string;
    readonly effects: readonly [ArbitrumSourceEffect, ArbitrumSourceEffect];
    readonly createdAt: string;
    readonly integrityHash: string;
}
export type ArbitrumEffectEvent = {
    readonly kind: "begin_signing";
    readonly role: ArbitrumEffectRole;
    readonly marker: string;
    readonly at: string;
} | {
    readonly kind: "seal_signed";
    readonly role: ArbitrumEffectRole;
    readonly rawTransaction: string;
    readonly nonce: string;
} | {
    readonly kind: "mark_submitting";
    readonly role: ArbitrumEffectRole;
    readonly at: string;
} | {
    readonly kind: "record_send";
    readonly role: ArbitrumEffectRole;
    readonly outcome: "accepted" | "uncertain";
} | {
    readonly kind: "record_verified_observation";
    readonly role: ArbitrumEffectRole;
    readonly outcome: "confirmed" | "failed";
    readonly proofDigest: string;
};
export declare function validateArbitrumSourceEffectJournal(value: unknown, op: RelayUnsignedOperation): Promise<ArbitrumSourceEffectJournal>;
export declare function createArbitrumSourceEffectJournal(op: RelayUnsignedOperation, createdAt: string): Promise<ArbitrumSourceEffectJournal>;
export declare function advanceArbitrumSourceEffectJournal(j: ArbitrumSourceEffectJournal, op: RelayUnsignedOperation, event: ArbitrumEffectEvent): Promise<ArbitrumSourceEffectJournal>;
export declare function arbitrumSourceRecoveryClass(j: ArbitrumSourceEffectJournal, op: RelayUnsignedOperation): Promise<"not_started" | "observation_only" | "approval_confirmed" | "approval_skipped" | "completed" | "failed">;
export declare class ArbitrumSourceEffectJournalRepository extends SecureStateStore {
    private readonly verifiedObservation?;
    private readonly verifiedAllowance?;
    private readonly clock;
    constructor(root: string, verifiedObservation?: ((input: {
        readonly operation: RelayUnsignedOperation;
        readonly journal: ArbitrumSourceEffectJournal;
        readonly role: ArbitrumEffectRole;
        readonly outcome: "confirmed" | "failed";
        readonly proofDigest: string;
    }) => Promise<boolean>) | undefined, verifiedAllowance?: ((input: {
        readonly operation: RelayUnsignedOperation;
        readonly journal: ArbitrumSourceEffectJournal;
    }) => Promise<ArbitrumVerifiedAllowanceRead | null>) | undefined, clock?: () => Date);
    private readonly operations;
    private path;
    private operation;
    load(profileHash: string, operationId: string): Promise<ArbitrumSourceEffectJournal | null>;
    create(profileHash: string, operationId: string, createdAt: string): Promise<ArbitrumSourceEffectJournal>;
    transition(profileHash: string, operationId: string, expectedIntegrityHash: string, event: ArbitrumEffectEvent): Promise<ArbitrumSourceEffectJournal>;
    beginSigning(profileHash: string, operationId: string, expectedIntegrityHash: string, role: ArbitrumEffectRole, at: string): Promise<ArbitrumSourceEffectJournal>;
    /** Only a separately wired canonical read may create this proof. It does not authorize deposit dispatch. */
    skipApproval(profileHash: string, operationId: string, expectedIntegrityHash: string): Promise<ArbitrumSourceEffectJournal>;
}
