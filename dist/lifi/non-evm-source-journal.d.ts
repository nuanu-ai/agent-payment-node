import { SecureStateStore } from "../secure-state-store.js";
import { z } from "zod";
declare const schemaV3: z.ZodObject<{
    transitions: z.ZodArray<z.ZodObject<{
        at: z.ZodString;
        previousHash: z.ZodString;
        transitionHash: z.ZodString;
        phase: z.ZodEnum<{
            signing_started: "signing_started";
            sealed: "sealed";
            unknown_finality: "unknown_finality";
            submitting: "submitting";
            submitted_pending: "submitted_pending";
            staged_untrusted: "staged_untrusted";
        }>;
        signedTransaction: z.ZodNullable<z.ZodString>;
        transactionHash: z.ZodNullable<z.ZodString>;
        nonceAtomic: z.ZodNullable<z.ZodString>;
        submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        safeSourceProof: z.ZodNull;
        reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    integrityHash: z.ZodString;
    phase: z.ZodEnum<{
        signing_started: "signing_started";
        sealed: "sealed";
        unknown_finality: "unknown_finality";
        submitting: "submitting";
        submitted_pending: "submitted_pending";
        staged_untrusted: "staged_untrusted";
    }>;
    signedTransaction: z.ZodNullable<z.ZodString>;
    transactionHash: z.ZodNullable<z.ZodString>;
    nonceAtomic: z.ZodNullable<z.ZodString>;
    submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
    safeSourceProof: z.ZodNull;
    reason: z.ZodNullable<z.ZodString>;
    schemaVersion: z.ZodLiteral<"apn.non-evm-source-journal.v3">;
    kind: z.ZodLiteral<"non_evm_source_journal">;
    executionAdmitted: z.ZodLiteral<true>;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    draftIntegrityHash: z.ZodString;
    route: z.ZodLiteral<"base_usdc_to_solana_usdc_circle_cctp_v2">;
    sourceCall: z.ZodObject<{
        chainId: z.ZodLiteral<8453>;
        from: z.ZodString;
        to: z.ZodString;
        valueAtomic: z.ZodString;
        data: z.ZodString;
        dataSha256: z.ZodString;
        type: z.ZodLiteral<"eip1559">;
        nonceAtomic: z.ZodString;
        gasLimitAtomic: z.ZodString;
        maxFeePerGasAtomic: z.ZodString;
        maxPriorityFeePerGasAtomic: z.ZodString;
        accessList: z.ZodTuple<[], null>;
    }, z.core.$strict>;
    maxSourceNativeDebitWei: z.ZodString;
    admissionProof: z.ZodObject<{
        kind: z.ZodLiteral<"circle_v2_live_transport_v1">;
        circleOrigin: z.ZodLiteral<"https://iris-api.circle.com">;
        rpcOrigin: z.ZodString;
        quoteHash: z.ZodString;
        validationHash: z.ZodString;
        sourceBlockHash: z.ZodString;
        preparationDigest: z.ZodString;
        payer: z.ZodString;
        recipientOwner: z.ZodString;
        recipientAta: z.ZodString;
        feeTotalAtomic: z.ZodString;
    }, z.core.$strict>;
    createdAt: z.ZodString;
    protocolInputHash: z.ZodString;
}, z.core.$strict>;
export type NonEvmSourceJournalV3 = z.infer<typeof schemaV3>;
export type NonEvmSourceJournal = NonEvmSourceJournalV3;
/** In-memory projection of a Circle preparation; its synthetic claim is replaced by the live admission before staging. */
export type NonEvmSourceBinding = Pick<NonEvmSourceJournalV3, "profileHash" | "operationId" | "draftIntegrityHash" | "route" | "sourceCall" | "maxSourceNativeDebitWei" | "createdAt"> & {
    readonly admissionProof: {
        readonly kind: "synthetic_untrusted";
        readonly claimedValidationHash: string;
        readonly note: string;
    };
};
export type LiveCircleSourceBinding = Omit<NonEvmSourceBinding, "admissionProof"> & Pick<NonEvmSourceJournalV3, "admissionProof" | "protocolInputHash">;
export declare function validateNonEvmSourceJournal(value: unknown): NonEvmSourceJournal;
/** All mutations lock the exact draft identity and compare the expected record hash. */
export declare class NonEvmSourceJournalRepository extends SecureStateStore {
    private path;
    load(profileHash: string, operationId: string): Promise<NonEvmSourceJournal | null>;
    private reservationPath;
    private reserve;
    private assertReservation;
    /** Records structural live-admission claims. This repository cannot authenticate network origin or authorize a source effect. */
    stageLiveCircle(binding: LiveCircleSourceBinding): Promise<NonEvmSourceJournalV3>;
    private stageBuilt;
    private change;
    signingStarted(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal>;
    seal(profileHash: string, operationId: string, expectedHash: string, raw: `0x${string}`, nonceAtomic: string, at: string): Promise<NonEvmSourceJournal>;
    /** Commit the sole attempt before a future adapter may send. No send or retry method exists here. */
    committingSubmission(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal>;
    observePending(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal>;
    observeUnknown(profileHash: string, operationId: string, expectedHash: string, reason: string, at: string): Promise<NonEvmSourceJournal>;
}
export {};
