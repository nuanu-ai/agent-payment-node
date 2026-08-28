import type { Address, WalletRecord } from "./model.js";
export declare const PROFILE_POLICY_VERSION: "apn.profile-policy.v1";
export interface ProfilePolicyBinding {
    readonly profile: string;
    readonly profileHash: string;
    readonly walletAddress: Address;
    readonly walletBindingHash: string;
}
export interface ProfilePolicyRecord extends ProfilePolicyBinding {
    readonly schemaVersion: typeof PROFILE_POLICY_VERSION;
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly maxBalanceEthWei?: string;
    readonly approvedAt: string;
    readonly updatedAt: string;
    readonly integrityHash: string;
}
export interface ProfilePolicySetInput {
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly maxBalanceEthWei?: string;
}
export interface ProfilePolicyPort {
    load(binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null>;
    set(binding: ProfilePolicyBinding, input: ProfilePolicySetInput): Promise<ProfilePolicyRecord>;
}
export declare function policyBinding(wallet: WalletRecord): ProfilePolicyBinding;
export declare function canonicalPolicyInput(input: ProfilePolicySetInput): ProfilePolicySetInput;
export declare function sealProfilePolicy(value: Omit<ProfilePolicyRecord, "integrityHash">): ProfilePolicyRecord;
export declare function validateProfilePolicy(value: unknown, binding?: ProfilePolicyBinding): ProfilePolicyRecord;
export declare function publicProfilePolicy(profile: string, policy: ProfilePolicyRecord | null): unknown;
export declare function fundingPosture(usdcAtomic: string, ethAtomic: string, policy: ProfilePolicyRecord | null): unknown;
export declare function requireProfilePolicy(policy: ProfilePolicyRecord | null): ProfilePolicyRecord;
export declare function effectiveX402Cap(policy: ProfilePolicyRecord, callerCapInput?: string): string;
export declare function assertUnattendedX402Balance(policy: ProfilePolicyRecord, usdcAtomic: string): void;
export declare function policyIncrease(current: ProfilePolicyRecord | null, next: ProfilePolicySetInput): boolean;
