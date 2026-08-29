import type { CommandRequest } from "./commands.js";
import type { ProfilePolicyApprovalIntent, ProfilePolicyApprovalPort } from "./policy-approval.js";
type PolicySetRequest = Extract<CommandRequest, {
    readonly command: "wallet.policy.set";
}>;
export declare class RejectingMcpPolicyApproval implements ProfilePolicyApprovalPort {
    private readonly request;
    private readonly handoff;
    constructor(request: PolicySetRequest);
    approve(intent: ProfilePolicyApprovalIntent): Promise<void>;
}
export {};
