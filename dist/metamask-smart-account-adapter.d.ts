import type { Address, Hex } from "./model.js";
import type { SmartAccountConsentPort } from "./metamask-smart-account-consent.js";
import type { SmartAccountPermissionStorePort } from "./encrypted-smart-account-permission-store.js";
import type { DirectExecutionPort, ProviderAdapterBundle, ProviderPermissionBinding, ProviderPermissionConnectIntent, ProviderPermissionLifecyclePort } from "./provider-ports.js";
export { METAMASK_SMART_ACCOUNT_PROVIDER_ID } from "./metamask-smart-account-record.js";
export interface SessionKeyFactoryPort {
    create(): {
        readonly address: Address;
        readonly privateKey: Hex;
    };
}
export declare class LocalSessionKeyFactory implements SessionKeyFactoryPort {
    create(): {
        readonly address: Address;
        readonly privateKey: Hex;
    };
}
export declare class MetaMaskSmartAccountAdapter implements ProviderPermissionLifecyclePort {
    private readonly store;
    private readonly consent;
    private readonly sessionKeys;
    private readonly now;
    private readonly direct;
    readonly capabilities: import("./provider-profile.js").ProviderCapabilitySnapshot;
    constructor(store: SmartAccountPermissionStorePort, consent: SmartAccountConsentPort, sessionKeys?: SessionKeyFactoryPort, now?: () => Date, direct?: DirectExecutionPort);
    bundle(): ProviderAdapterBundle;
    private upgradeProfile;
    connect(intent: ProviderPermissionConnectIntent): Promise<ProviderPermissionBinding>;
    activate(profileHash: string): Promise<ProviderPermissionBinding>;
    read(profileHash: string): Promise<ProviderPermissionBinding | null>;
    sync(profileHash: string, expectedRevision: number): Promise<ProviderPermissionBinding>;
    disable(profileHash: string, expectedRevision: number): Promise<ProviderPermissionBinding>;
    forget(profileHash: string, expectedRevision: number): Promise<{
        readonly warning: string;
    }>;
    private requireGranted;
    private saveTransition;
    private materializeExpiry;
    private instant;
}
