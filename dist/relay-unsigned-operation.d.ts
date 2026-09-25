import type { ValidatedRelayQuote } from "./relay/quote.js";
import { type ValidatedRelayNativeQuote } from "./relay/native-quote.js";
import { SecureStateStore } from "./secure-state-store.js";
import { z } from "zod";
declare const body: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"apn.relay-unsigned-operation.v1">;
    kind: z.ZodLiteral<"relay_unsigned">;
    state: z.ZodLiteral<"prepared">;
    terminal: z.ZodLiteral<false>;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    idempotencyHash: z.ZodString;
    requestHash: z.ZodString;
    sourceChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<56>]>;
    destinationChainId: z.ZodUnion<readonly [z.ZodLiteral<56>, z.ZodLiteral<137>, z.ZodLiteral<143>, z.ZodLiteral<8453>]>;
    sourceAccount: z.ZodString;
    recipient: z.ZodString;
    quoteDigest: z.ZodString;
    statusLocator: z.ZodOptional<z.ZodObject<{
        requestId: z.ZodString;
        endpoint: z.ZodString;
    }, z.core.$strict>>;
    quote: z.ZodOptional<z.ZodCustom<ValidatedRelayQuote, ValidatedRelayQuote>>;
    nativeQuote: z.ZodOptional<z.ZodCustom<ValidatedRelayNativeQuote, ValidatedRelayNativeQuote>>;
    policyDigest: z.ZodOptional<z.ZodString>;
    policyRevision: z.ZodOptional<z.ZodNumber>;
    approvalNetworkFeeCeilingWei: z.ZodOptional<z.ZodString>;
    depositNetworkFeeCeilingWei: z.ZodOptional<z.ZodString>;
    amountAtomic: z.ZodString;
    minOutputAtomic: z.ZodString;
    createdAt: z.ZodString;
    deadline: z.ZodString;
}, z.core.$strict>;
declare const schema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"apn.relay-unsigned-operation.v1">;
    kind: z.ZodLiteral<"relay_unsigned">;
    state: z.ZodLiteral<"prepared">;
    terminal: z.ZodLiteral<false>;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    idempotencyHash: z.ZodString;
    requestHash: z.ZodString;
    sourceChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<56>]>;
    destinationChainId: z.ZodUnion<readonly [z.ZodLiteral<56>, z.ZodLiteral<137>, z.ZodLiteral<143>, z.ZodLiteral<8453>]>;
    sourceAccount: z.ZodString;
    recipient: z.ZodString;
    quoteDigest: z.ZodString;
    statusLocator: z.ZodOptional<z.ZodObject<{
        requestId: z.ZodString;
        endpoint: z.ZodString;
    }, z.core.$strict>>;
    quote: z.ZodOptional<z.ZodCustom<ValidatedRelayQuote, ValidatedRelayQuote>>;
    nativeQuote: z.ZodOptional<z.ZodCustom<ValidatedRelayNativeQuote, ValidatedRelayNativeQuote>>;
    policyDigest: z.ZodOptional<z.ZodString>;
    policyRevision: z.ZodOptional<z.ZodNumber>;
    approvalNetworkFeeCeilingWei: z.ZodOptional<z.ZodString>;
    depositNetworkFeeCeilingWei: z.ZodOptional<z.ZodString>;
    amountAtomic: z.ZodString;
    minOutputAtomic: z.ZodString;
    createdAt: z.ZodString;
    deadline: z.ZodString;
    integrityHash: z.ZodString;
}, z.core.$strict>;
export type RelayUnsignedOperation = z.infer<typeof schema>;
export type RelayUnsignedOperationInput = z.infer<typeof body>;
declare const retirementSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"apn.relay-retirement.v1">;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    preparedIntegrityHash: z.ZodString;
    retiredAt: z.ZodString;
    integrityHash: z.ZodString;
}, z.core.$strict>;
export type RelayRetirement = z.infer<typeof retirementSchema>;
export declare function validateRelayUnsignedOperation(value: unknown): RelayUnsignedOperation;
export declare function freezeRelayUnsignedOperation(input: RelayUnsignedOperationInput): RelayUnsignedOperation;
export type PublicRelayUnsignedOperation = Omit<RelayUnsignedOperation, "integrityHash" | "statusLocator" | "quote" | "nativeQuote" | "state" | "terminal"> & {
    readonly quote?: Omit<ValidatedRelayQuote, "statusLocator">;
    readonly nativeQuote?: Omit<ValidatedRelayNativeQuote, "statusLocator">;
    readonly state: "prepared" | "retired" | "source_confirmed";
    readonly terminal: boolean;
    readonly sourceEffectTerminal?: true;
    readonly sourceJournalIntegrityHash?: string;
    readonly retiredAt?: string;
    readonly retirementIntegrityHash?: string;
    readonly proofClass: "saved_unsigned_quote" | "source_effect_confirmed";
    readonly balanceEvidence: "not_checked";
    readonly allowanceEvidence: "not_checked";
    readonly statusObservable: boolean;
    readonly executionAdmitted: false;
    readonly nextActions: readonly [];
};
export declare function publicRelayUnsignedOperation(operation: RelayUnsignedOperation, retirement?: RelayRetirement | null, sourceCompletion?: {
    readonly journalIntegrityHash: string;
} | null): PublicRelayUnsignedOperation;
/** Separate create-only marker preserves the original prepared quote byte for byte. */
export declare class RelayRetirementRepository extends SecureStateStore {
    private path;
    load(operation: RelayUnsignedOperation): Promise<RelayRetirement | null>;
    /** Caller holds profile and operation locks and has checked all effect stores. */
    persistLocked(operation: RelayUnsignedOperation, retiredAt: string): Promise<RelayRetirement>;
}
export declare class RelayUnsignedOperationRepository extends SecureStateStore {
    loadOperation(profileHash: string, operationId: string): Promise<RelayUnsignedOperation | null>;
    findOperation(operationId: string): Promise<RelayUnsignedOperation | null>;
    listOperations(profileHash: string): Promise<readonly RelayUnsignedOperation[]>;
    listAllOperations(): Promise<readonly RelayUnsignedOperation[]>;
    /** Caller holds the shared profile, operation ID, and idempotency locks and checks all money stores. */
    persistLocked(operation: RelayUnsignedOperation): Promise<void>;
    private path;
}
export {};
