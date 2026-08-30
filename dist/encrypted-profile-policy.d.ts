import type { WrappingSecretPort } from "./macos-keychain.js";
import type { ClockPort } from "./ports.js";
import { type ProfilePolicyBinding, type ProfilePolicyPort, type ProfilePolicyRecord, type ProfilePolicySetInput } from "./profile-policy.js";
import type { ProfilePolicyApprovalPort } from "./policy-approval.js";
import type { StateStore } from "./state.js";
export declare class EncryptedProfilePolicy implements ProfilePolicyPort {
    private readonly state;
    private readonly wrappingSecret;
    private readonly approval;
    private readonly clock;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort, approval: ProfilePolicyApprovalPort, clock?: ClockPort);
    load(binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null>;
    set(binding: ProfilePolicyBinding, input: ProfilePolicySetInput): Promise<ProfilePolicyRecord>;
    private loadForSet;
    private save;
}
