import type { ProfilePolicyRecord } from "./profile-policy.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import { type ProviderX402OperationRecord } from "./provider-x402-model.js";
import type { FreshChallenge } from "./x402-policy.js";
export declare function stagedProviderX402Operation(input: {
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly profile: string;
    readonly profileHash: string;
    readonly requestHash: string;
    readonly endpoint: URL;
    readonly rpcUrl: string;
    readonly callerCapAtomic?: string;
    readonly effectiveCapAtomic: string;
    readonly bound: ProviderProfileRecord;
    readonly policy: ProfilePolicyRecord;
    readonly selected: {
        readonly requirements: FreshChallenge["paymentRequired"]["accepts"][number];
        readonly amountAtomic: string;
        readonly payee: `0x${string}`;
        readonly digest: string;
    };
    readonly createdAt: string;
}): ProviderX402OperationRecord;
