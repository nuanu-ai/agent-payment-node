import { z } from "zod";
export declare const PERMIT2_ALLOWANCE_SCHEMA: "apn.x402-permit2-allowance.v1";
export declare const PERMIT2_ALLOWANCE_FAMILY: "permit2_allowance";
export declare const PERMIT2_ALLOWANCE_STORE: "permit2-allowance";
export type Permit2AllowanceState = "prepared" | "signed" | "submitted" | "completed" | "reverted" | "superseded" | "failed_before_effect" | "abandoned_unknown";
export declare const PERMIT2_ALLOWANCE_STATES: readonly Permit2AllowanceState[];
export declare const PERMIT2_ALLOWANCE_TERMINAL_STATES: readonly Permit2AllowanceState[];
declare const recordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"apn.x402-permit2-allowance.v1">;
    kind: z.ZodLiteral<"permit2_allowance">;
    operationId: z.ZodString;
    profile: z.ZodString;
    profileHash: z.ZodString;
    idempotencyHash: z.ZodString;
    requestHash: z.ZodString;
    terms: z.ZodObject<{
        action: z.ZodEnum<{
            set: "set";
            revoke: "revoke";
        }>;
        chainId: z.ZodNumber;
        proofTag: z.ZodEnum<{
            safe: "safe";
            finalized: "finalized";
        }>;
        token: z.ZodString;
        owner: z.ZodString;
        spender: z.ZodLiteral<`0x${string}`>;
        amountAtomic: z.ZodString;
        priorAllowanceAtomic: z.ZodString;
        admission: z.ZodObject<{
            source: z.ZodEnum<{
                revoke: "revoke";
                profile_x402_policy: "profile_x402_policy";
                allowlist_permit2_row: "allowlist_permit2_row";
            }>;
            boundAtomic: z.ZodNullable<z.ZodString>;
            digest: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>;
        nonce: z.ZodString;
        gasLimit: z.ZodString;
        maxFeePerGasWei: z.ZodString;
        maxPriorityFeePerGasWei: z.ZodString;
        maxNativeDebitWei: z.ZodString;
        era: z.ZodObject<{
            number: z.ZodString;
            hash: z.ZodString;
        }, z.core.$strict>;
        rpcOrigin: z.ZodString;
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
        allowanceAtTagAtomic: z.ZodNullable<z.ZodString>;
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
export type Permit2AllowanceRecord = z.infer<typeof recordSchema>;
export type Permit2AllowanceTerms = Permit2AllowanceRecord["terms"];
type Mutable = "signed" | "submittedAt" | "outcome";
export declare function newPermit2Allowance(input: Pick<Permit2AllowanceRecord, "operationId" | "profile" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): Permit2AllowanceRecord;
export declare function transitionPermit2Allowance(record: Permit2AllowanceRecord, input: {
    readonly state: Permit2AllowanceState;
    readonly at: string;
    readonly reason: string;
} & Partial<Pick<Permit2AllowanceRecord, Mutable>>): Permit2AllowanceRecord;
/** Checked against the record's own fields (R2): hash chain, fingerprint, terminal flag and which fields each state has. */
export declare function validatePermit2Allowance(value: unknown): Permit2AllowanceRecord;
export {};
