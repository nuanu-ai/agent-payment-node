import type { OperationRecord, ProviderDirectBinding, ProviderEffectReference } from "./model.js";
import type { ProviderAdapterBundle } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
export type ProviderDirectRecoveryOutcome = {
    readonly disposition: "unchanged";
} | {
    readonly disposition: "acknowledged";
    readonly transactionHash: `0x${string}`;
} | {
    readonly disposition: "rejected";
    readonly reason: "provider_denied" | "provider_expired";
} | {
    readonly disposition: "ambiguous";
    readonly reason: string;
};
export declare function observeProviderDirectRequest(adapter: ProviderAdapterBundle, operation: OperationRecord & {
    readonly providerEffect: ProviderEffectReference;
}, waitSeconds?: number): Promise<ProviderDirectRecoveryOutcome>;
export declare function createProviderEffectReference(recoveryToken: string, providerState: string): ProviderEffectReference;
export declare function canonicalProviderRecoveryToken(value: unknown): string;
export declare function sameFrozenProviderProfile(profile: ProviderProfileRecord, operation: OperationRecord, binding: ProviderDirectBinding): boolean;
