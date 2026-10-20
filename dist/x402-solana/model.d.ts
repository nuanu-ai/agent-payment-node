import { z } from "zod";
export type X402SolanaState = "prepared" | "reserving" | "signed" | "exposed" | "settled" | "failed_onchain" | "expired_unlanded" | "failed_before_effect" | "abandoned_unknown";
export declare const X402_SOLANA_STATES: readonly X402SolanaState[];
export declare const X402_SOLANA_TERMINAL_STATES: readonly X402SolanaState[];
declare const recordSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"apn.x402-solana-operation.v1">;
    kind: z.ZodLiteral<"x402_solana">;
    operationId: z.ZodString;
    profile: z.ZodString;
    profileHash: z.ZodString;
    idempotencyHash: z.ZodString;
    requestHash: z.ZodString;
    terms: z.ZodObject<{
        url: z.ZodString;
        origin: z.ZodString;
        urlHash: z.ZodString;
        challengeHash: z.ZodString;
        resourceCanonicalJson: z.ZodString;
        offerIndex: z.ZodNumber;
        offerCanonicalJson: z.ZodString;
        offerHash: z.ZodString;
        network: z.ZodLiteral<`solana:${string}`>;
        chain: z.ZodLiteral<"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d">;
        payer: z.ZodString;
        mint: z.ZodString;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        sourceTokenAccount: z.ZodString;
        payee: z.ZodString;
        destinationTokenAccount: z.ZodString;
        feePayer: z.ZodString;
        amountAtomic: z.ZodString;
        maxAmountAtomic: z.ZodString;
        computeUnitLimit: z.ZodNumber;
        computeUnitPriceMicroLamports: z.ZodString;
        admission: z.ZodObject<{
            policyDigest: z.ZodString;
            policyRevision: z.ZodNumber;
            registryVersion: z.ZodString;
            activationDigest: z.ZodString;
            maximumPerTransferAtomic: z.ZodString;
            dailyLimitAtomic: z.ZodString;
        }, z.core.$strict>;
        preparedAt: z.ZodString;
        expiresAt: z.ZodString;
    }, z.core.$strict>;
    fingerprint: z.ZodString;
    lifetime: z.ZodNullable<z.ZodObject<{
        blockhash: z.ZodString;
        lastValidBlockHeight: z.ZodString;
        floorSlot: z.ZodString;
        observedBlockHeight: z.ZodString;
        messageBase64: z.ZodString;
        messageHash: z.ZodString;
        simulationSlot: z.ZodString;
        unitsConsumed: z.ZodString;
        boundAt: z.ZodString;
    }, z.core.$strict>>;
    lease: z.ZodNullable<z.ZodObject<{
        reservationId: z.ZodString;
        reservationDigest: z.ZodString;
    }, z.core.$strict>>;
    signed: z.ZodNullable<z.ZodObject<{
        rawPayload: z.ZodString;
        rawPayloadHash: z.ZodString;
        payerSignature: z.ZodString;
    }, z.core.$strict>>;
    exposure: z.ZodNullable<z.ZodObject<{
        at: z.ZodString;
        paymentHeaderHash: z.ZodString;
    }, z.core.$strict>>;
    response: z.ZodNullable<z.ZodObject<{
        status: z.ZodNumber;
        observedAt: z.ZodString;
        paymentResponseHeaderHash: z.ZodOptional<z.ZodString>;
        settlementHint: z.ZodOptional<z.ZodString>;
        settlementSuccess: z.ZodOptional<z.ZodBoolean>;
        result: z.ZodOptional<z.ZodObject<{
            mediaType: z.ZodString;
            bodyEncoding: z.ZodOptional<z.ZodLiteral<"base64">>;
            responseStatus: z.ZodOptional<z.ZodString>;
            bodyText: z.ZodString;
            resultHash: z.ZodString;
            byteLength: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    settlement: z.ZodNullable<z.ZodObject<{
        signature: z.ZodString;
        slot: z.ZodString;
        success: z.ZodBoolean;
        errorCanonicalJson: z.ZodNullable<z.ZodString>;
        source: z.ZodEnum<{
            payment_response: "payment_response";
            signature_index: "signature_index";
        }>;
        observedAt: z.ZodString;
        rpcOriginHash: z.ZodString;
    }, z.core.$strict>>;
    unlanded: z.ZodNullable<z.ZodObject<{
        finalizedBlockHeight: z.ZodString;
        lastValidBlockHeight: z.ZodString;
        floorSlot: z.ZodString;
        coverageSlot: z.ZodString;
        openedSignatures: z.ZodNumber;
        observedAt: z.ZodString;
        rpcOriginHash: z.ZodString;
    }, z.core.$strict>>;
    state: z.ZodEnum<{
        prepared: "prepared";
        failed_before_effect: "failed_before_effect";
        abandoned_unknown: "abandoned_unknown";
        signed: "signed";
        settled: "settled";
        reserving: "reserving";
        exposed: "exposed";
        expired_unlanded: "expired_unlanded";
        failed_onchain: "failed_onchain";
    }>;
    terminal: z.ZodBoolean;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    journal: z.ZodArray<z.ZodObject<{
        state: z.ZodEnum<{
            prepared: "prepared";
            failed_before_effect: "failed_before_effect";
            abandoned_unknown: "abandoned_unknown";
            signed: "signed";
            settled: "settled";
            reserving: "reserving";
            exposed: "exposed";
            expired_unlanded: "expired_unlanded";
            failed_onchain: "failed_onchain";
        }>;
        at: z.ZodString;
        reason: z.ZodString;
        previousHash: z.ZodString;
        entryHash: z.ZodString;
    }, z.core.$strict>>;
    integrityHash: z.ZodString;
}, z.core.$strict>;
export type X402SolanaRecord = z.infer<typeof recordSchema>;
export type X402SolanaTerms = X402SolanaRecord["terms"];
export type X402SolanaBody = Omit<X402SolanaRecord, "integrityHash">;
type Mutable = "lifetime" | "lease" | "signed" | "exposure" | "response" | "settlement" | "unlanded";
export declare function x402SolanaFingerprint(identity: Pick<X402SolanaRecord, "operationId" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): string;
export declare function newX402SolanaRecord(input: Pick<X402SolanaRecord, "operationId" | "profile" | "profileHash" | "idempotencyHash" | "requestHash" | "terms">): X402SolanaRecord;
/** A move along the edge table; written fields appear once and are never restated. `response` alone may be added while exposed. */
export declare function transitionX402Solana(record: X402SolanaRecord, input: {
    readonly state: X402SolanaState;
    readonly at: string;
    readonly reason: string;
} & Partial<Pick<X402SolanaRecord, Mutable>>): X402SolanaRecord;
/** Checked against the record's own fields only (R2): its hash chain, fingerprint, state fields and terminal flag. */
export declare function validateX402SolanaRecord(value: unknown): X402SolanaRecord;
export declare function x402SolanaRecordBody(record: X402SolanaRecord): X402SolanaBody;
export {};
