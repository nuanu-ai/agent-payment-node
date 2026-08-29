import { type X402OperationRecord } from "./x402-state-integrity.js";
export declare function validateX402AppendOnly(previous: X402OperationRecord, next: X402OperationRecord): void;
export declare function validateX402ScanContinuity(previous: X402OperationRecord, next: X402OperationRecord): void;
export declare function sameOptionalCanonical(left: unknown, right: unknown): boolean;
