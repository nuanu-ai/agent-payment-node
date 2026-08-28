import type { Address } from "./model.js";
export interface ProfilePolicyApprovalIntent {
    readonly profile: string;
    readonly walletAddress: Address;
    readonly fingerprint: string;
    readonly change: "create" | "increase";
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly maxBalanceEthWei?: string;
}
export interface ProfilePolicyApprovalPort {
    approve(intent: ProfilePolicyApprovalIntent): Promise<void>;
}
interface ApprovalTerminal {
    readonly fd: number;
    write(contents: string): Promise<void>;
    read(signal: AbortSignal): AsyncIterable<Uint8Array>;
    close(): Promise<void>;
}
export interface TtyProfilePolicyApprovalOptions {
    readonly deadlineMs?: number;
    readonly signal?: AbortSignal;
    readonly openTerminal?: () => Promise<ApprovalTerminal>;
    readonly isTerminal?: (fd: number) => boolean;
}
export declare class TtyProfilePolicyApproval implements ProfilePolicyApprovalPort {
    private readonly deadlineMs;
    private readonly signal;
    private readonly openTerminal;
    private readonly isTerminal;
    constructor(options?: TtyProfilePolicyApprovalOptions);
    approve(intent: ProfilePolicyApprovalIntent): Promise<void>;
}
export declare function profilePolicyApprovalPhrase(fingerprint: string): string;
export {};
