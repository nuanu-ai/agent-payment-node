import type { Address } from "./model.js";
export declare const TTY_APPROVAL_DEADLINE_MS = 60000;
export interface TransferApprovalIntent {
    readonly profile: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly walletAddress: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly amountDecimal: string;
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    readonly expiresAt: string;
}
export interface TransferApprovalPort {
    approve(intent: TransferApprovalIntent): Promise<void>;
}
interface ApprovalTerminal {
    readonly fd: number;
    write(contents: string): Promise<void>;
    read(signal: AbortSignal): AsyncIterable<Uint8Array>;
    close(): Promise<void>;
}
export interface TtyTransferApprovalOptions {
    readonly deadlineMs?: number;
    readonly signal?: AbortSignal;
    readonly openTerminal?: () => Promise<ApprovalTerminal>;
    readonly isTerminal?: (fd: number) => boolean;
}
export declare class TtyTransferApproval implements TransferApprovalPort {
    private readonly deadlineMs;
    private readonly signal;
    private readonly openTerminal;
    private readonly isTerminal;
    constructor(options?: TtyTransferApprovalOptions);
    approve(intent: TransferApprovalIntent): Promise<void>;
}
export declare function transferApprovalPhrase(fingerprint: string): string;
export declare function isExactTransferApproval(expected: string, supplied: string): boolean;
export {};
