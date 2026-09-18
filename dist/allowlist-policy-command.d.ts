import type { CommandOutcome, CommandRequest } from "./commands.js";
import { type AllowlistPolicyApprovalPort } from "./allowlist-policy-activation.js";
import type { ClockPort } from "./ports.js";
type AllowlistPolicyRequest = Extract<CommandRequest, {
    readonly command: `allowlist.policy.${string}`;
}>;
export interface AllowlistPolicyCommandContext {
    readonly state: {
        readonly root: string;
    };
    readonly clock: ClockPort;
    readonly allowlistPolicyApproval?: AllowlistPolicyApprovalPort;
}
export declare function executeAllowlistPolicyCommand(request: AllowlistPolicyRequest, context: AllowlistPolicyCommandContext): Promise<CommandOutcome>;
export {};
