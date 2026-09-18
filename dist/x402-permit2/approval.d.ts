import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { Permit2SigningPlan } from "./authorization.js";
import type { X402Permit2AllowlistBinding } from "./policy.js";
export interface Permit2ApprovalSummary {
    readonly profile: string;
    readonly operationId: string;
    /** The seller resource origin the payment unlocks. */
    readonly resourceOrigin: string;
    readonly plan: Permit2SigningPlan;
    readonly binding: X402Permit2AllowlistBinding;
    readonly caps: {
        readonly maximumPerTransferAtomic: string;
        readonly dailyLimitAtomic: string;
    };
    readonly dailyUsageAtomic: string;
    /** The foreground decision must happen before this instant. */
    readonly approveBefore: string;
}
export interface Permit2ApprovalScreen {
    readonly lines: readonly string[];
    readonly fingerprint: string;
    readonly code: string;
}
/** Everything the owner authorizes, bound into one fingerprint and its six-character code. Pure; nothing is signed here. */
export declare function permit2ApprovalScreen(summary: Permit2ApprovalSummary): Permit2ApprovalScreen;
/** Foreground-only decision. A refused or wrong code returns false; a missing terminal fails closed. */
export declare class TtyPermit2Approval {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    confirm(screen: Permit2ApprovalScreen, approveBefore: string): Promise<boolean>;
}
