import { type X402OperationRecord, type X402ReceiptRecord } from "./x402-state-integrity.js";
type ReadJson = (path: string) => Promise<unknown | null>;
export declare function validateX402TerminalGraph(readJson: ReadJson, operation: X402OperationRecord): Promise<void>;
export declare function validateX402RecoveryReceiptAuthority(operation: X402OperationRecord, receipt: X402ReceiptRecord): void;
export {};
