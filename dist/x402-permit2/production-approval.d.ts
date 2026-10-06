import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
export type Permit2ApprovalPurpose = "sign-only" | "sign-and-submit-once";
export declare function permit2ApprovalPurpose(value: unknown): Permit2ApprovalPurpose;
export interface Permit2ApprovalDisplay {
    readonly purpose: Permit2ApprovalPurpose;
    readonly operationId: string;
    readonly profile: string;
    readonly payer: string;
    readonly chain: "eip155:43114";
    readonly token: string;
    readonly payTo: string;
    readonly amountAtomic: string;
    readonly spender: string;
    readonly proxy: string;
    readonly tokenPermit: "requested" | "not_requested";
    readonly permit2Deadline: string;
    readonly eip2612Deadline: string | null;
    readonly origin: string;
    readonly urlHash: string;
    readonly requestHash: string;
    readonly headersHash: string;
    readonly bodyHash: string;
    readonly materialHash: string;
    readonly typedDataDigest: string;
    readonly eip2612Digest: string | null;
    readonly ownerPolicyDigest: string;
    readonly policyRevision: number;
    readonly maximumPerTransferAtomic: string;
    readonly dailyLimitAtomic: string;
    readonly fingerprint: string;
    readonly riskBinding: string;
    readonly displayHash: string;
}
export interface Permit2ForegroundApprovalPort {
    approve(display: Permit2ApprovalDisplay): Promise<void>;
}
/** Pure sanitized disclosure. This is binding, never current-owner or chain authority. */
export declare function permit2ApprovalDisplay(record: Permit2ProductionRecord, purpose?: Permit2ApprovalPurpose): Permit2ApprovalDisplay;
/** Foreground only; no key/custody lock is acquired here. */
export declare class TtyPermit2ForegroundApproval implements Permit2ForegroundApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    approve(d: Permit2ApprovalDisplay): Promise<void>;
}
