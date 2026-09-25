import type { Address } from "./model.js";
import type { EvmDirectBinding } from "./evm-direct.js";
import type { RailApprovalPort } from "./direct-rail-ports.js";
import { type ChainPolicy, type ChainPolicyApprovalPort } from "./chain-policy.js";
import type { RelayExecutionConfirmationSummary } from "./runtime.js";
export declare const TTY_APPROVAL_DEADLINE_MS = 60000;
export interface TransferApprovalIntent {
    readonly evm?: EvmDirectBinding;
    readonly profile: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly walletAddress: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly amountDecimal: string;
    readonly nonceAtomic?: string;
    readonly gasLimitAtomic?: string;
    readonly maxFeePerGasAtomic?: string;
    readonly maxPriorityFeePerGasAtomic?: string;
    readonly expiresAt: string;
    readonly providerId?: string;
    readonly policyIdentity?: string;
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
/** A fresh foreground consent for each Relay source execution attempt. */
export declare class TtyRelayExecuteConfirmation {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(summary: RelayExecutionConfirmationSummary): Promise<boolean>;
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
export declare class TtyRailApproval implements RailApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    approve(input: Parameters<RailApprovalPort["approve"]>[0]): Promise<void>;
}
export declare class TtyChainPolicyApproval implements ChainPolicyApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    approve(policy: ChainPolicy): Promise<void>;
}
export declare function exactChainConsent(lines: readonly string[], phrase: string, expiresAt: string, options: TtyTransferApprovalOptions, maximumInputBytes?: number): Promise<void>;
export {};
