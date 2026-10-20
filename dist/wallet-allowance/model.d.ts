import { z } from "zod";
export declare const WALLET_ALLOWANCE_REVOKE_SCHEMA: "apn.wallet-allowance-revoke.v1";
export declare const WALLET_ALLOWANCE_REVOKE_FAMILY: "wallet_allowance_revoke";
export declare const WALLET_ALLOWANCE_REVOKE_STORE: "wallet-allowance-revokes";
export type WalletAllowanceRevokeState = "prepared" | "signed" | "submitted" | "completed" | "reverted" | "superseded" | "failed_before_effect" | "abandoned_unknown";
/** The journal bound (widened from 8 for refused sends); a refused send goes back to `signed` only while a restart and an exit still fit. */
export declare const WALLET_ALLOWANCE_REVOKE_JOURNAL_MAX = 16;
export declare const SEND_REFUSED_BEFORE_TRANSPORT = "send_refused_before_transport";
export declare const WALLET_ALLOWANCE_REVOKE_STATES: readonly WalletAllowanceRevokeState[];
export declare const WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES: readonly WalletAllowanceRevokeState[];
declare const recordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"apn.wallet-allowance-revoke.v1">;
    kind: z.ZodLiteral<"wallet_allowance_revoke">;
    operationId: z.ZodString;
    profile: z.ZodString;
    profileHash: z.ZodString;
    idempotencyHash: z.ZodString;
    requestHash: z.ZodString;
    terms: z.ZodObject<{
        chainId: z.ZodNumber;
        proofTag: z.ZodEnum<{
            safe: "safe";
            finalized: "finalized";
        }>;
        rpcSetting: z.ZodString;
        token: z.ZodString;
        owner: z.ZodString;
        spender: z.ZodString;
        priorAllowanceAtomic: z.ZodString;
        nonce: z.ZodString;
        gasLimit: z.ZodString;
        maxFeePerGasWei: z.ZodString;
        maxPriorityFeePerGasWei: z.ZodString;
        maxNativeDebitWei: z.ZodString;
        era: z.ZodObject<{
            number: z.ZodString;
            hash: z.ZodString;
        }, z.core.$strict>;
        preparedAt: z.ZodString;
        expiresAt: z.ZodString;
    }, z.core.$strict>;
    fingerprint: z.ZodString;
    signed: z.ZodNullable<z.ZodObject<{
        rawTransaction: z.ZodString;
        transactionHash: z.ZodString;
    }, z.core.$strict>>;
    submittedAt: z.ZodNullable<z.ZodString>;
    outcome: z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
        kind: z.ZodLiteral<"receipt">;
        blockNumber: z.ZodString;
        blockHash: z.ZodString;
        status: z.ZodEnum<{
            reverted: "reverted";
            success: "success";
        }>;
        approvalLog: z.ZodBoolean;
        allowanceAtTagAtomic: z.ZodString;
        tag: z.ZodEnum<{
            safe: "safe";
            finalized: "finalized";
        }>;
        observedAt: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"never_lands">;
        finalizedNonce: z.ZodString;
        observedAt: z.ZodString;
    }, z.core.$strict>]>>;
    state: z.ZodEnum<{
        prepared: "prepared";
        submitted: "submitted";
        reverted: "reverted";
        completed: "completed";
        failed_before_effect: "failed_before_effect";
        abandoned_unknown: "abandoned_unknown";
        signed: "signed";
        superseded: "superseded";
    }>;
    terminal: z.ZodBoolean;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    journal: z.ZodArray<z.ZodObject<{
        state: z.ZodEnum<{
            prepared: "prepared";
            submitted: "submitted";
            reverted: "reverted";
            completed: "completed";
            failed_before_effect: "failed_before_effect";
            abandoned_unknown: "abandoned_unknown";
            signed: "signed";
            superseded: "superseded";
        }>;
        at: z.ZodString;
        reason: z.ZodString;
        previousHash: z.ZodString;
        entryHash: z.ZodString;
    }, z.core.$strict>>;
    integrityHash: z.ZodString;
}, z.core.$strict>;
export type WalletAllowanceRevokeRecord = z.infer<typeof recordSchema>;
export type WalletAllowanceRevokeTerms = WalletAllowanceRevokeRecord["terms"];
type Mutable = "signed" | "submittedAt" | "outcome";
export declare function newWalletAllowanceRevoke(input: Pick<WalletAllowanceRevokeRecord, "operationId" | "profile" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): WalletAllowanceRevokeRecord;
export declare function transitionWalletAllowanceRevoke(record: WalletAllowanceRevokeRecord, input: {
    readonly state: WalletAllowanceRevokeState;
    readonly at: string;
    readonly reason: string;
} & Partial<Pick<WalletAllowanceRevokeRecord, Mutable>>): WalletAllowanceRevokeRecord;
/** Checked against the record's own fields (R2): hash chain, fingerprint, terminal flag and which fields each state has. */
export declare function validateWalletAllowanceRevoke(value: unknown): WalletAllowanceRevokeRecord;
/** The slot one open revoke holds: the same profile, chain, token and spender continue it, never a second one. */
export declare function walletAllowanceSlot(record: {
    readonly profileHash: string;
    readonly terms: Pick<WalletAllowanceRevokeTerms, "chainId" | "token" | "spender">;
}): string;
export {};
