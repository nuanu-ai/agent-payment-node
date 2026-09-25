import type { AllowlistPolicyAccounts } from "./allowlist-policy-v2.js";
import type { StagedAllowlistPolicyRecord } from "./allowlist-policy-store.js";
import { type AssetPolicyRail, type AssetPolicyRegistry, type AssetMechanismOption } from "./asset-policy-registry.js";
import { type SwapMechanismPin } from "./swap/pin.js";
import { type TtyTransferApprovalOptions } from "./tty-approval.js";
export type AllowlistPolicyAction = "activate" | "revoke";
/** Everything the owner must see before one activation or revocation is written. */
export interface AllowlistPolicyDecisionIntent {
    readonly action: AllowlistPolicyAction;
    readonly profile: string;
    readonly record: StagedAllowlistPolicyRecord;
    readonly accounts: AllowlistPolicyAccounts;
    readonly currentActiveRevision: number | null;
    readonly fingerprint: string;
    readonly code: string;
}
export interface AllowlistPolicyApprovalPort {
    approve(intent: AllowlistPolicyDecisionIntent): Promise<void>;
}
/** One admitted asset x rail pair, flattened from a sealed v1 or v2 registry. */
export interface AllowlistAdmissionView {
    readonly network: string;
    readonly chain: string;
    readonly symbol: string;
    readonly kind: "native" | "token";
    readonly identifier: string | null;
    readonly decimals: number;
    readonly rail: AssetPolicyRail;
    readonly maximumPerTransferAtomic: string;
    readonly dailyLimitAtomic: string;
    readonly mechanism: Readonly<{
        provider: string;
        reference: string;
    }> | SwapMechanismPin | null;
    readonly mechanismOptions?: readonly AssetMechanismOption[];
    readonly recipient?: string;
}
export declare function allowlistAdmissions(registry: AssetPolicyRegistry): readonly AllowlistAdmissionView[];
export declare function allowlistDecisionFingerprint(input: {
    readonly action: AllowlistPolicyAction;
    readonly profileHash: string;
    readonly revision: number;
    readonly stagedRecordDigest: string;
    readonly policyDigest: string;
    readonly headEntryDigest: string | null;
}): string;
export declare function allowlistDecisionCode(action: AllowlistPolicyAction, fingerprint: string): string;
/** The exact owner screen. Pure, so tests and the scripted transcript show the same text the terminal prints. */
export declare function allowlistDecisionLines(intent: AllowlistPolicyDecisionIntent, approvalWindowClosesAt: string): readonly string[];
export declare class TtyAllowlistPolicyApproval implements AllowlistPolicyApprovalPort {
    private readonly options;
    constructor(options?: TtyTransferApprovalOptions);
    approve(intent: AllowlistPolicyDecisionIntent): Promise<void>;
}
