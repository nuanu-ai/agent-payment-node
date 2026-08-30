import { type ProfilePolicyRecord } from "./profile-policy.js";
import type { ProviderAdapterBundle, ProviderBalanceObservation } from "./provider-ports.js";
import { type ProviderProfileRecord } from "./provider-profile.js";
import type { ProviderX402OperationRecord } from "./provider-x402-model.js";
import type { RuntimeContext } from "./runtime.js";
export type ExecutableProviderX402Adapter = ProviderAdapterBundle & {
    readonly x402: Required<Pick<NonNullable<ProviderAdapterBundle["x402"]>, "execute" | "prime" | "assertCompatibleIntent">>;
};
export declare function requireProviderX402Profile(context: RuntimeContext, profileHash: string): Promise<ProviderProfileRecord>;
export declare function requireProviderX402Adapter(context: RuntimeContext, profile: ProviderProfileRecord): ExecutableProviderX402Adapter;
export declare function observeProviderX402Balance(context: RuntimeContext, profile: ProviderProfileRecord, adapter: ProviderAdapterBundle): Promise<ProviderBalanceObservation>;
export declare function assertFrozenProviderX402Policy(operation: ProviderX402OperationRecord, policy: ProfilePolicyRecord, balance: ProviderBalanceObservation): void;
export declare function assertProviderX402RpcBinding(context: RuntimeContext, operation: ProviderX402OperationRecord): void;
export declare function canonicalProviderX402RpcUrl(value: string): string;
