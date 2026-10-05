import type { Permit2ProductionRecord } from "./production-repository.js";
import type { Permit2ObservationProjection } from "./production-observer.js";
import type { Permit2ProductionSigned } from "./production-signed.js";
export declare const JOURNAL_SCHEMA = "apn.x402-permit2-production.exposure.v1";
export interface Permit2TerminalIntent {
    readonly outcome: "settled" | "expired_unused";
    readonly operationDigest: string;
    readonly materialHash: string;
    readonly requestHash: string;
    readonly challengeHash: string;
    readonly signedHash: string | null;
    readonly transactionHash: string | null;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly observation: Permit2ObservationProjection;
    readonly outcomeDigest: string;
}
/** Private extension; presence is irreversible authorization risk, including crash before signature storage. */
export interface Permit2ExposureJournal {
    readonly schemaVersion: typeof JOURNAL_SCHEMA;
    readonly approvalFingerprint: string;
    readonly bindingHash: string;
    readonly permit2Deadline: string;
    readonly eip2612Deadline: string | null;
    readonly holdConfirmed: boolean;
    readonly signed: Permit2ProductionSigned | null;
    readonly request: {
        readonly attempt: 1;
        readonly requestHash: string;
        readonly headerHash: string;
    } | null;
    readonly terminalIntent: Permit2TerminalIntent | null;
}
/** Binding only: no human approval or custody permission. */
export declare function productionApprovalFingerprint(record: Permit2ProductionRecord): string;
export declare function productionRiskBinding(record: Permit2ProductionRecord): string;
export declare function productionTerminalDigest(record: Permit2ProductionRecord, intent: Omit<Permit2TerminalIntent, "outcomeDigest">): string;
export declare function productionStableDigest(record: Permit2ProductionRecord): string;
export declare function validateExposureJournal(value: unknown, record: Permit2ProductionRecord): Permit2ExposureJournal;
/** Append-only risk, bearer, attempt and first terminal intent. */
export declare function assertExposureAppend(current: Permit2ExposureJournal | undefined, next: Permit2ExposureJournal): void;
