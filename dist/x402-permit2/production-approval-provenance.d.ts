import { type Permit2ProductionRecord } from "./production-repository.js";
import { type Permit2ApprovalPurpose, type Permit2ForegroundApprovalPort } from "./production-approval.js";
/** How long a foreground approval may be used after the owner completed it. */
export declare const PERMIT2_APPROVAL_WINDOW_MS = 60000;
/**
 * What the owner approved at the foreground prompt: a plain value. Only the paid CLI path shows the prompt and then
 * signs, and every later step re-checks the value against the saved record and the clock (assertPermit2ApprovalCurrent).
 */
export interface Permit2ForegroundApproval {
    readonly operationId: string;
    readonly purpose: Permit2ApprovalPurpose;
    readonly materialHash: string;
    readonly displayHash: string;
    readonly fingerprint: string;
    readonly completedAt: number;
}
/** Shows one reserved operation at the foreground prompt; no key, signing or transport is involved. */
export declare class Permit2ForegroundApprovalAuthority {
    #private;
    constructor(root: string, approval: Permit2ForegroundApprovalPort, clock: () => Date);
    approveOwned(id: string, purpose?: Permit2ApprovalPurpose): Promise<Permit2ForegroundApproval>;
}
/** The approval names exactly what `record` displays and is at most 60 s old at `at`; returns `at`. */
export declare function assertPermit2ApprovalCurrent(approval: Permit2ForegroundApproval, record: Permit2ProductionRecord, at: Date): Date;
/** The approval is at most 60 s old at `at`, and `at` is not before it. */
export declare function assertPermit2ApprovalWindow(approval: Permit2ForegroundApproval, at: Date): void;
export declare function permit2Now(clock: () => Date): Date;
