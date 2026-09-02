import type { WrappingSecretPort } from "./macos-keychain.js";
import type { Address, Hex } from "./model.js";
import type { StateStore } from "./state.js";
declare const RECORD_VERSION: "apn.provider-authorization.v1";
export interface ProviderAuthorizationBinding {
    readonly profile: string;
    readonly profileHash: string;
    readonly operationId: string;
    readonly fingerprint: string;
    readonly wallet: Address;
    readonly providerId: string;
    readonly profileRevision: number;
    readonly capabilityHash: string;
    readonly accountBindingHash: string;
}
interface ProviderAuthorizationBase {
    readonly schemaVersion: typeof RECORD_VERSION;
    readonly requestHash: string;
    readonly updatedAt: string;
}
export type ProviderAuthorizationRecord = ProviderAuthorizationBase & {
    readonly phase: "invocation_started";
} | ProviderAuthorizationBase & {
    readonly phase: "pending";
    readonly recoveryToken: string;
    readonly providerState: string;
} | ProviderAuthorizationBase & {
    readonly phase: "signed";
    readonly signature: Hex;
    readonly signatureHash: string;
} | ProviderAuthorizationBase & {
    readonly phase: "rejected";
    readonly rejection: "provider_denied" | "provider_expired";
};
export interface ProviderAuthorizationStorePort {
    load(binding: ProviderAuthorizationBinding): Promise<ProviderAuthorizationRecord | null>;
    save(binding: ProviderAuthorizationBinding, record: ProviderAuthorizationRecord): Promise<void>;
}
export declare class EncryptedProviderAuthorizationStore implements ProviderAuthorizationStorePort {
    private readonly wrappingSecret;
    private readonly envelopes;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort);
    load(binding: ProviderAuthorizationBinding): Promise<ProviderAuthorizationRecord | null>;
    save(binding: ProviderAuthorizationBinding, record: ProviderAuthorizationRecord): Promise<void>;
    private loadOrCreateWrappingSecret;
}
export {};
