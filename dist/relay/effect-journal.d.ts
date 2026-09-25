import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { RelayQuoteTransaction } from "./quote.js";
export type RelayEffectRole = "approval" | "deposit";
export type RelayEffectPhase = "pending" | "signing_started" | "sealed" | "submitting" | "submission_marked" | "tx_known" | "confirmed" | "failed";
export interface RelayEffect {
    readonly role: RelayEffectRole;
    readonly phase: RelayEffectPhase;
    /** Written before any future caller may submit. A marked effect may only be observed. */
    readonly attempt: null | Readonly<{
        marker: string;
        markedAt: string;
        transactionHash: string | null;
        attemptNumber?: 1;
    }>;
    readonly observedAt: string | null;
}
export interface RelayEffectJournal {
    readonly schemaVersion: "apn.relay-effect-journal.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly preparedIntegrityHash: string;
    readonly sourceOwner: string;
    readonly quoteDigest: string;
    readonly orderId: string;
    readonly approvalEnvelope: RelayQuoteTransaction;
    readonly depositEnvelope: RelayQuoteTransaction;
    readonly effects: readonly [RelayEffect, RelayEffect];
    readonly createdAt: string;
    readonly integrityHash: string;
}
export type RelayEffectEvent = Readonly<{
    kind: "mark_signing";
    role: RelayEffectRole;
    marker: string;
    at: string;
}> | Readonly<{
    kind: "seal_signed";
    role: RelayEffectRole;
    transactionHash: string;
}> | Readonly<{
    kind: "mark_submitting";
    role: RelayEffectRole;
    at: string;
}> | Readonly<{
    kind: "mark_submission";
    role: RelayEffectRole;
    marker: string;
    at: string;
}> | Readonly<{
    kind: "record_transaction";
    role: RelayEffectRole;
    transactionHash: string;
}> | Readonly<{
    kind: "observe";
    role: RelayEffectRole;
    outcome: "confirmed" | "failed";
    at: string;
}>;
export declare function validateRelayEffectJournal(value: unknown, op: RelayUnsignedOperation): RelayEffectJournal;
export declare function createRelayEffectJournal(op: RelayUnsignedOperation, createdAt: string): RelayEffectJournal;
/** Pure transition. Once a submission is marked, no transition can mark it again. */
export declare function advanceRelayEffectJournal(journal: RelayEffectJournal, op: RelayUnsignedOperation, event: RelayEffectEvent): RelayEffectJournal;
export declare function relayRecoveryClass(journal: RelayEffectJournal, op: RelayUnsignedOperation): "not_started" | "observation_only" | "approval_confirmed" | "completed" | "failed";
export declare class RelayEffectJournalRepository extends SecureStateStore {
    private readonly preparedOperations;
    private path;
    private operation;
    load(profileHash: string, operationId: string): Promise<RelayEffectJournal | null>;
    create(profileHash: string, operationId: string, createdAt: string): Promise<RelayEffectJournal>;
    transition(profileHash: string, operationId: string, expectedIntegrityHash: string, event: RelayEffectEvent): Promise<RelayEffectJournal>;
}
