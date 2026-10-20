import type { Address } from "./model.js";
import { type X402PolicyNetwork, type X402SolanaPolicyNetwork } from "./x402-network.js";
export interface ProfilePolicyApprovalIntent {
    readonly x402Network?: X402PolicyNetwork;
    readonly x402Solana?: X402SolanaPolicyNetwork;
    readonly profile: string;
    readonly walletAddress: Address;
    readonly fingerprint: string;
    readonly change: "create" | "increase";
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly maxBalanceEthWei?: string;
    /** The x402 payee pin the change leaves in force; absent means payees are not restricted. */
    readonly x402Payees?: readonly string[];
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
/** The native cap in the chain's own currency (QA 0.5.54: Sei showed "ETH"); the atomic value and its field stay as they are. */
export declare function nativeCapLine(chainId: number, maxBalanceWei: string | undefined): string;
export declare function profilePolicyApprovalPhrase(fingerprint: string): string;
export {};
