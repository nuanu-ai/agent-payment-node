import type { BigIntStats } from "node:fs";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { type HistoricalRetirementCanonicalWitness, type HistoricalRetirementRecord } from "./historical-retirement-record.js";
import type { HistoricalDirectoryGuard } from "./historical-authentication-readers.js";
import type { OwnedJupiterHistoricalRetirementContext, OwnedJupiterHistoricalRetirementAuthority, JupiterHistoricalRetirementPublicResult } from "./historical-retirement-owner.js";
/** Internal codecs and read validation; no accounting publication or owner capability factory. */
export declare const PROFILE = "solana-local";
export declare const NATIVE_IDENTITY: AssetUsageIdentity;
export declare const USDC_IDENTITY: AssetUsageIdentity;
export declare const JOURNAL_NAMESPACE = "jupiter-historical-retirement-journals";
export declare const RECEIPT_NAMESPACE = "jupiter-historical-retirement-receipts";
declare const JOURNAL_SCHEMA: "apn.jupiter-historical-retirement-journal.v1";
declare const RECEIPT_SCHEMA: "apn.jupiter-historical-retirement-receipt.v1";
export interface RetirementJournal {
    readonly schemaVersion: typeof JOURNAL_SCHEMA;
    readonly operationId: string;
    readonly recordHash: string;
    readonly accountingAt: string;
    readonly journalHash: string;
}
export interface RetirementReceipt {
    readonly schemaVersion: typeof RECEIPT_SCHEMA;
    readonly operationId: string;
    readonly profile: "solana-local";
    readonly status: "retired_unknown";
    readonly retirementRecordHash: string;
    readonly accountingAt: string;
    readonly conservativeNativeAmount: "6000000";
    readonly additionalAdmissionNativeAmount: "5000000";
    readonly effectAt: null;
    readonly actualNativeFee: null;
    readonly transactionOutcome: "unknown";
    readonly transactionMayHaveBeenSubmitted: true;
    readonly receiptHash: string;
}
export type RetirementProjectionNamespace = typeof JOURNAL_NAMESPACE | typeof RECEIPT_NAMESPACE;
export interface ProjectionTempCleanup {
    readonly namespace: RetirementProjectionNamespace;
    readonly targetPath: string;
    readonly temporaryPath: string;
    readonly parentPath: string;
    readonly parentDev: bigint;
    readonly tempDev: bigint;
    readonly tempIno: bigint;
    readonly targetIno: bigint | null;
    readonly expectedBytes: Buffer;
}
export declare function lockKey(identity: AssetUsageIdentity): string;
export declare function assertContext(context: OwnedJupiterHistoricalRetirementContext): void;
export declare function canonicalWitness(value: unknown): HistoricalRetirementCanonicalWitness;
export declare function journalFor(record: HistoricalRetirementRecord): RetirementJournal;
export declare function receiptFor(record: HistoricalRetirementRecord): RetirementReceipt;
export declare function validateJournal(value: unknown, expected: RetirementJournal): RetirementJournal;
export declare function validateReceipt(value: unknown, expected: RetirementReceipt): RetirementReceipt;
export declare function publicResult(record: HistoricalRetirementRecord, idempotentRecovered: boolean): JupiterHistoricalRetirementPublicResult;
export declare function bucketRowsOriginal(rows: readonly AssetUsageReservation[], reservationId: string, expected: AssetUsageReservation): AssetUsageReservation;
export declare function lstatOptional(path: string): Promise<BigIntStats | null>;
export declare function corrupt(): never;
export declare function refuse(): never;
export declare function scopeDeadline(context: OwnedJupiterHistoricalRetirementContext): number;
export declare function loadRetirements(root: string, rows: readonly AssetUsageReservation[]): Promise<readonly HistoricalRetirementRecord[]>;
export declare function readRowsAndRetirements(root: string, context: OwnedJupiterHistoricalRetirementContext): Promise<{
    native: readonly AssetUsageReservation[];
    usdc: readonly AssetUsageReservation[];
    retirements: readonly HistoricalRetirementRecord[];
}>;
export declare function retirementFileStatValid(value: BigIntStats, parentDev: bigint, expectedLinks: bigint): boolean;
export declare function projectionFileStatValid(value: BigIntStats, parentDev: bigint, expectedLinks: bigint, expectedBytes: Buffer): boolean;
export declare function fileStatFacts(value: BigIntStats): string;
export declare function decodeRetirementBytes(bytes: Buffer): HistoricalRetirementRecord;
export declare function assertNoOrphanPostCommit(store: {
    read(path: string): Promise<unknown | null>;
}, operationId: string): Promise<void>;
export interface RetirementPublicationFrame {
    readonly token: OwnedJupiterHistoricalRetirementAuthority;
    readonly context: OwnedJupiterHistoricalRetirementContext;
    readonly record: HistoricalRetirementRecord;
}
/** Read-only bucket adapter; the SecureStateStore subclass remains private. */
export declare function loadHistoricalUsageBucket(root: string, guard: HistoricalDirectoryGuard, identity: AssetUsageIdentity): Promise<readonly AssetUsageReservation[]>;
export declare function loadHistoricalUsageBuckets(root: string, guard: HistoricalDirectoryGuard): Promise<{
    native: readonly AssetUsageReservation[];
    usdc: readonly AssetUsageReservation[];
}>;
export {};
