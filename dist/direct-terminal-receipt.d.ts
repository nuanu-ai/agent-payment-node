import type { EvmTransferEvidence } from "./evm-ports.js";
import type { OperationRecord, ReceiptRecord } from "./model.js";
export declare function validateEvmTransferEvidence(value: unknown): EvmTransferEvidence;
export declare function hasSafeEvmInclusion(value: unknown, blockNumberAtomic: string): boolean;
export declare function assertDirectTerminalReceiptAuthority(operation: OperationRecord, receipt: ReceiptRecord | null): void;
