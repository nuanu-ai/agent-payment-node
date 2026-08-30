import { type ProfilePolicyRecord } from "./profile-policy.js";
import type { ProviderBalanceObservation } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { ProviderX402OperationRecord, ProviderX402PolicyBinding } from "./provider-x402-model.js";
import type { FreshChallenge } from "./x402-policy.js";
export declare function soleProviderOffer(challenge: FreshChallenge): {
    readonly requirements: FreshChallenge["paymentRequired"]["accepts"][number];
    readonly amountAtomic: string;
    readonly payee: `0x${string}`;
    readonly digest: string;
};
export declare function freezeProviderPolicy(policy: ProfilePolicyRecord, callerCapAtomic: string | undefined, effectiveCapAtomic: string): ProviderX402PolicyBinding;
export declare function assertProviderPolicyBalance(policy: ProfilePolicyRecord, balance: ProviderBalanceObservation, amountAtomic: string): void;
export declare function assertProviderAtomicAmount(value: string): void;
export declare function sameFrozenProviderProfile(profile: ProviderProfileRecord, operation: ProviderX402OperationRecord): boolean;
export declare function sameFrozenProviderPolicy(operation: ProviderX402OperationRecord, policy: ProfilePolicyRecord, effectiveCap: string): boolean;
